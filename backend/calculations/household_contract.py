

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

from research_engine.api import (
    BUFFER_MONTHS_MAX,
    BUFFER_MONTHS_MIN,
    CONVERSION_COST_MAX,
    EXPENSE_INCOME_RATIO_MAX,
    EXPENSE_INCOME_RATIO_MIN,
    SUPPORTED_HORIZON_YEARS,
    SUPPORTED_REBALANCE_FREQUENCIES,
)
from research_engine.personal import (
    CONTRACT_VERSION,
    CURRENT_POLICY_LABEL,
    ENGINE_INTERFACE_VERSION,
    FX_PATH_POLICY,
    IMPLEMENTATION_ONLY_FIELDS,
    OPTIMIZED_POLICY_LABEL,
    SHARE_SUM_TOLERANCE,
    TIE_ABSOLUTE_TOLERANCE,
    UNITS,
    PersonalAnalysisProvenanceError,
    PersonalAnalysisValidationError,
    canonical_number,
    comparison_outcome,
    engine_provenance,
    validate_share_vector,
)

from .serializers import FORBIDDEN_CLIENT_FIELDS

HOUSEHOLD_JOB_KIND = "household_analysis"

REQUEST_KEYS = frozenset(
    {
        "contract_version",
        "income_shares",
        "expense_shares",
        "current_reserve_weights",
        "expense_income_ratio",
        "buffer_months",
        "horizon_years",
        "rebalance_frequency",
        "conversion_cost",
    }
)
FORBIDDEN_REQUEST_FIELDS = frozenset(FORBIDDEN_CLIENT_FIELDS) | {
    "profile",
    "weights",
    "buffers",
    "tested_buffers",
    "target",
    "provenance",
    "fingerprint",
}

SCENARIO_KEYS = frozenset(REQUEST_KEYS - {"contract_version"})
PROVENANCE_KEYS = frozenset(
    {
        "model_version",
        "data_as_of",
        "dataset_sha256",
        "simulation_paths",
        "simulation_seed",
        "canonical_optimization_specification",
        "fx_path_policy",
    }
)
SNAPSHOT_FIELDS = (
    "model_version",
    "data_as_of",
    "dataset_sha256",
    "simulation_paths",
    "simulation_seed",
    "canonical_optimization_specification",
)
RESULT_KEYS = frozenset(
    {
        "contract_version",
        "engine_interface_version",
        "units",
        "scenario",
        "provenance",
        "current_policy",
        "optimized_policy",
        "comparison",
    }
)
POLICY_KEYS = frozenset({"label", "weights", "objective", "diagnostics", "implementation_only"})
IDENTIFICATION_KEYS = frozenset(
    {
        "applies_to",
        "identification_class",
        "n_coarse",
        "n_refined",
        "n_surface",
        "near_optimal_1pct_count",
        "near_optimal_1pct_frac",
    }
)
COMPARISON_KEYS = frozenset(
    {
        "objective",
        "direction",
        "cvar95_optimized_minus_current",
        "outcome",
        "tie_absolute_tolerance",
        "includes_initial_switching_cost",
    }
)
SUPPORTED_IDENTIFICATION_CLASSES = frozenset(
    {"A_WELL_IDENTIFIED", "B_WEAKLY_IDENTIFIED", "C_NOT_IDENTIFIED"}
)
DELTA_CONSISTENCY_ATOL = 1e-15


class HouseholdRequestError(ValueError):
    """Malformed or inconsistent request (HTTP 400)."""

    def __init__(self, details: dict[str, list[str]]):
        self.details = details
        super().__init__("validation_error")


class UnsupportedScenarioError(ValueError):
    """Well-formed request outside the supported simulation domain (HTTP 422)."""

    def __init__(self, reasons: list[dict[str, Any]]):
        self.reasons = reasons
        super().__init__("unsupported_scenario")


class ProvenanceUnavailableError(RuntimeError):
    """Authoritative provenance could not be verified (HTTP 503 / task failure)."""


class HouseholdProvenanceChangedError(ValueError):
    """Stored request/snapshot no longer matches live provenance."""


class HouseholdResultValidationError(ValueError):
    """Engine result failed the exact-key household contract."""


# ---------------------------------------------------------------------------
# Request parsing
# ---------------------------------------------------------------------------


def _number_or_error(data, key, errors) -> float | None:
    try:
        return canonical_number(data[key], key)
    except PersonalAnalysisValidationError as exc:
        errors.setdefault(key, []).append(str(exc))
        return None


def parse_household_request(data: Any) -> dict[str, Any]:
    """Validate a POST body and return the canonical normalized scenario."""
    # 1. Envelope and exact keys
    if not isinstance(data, dict):
        raise HouseholdRequestError({"non_field_errors": ["Request body must be a JSON object."]})
    keys = set(data.keys())
    errors: dict[str, list[str]] = {}
    forbidden = sorted(keys & FORBIDDEN_REQUEST_FIELDS)
    unknown = sorted(keys - REQUEST_KEYS - FORBIDDEN_REQUEST_FIELDS)
    missing = sorted(REQUEST_KEYS - keys)
    if forbidden:
        errors["forbidden_fields"] = [f"Field '{name}' is not allowed." for name in forbidden]
    if unknown:
        errors["unknown_fields"] = [f"Unknown field '{name}'." for name in unknown]
    if missing:
        errors["missing_fields"] = [f"Field '{name}' is required." for name in missing]
    if errors:
        raise HouseholdRequestError(errors)

    # 2. Types and numeric structure
    if data["contract_version"] != CONTRACT_VERSION:
        errors["contract_version"] = [f"contract_version must be '{CONTRACT_VERSION}'."]

    vectors: dict[str, list[float] | None] = {}
    for key in ("income_shares", "expense_shares"):
        try:
            vectors[key] = validate_share_vector(data[key], key)
        except PersonalAnalysisValidationError as exc:
            errors.setdefault(key, []).append(str(exc))
    weights_raw = data["current_reserve_weights"]
    weights: list[float] | None = None
    if weights_raw is not None:
        try:
            weights = validate_share_vector(weights_raw, "current_reserve_weights")
        except PersonalAnalysisValidationError as exc:
            errors.setdefault("current_reserve_weights", []).append(str(exc))

    ratio = _number_or_error(data, "expense_income_ratio", errors)
    if ratio is not None and ratio <= 0.0:
        errors.setdefault("expense_income_ratio", []).append(
            "expense_income_ratio must be greater than 0"
        )
    buffer = _number_or_error(data, "buffer_months", errors)
    if buffer is not None and buffer < 0.0:
        errors.setdefault("buffer_months", []).append("buffer_months must be non-negative")
    cost = _number_or_error(data, "conversion_cost", errors)
    if cost is not None and cost < 0.0:
        errors.setdefault("conversion_cost", []).append("conversion_cost must be non-negative")

    horizon = data["horizon_years"]
    if isinstance(horizon, bool) or not isinstance(horizon, int):
        errors.setdefault("horizon_years", []).append("horizon_years must be an integer")
    elif horizon not in SUPPORTED_HORIZON_YEARS:
        errors.setdefault("horizon_years", []).append(
            f"horizon_years must be one of {list(SUPPORTED_HORIZON_YEARS)}"
        )
    freq = data["rebalance_frequency"]
    if not isinstance(freq, str) or freq not in SUPPORTED_REBALANCE_FREQUENCIES:
        errors.setdefault("rebalance_frequency", []).append(
            f"rebalance_frequency must be one of {list(SUPPORTED_REBALANCE_FREQUENCIES)}"
        )
    if errors:
        raise HouseholdRequestError(errors)

    # 3. Reserve consistency
    if buffer > 0.0 and weights_raw is None:
        raise HouseholdRequestError(
            {"current_reserve_weights": ["current_reserve_weights_required"]}
        )
    if buffer == 0.0 and weights_raw is not None:
        raise HouseholdRequestError(
            {"current_reserve_weights": ["reserve_weights_without_reserve"]}
        )

    # 4. Supported-domain eligibility
    reasons: list[dict[str, Any]] = []
    if not (EXPENSE_INCOME_RATIO_MIN <= ratio <= EXPENSE_INCOME_RATIO_MAX):
        reasons.append(
            {
                "code": "expense_income_ratio_out_of_supported_range",
                "field": "expense_income_ratio",
                "supported": {"min": EXPENSE_INCOME_RATIO_MIN, "max": EXPENSE_INCOME_RATIO_MAX},
            }
        )
    if buffer == 0.0:
        reasons.append(
            {
                "code": "no_current_reserve",
                "field": "buffer_months",
                "supported": {"min": BUFFER_MONTHS_MIN, "max": BUFFER_MONTHS_MAX},
            }
        )
    elif not (BUFFER_MONTHS_MIN <= buffer <= BUFFER_MONTHS_MAX):
        reasons.append(
            {
                "code": "buffer_months_out_of_supported_range",
                "field": "buffer_months",
                "supported": {"min": BUFFER_MONTHS_MIN, "max": BUFFER_MONTHS_MAX},
            }
        )
    if cost > CONVERSION_COST_MAX:
        reasons.append(
            {
                "code": "conversion_cost_out_of_supported_range",
                "field": "conversion_cost",
                "supported": {"min": 0.0, "max": CONVERSION_COST_MAX},
            }
        )
    if reasons:
        raise UnsupportedScenarioError(reasons)

    return {
        "income_shares": vectors["income_shares"],
        "expense_shares": vectors["expense_shares"],
        "current_reserve_weights": weights,
        "expense_income_ratio": ratio,
        "buffer_months": buffer,
        "horizon_years": int(horizon),
        "rebalance_frequency": freq,
        "conversion_cost": cost,
    }


# ---------------------------------------------------------------------------
# Provenance and fingerprint
# ---------------------------------------------------------------------------


def live_provenance() -> dict[str, Any]:
    """Authoritative provenance from the engine's strict reader (no fallback)."""
    try:
        provenance = engine_provenance()
    except PersonalAnalysisProvenanceError as exc:
        raise ProvenanceUnavailableError(str(exc)) from exc
    if frozenset(provenance) != PROVENANCE_KEYS:
        raise ProvenanceUnavailableError("engine provenance has unexpected fields")
    return provenance


def snapshot_from_provenance(provenance: dict[str, Any]) -> dict[str, Any]:
    """Job-row snapshot captured at submission (with contract versions)."""
    return {
        **{field: provenance[field] for field in SNAPSHOT_FIELDS},
        "contract_version": CONTRACT_VERSION,
        "engine_interface_version": ENGINE_INTERFACE_VERSION,
    }


def snapshot_from_job(job: Any) -> dict[str, Any]:
    return {
        "model_version": job.model_version,
        "data_as_of": job.data_as_of,
        "dataset_sha256": job.dataset_sha256,
        "simulation_paths": job.simulation_paths,
        "simulation_seed": job.simulation_seed,
        "canonical_optimization_specification": job.canonical_optimization_specification,
        "contract_version": job.contract_version,
        "engine_interface_version": job.engine_interface_version,
    }


def canonical_json(value: Any) -> str:
    """Sorted, compact JSON; floats use Python's shortest round-trip repr."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def compute_household_fingerprint(normalized: dict[str, Any], provenance: dict[str, Any]) -> str:
    material = {
        "kind": HOUSEHOLD_JOB_KIND,
        "contract_version": CONTRACT_VERSION,
        "engine_interface_version": ENGINE_INTERFACE_VERSION,
        "request": normalized,
        **{field: provenance[field] for field in SNAPSHOT_FIELDS},
    }
    return hashlib.sha256(canonical_json(material).encode("utf-8")).hexdigest()


def assert_household_job_current(job: Any) -> dict[str, Any]:
    """Before computation: stored request, fingerprint and snapshot must match live provenance.

    Returns the live provenance. Raises ``HouseholdProvenanceChangedError`` on any
    drift and ``ProvenanceUnavailableError`` if provenance cannot be verified.
    """
    live = live_provenance()
    snapshot = snapshot_from_job(job)
    if snapshot != snapshot_from_provenance(live):
        raise HouseholdProvenanceChangedError("household job snapshot no longer matches")
    try:
        reparsed = parse_household_request(
            {"contract_version": CONTRACT_VERSION, **job.request_payload}
        )
    except (HouseholdRequestError, UnsupportedScenarioError) as exc:
        raise HouseholdProvenanceChangedError("stored request no longer validates") from exc
    if canonical_json(reparsed) != canonical_json(job.request_payload):
        raise HouseholdProvenanceChangedError("stored request is not canonical")
    if compute_household_fingerprint(reparsed, live) != job.request_fingerprint:
        raise HouseholdProvenanceChangedError("household job fingerprint no longer matches")
    return live


# ---------------------------------------------------------------------------
# Result validation (exact keys, atomic success)
# ---------------------------------------------------------------------------


def _fail(message: str) -> None:
    raise HouseholdResultValidationError(message)


def _exact_keys(obj: Any, keys: frozenset[str], label: str) -> dict[str, Any]:
    if not isinstance(obj, dict):
        _fail(f"{label} must be an object")
    if frozenset(obj) != keys:
        _fail(f"{label} has missing or unexpected fields")
    return obj


def _finite(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        _fail(f"{label} must be a non-boolean number")
    number = float(value)
    if not math.isfinite(number):
        _fail(f"{label} must be finite")
    return number


def _non_negative(value: Any, label: str) -> float:
    number = _finite(value, label)
    if number < 0.0:
        _fail(f"{label} must be non-negative")
    return number


def _probability(value: Any, label: str) -> float:
    number = _finite(value, label)
    if not 0.0 <= number <= 1.0:
        _fail(f"{label} must be within [0, 1]")
    return number


def _count(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        _fail(f"{label} must be a non-negative integer")
    return value


def _weights(value: Any, label: str) -> list[float]:
    try:
        return validate_share_vector(value, label)
    except PersonalAnalysisValidationError:
        _fail(f"{label} must be a valid weight vector")


def _validate_policy(policy: Any, label: str, *, expected_label: str, keys: frozenset[str]) -> dict:
    _exact_keys(policy, keys, label)
    if policy["label"] != expected_label:
        _fail(f"{label}.label mismatch")
    _weights(policy["weights"], f"{label}.weights")
    objective = _exact_keys(
        policy["objective"], frozenset({"cvar95_cumulative_shortfall"}), f"{label}.objective"
    )
    _non_negative(objective["cvar95_cumulative_shortfall"], f"{label}.objective.cvar95")
    diagnostics = _exact_keys(
        policy["diagnostics"],
        frozenset({"shortfall_probability", "var95_cumulative_shortfall"}),
        f"{label}.diagnostics",
    )
    _probability(diagnostics["shortfall_probability"], f"{label}.shortfall_probability")
    _non_negative(diagnostics["var95_cumulative_shortfall"], f"{label}.var95")
    impl = _exact_keys(
        policy["implementation_only"],
        frozenset(IMPLEMENTATION_ONLY_FIELDS),
        f"{label}.implementation_only",
    )
    for key in IMPLEMENTATION_ONLY_FIELDS:
        if key == "wealth_depletion_probability":
            _probability(impl[key], f"{label}.{key}")
        else:
            _non_negative(impl[key], f"{label}.{key}")
    return policy


def validate_household_result(
    result: Any,
    *,
    request: dict[str, Any],
    snapshot: dict[str, Any],
    live: dict[str, Any],
) -> None:
    """Exact-key validation of a complete result before success storage."""
    _exact_keys(result, RESULT_KEYS, "result")
    if result["contract_version"] != CONTRACT_VERSION:
        _fail("contract_version mismatch")
    if result["engine_interface_version"] != ENGINE_INTERFACE_VERSION:
        _fail("engine_interface_version mismatch")
    units = _exact_keys(
        result["units"], frozenset({"cumulative_shortfall", "terminal_wealth"}), "units"
    )
    if units["cumulative_shortfall"] != UNITS or units["terminal_wealth"] != UNITS:
        _fail("units mismatch")

    scenario = _exact_keys(result["scenario"], SCENARIO_KEYS, "scenario")
    if canonical_json(scenario) != canonical_json(request):
        _fail("scenario echo does not match the accepted request")
    if request["current_reserve_weights"] is None:
        _fail("successful results require current reserve weights")

    provenance = _exact_keys(result["provenance"], PROVENANCE_KEYS, "provenance")
    if provenance["fx_path_policy"] != FX_PATH_POLICY:
        _fail("fx_path_policy mismatch")
    if provenance != live:
        _fail("provenance does not match authoritative live provenance")
    if snapshot_from_provenance(provenance) != snapshot:
        _fail("provenance does not match the submission snapshot")

    current = _validate_policy(
        result["current_policy"],
        "current_policy",
        expected_label=CURRENT_POLICY_LABEL,
        keys=POLICY_KEYS,
    )
    if canonical_json(current["weights"]) != canonical_json(request["current_reserve_weights"]):
        _fail("current_policy.weights do not match the accepted request")

    optimized = _validate_policy(
        result["optimized_policy"],
        "optimized_policy",
        expected_label=OPTIMIZED_POLICY_LABEL,
        keys=POLICY_KEYS | {"identification"},
    )
    ident = _exact_keys(optimized["identification"], IDENTIFICATION_KEYS, "identification")
    if ident["applies_to"] != "optimization_surface":
        _fail("identification.applies_to mismatch")
    if ident["identification_class"] not in SUPPORTED_IDENTIFICATION_CLASSES:
        _fail("unsupported identification_class")
    n_coarse = _count(ident["n_coarse"], "n_coarse")
    n_refined = _count(ident["n_refined"], "n_refined")
    n_surface = _count(ident["n_surface"], "n_surface")
    near_count = _count(ident["near_optimal_1pct_count"], "near_optimal_1pct_count")
    near_frac = _probability(ident["near_optimal_1pct_frac"], "near_optimal_1pct_frac")
    if n_surface <= 0 or n_coarse <= 0 or n_surface > n_coarse + n_refined:
        _fail("surface counts are inconsistent")
    if near_count < 1 or near_count > n_surface:
        _fail("near_optimal_1pct_count is inconsistent")
    if not math.isclose(near_frac, near_count / n_surface, rel_tol=0.0, abs_tol=1e-12):
        _fail("near_optimal_1pct_frac is inconsistent")

    comparison = _exact_keys(result["comparison"], COMPARISON_KEYS, "comparison")
    if comparison["objective"] != "cvar95_cumulative_shortfall":
        _fail("comparison.objective mismatch")
    if comparison["direction"] != "lower_is_better":
        _fail("comparison.direction mismatch")
    if comparison["includes_initial_switching_cost"] is not False:
        _fail("comparison must exclude initial switching cost")
    tol = _finite(comparison["tie_absolute_tolerance"], "tie_absolute_tolerance")
    if tol != TIE_ABSOLUTE_TOLERANCE:
        _fail("tie_absolute_tolerance mismatch")
    expected_delta = (
        optimized["objective"]["cvar95_cumulative_shortfall"]
        - current["objective"]["cvar95_cumulative_shortfall"]
    )
    delta = _finite(comparison["cvar95_optimized_minus_current"], "comparison delta")
    if abs(delta - expected_delta) > DELTA_CONSISTENCY_ATOL:
        _fail("comparison delta does not equal optimized minus current CVaR95")
    if comparison["outcome"] != comparison_outcome(expected_delta):
        _fail("comparison outcome does not match the delta")

    json.dumps(result, allow_nan=False)


__all__ = [
    "CONTRACT_VERSION",
    "ENGINE_INTERFACE_VERSION",
    "HouseholdProvenanceChangedError",
    "HouseholdRequestError",
    "HouseholdResultValidationError",
    "ProvenanceUnavailableError",
    "SHARE_SUM_TOLERANCE",
    "UnsupportedScenarioError",
    "assert_household_job_current",
    "canonical_json",
    "compute_household_fingerprint",
    "live_provenance",
    "parse_household_request",
    "snapshot_from_job",
    "snapshot_from_provenance",
    "validate_household_result",
]
