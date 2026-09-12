"""Buffer-sensitivity batch contract helpers (fingerprint, result assembly)."""

from __future__ import annotations

import hashlib
import json
import math
import re
from typing import Any

from research_engine.api import (
    PRODUCTION_N_PATHS,
    PRODUCTION_SEED,
    PROFILE_ALIASES,
    WEIGHT_SUM_ATOL,
)
from research_engine.household.profiles import PRIMARY_PROFILES

from .manifest import data_as_of, dataset_sha256, load_manifest, model_version

BUFFER_SENSITIVITY_CONTRACT_VERSION = "buffer_sensitivity_batch_v1"
BUFFER_SENSITIVITY_PRESENTATION_VERSION = "presentation_v1"
BUFFER_SENSITIVITY_JOB_KIND = "buffer_sensitivity_batch"
DOCUMENTED_BUFFERS: list[int] = [1, 3, 6, 12]
DOCUMENTED_BUFFER_MONTHS_FLOAT: list[float] = [1.0, 3.0, 6.0, 12.0]
UNITS_CUMULATIVE_SHORTFALL = "months_of_initial_monthly_income_I0_equals_1"
FX_PATH_POLICY = "deterministic_regeneration_per_public_optimize_call"

SUPPORTED_IDENTIFICATION_CLASSES = frozenset(
    {
        "A_WELL_IDENTIFIED",
        "B_WEAKLY_IDENTIFIED",
        "C_NOT_IDENTIFIED",
    }
)

IMPLEMENTATION_ONLY_FIELDS = (
    "mean_cumulative_shortfall",
    "wealth_depletion_probability",
    "mean_terminal_wealth",
    "median_terminal_wealth",
    "p05_terminal_wealth",
    "p95_terminal_wealth",
)

PROHIBITED_RESULT_FIELDS = (
    "resilience_score",
    "recommended_buffer",
    "optimal_buffer",
    "safe_buffer",
    "sufficient_buffer",
    "minimum_buffer",
    "minimum_tested_buffer",
    "near_optimal_kzt_range",
)

REQUIRED_TOP_LEVEL_KEYS = frozenset(
    {
        "contract_version",
        "presentation_version",
        "tested_buffers",
        "units",
        "provenance",
        "scenario",
        "results",
    }
)

REQUIRED_PROVENANCE_KEYS = frozenset(
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

REQUIRED_SCENARIO_KEYS = frozenset(
    {
        "profile",
        "horizon_years",
        "expense_income_ratio",
        "rebalance_frequency",
        "conversion_cost",
    }
)

REQUIRED_ROW_KEYS = frozenset(
    {
        "buffer_months",
        "weights",
        "shortfall_probability",
        "cvar95_cumulative_shortfall",
        "var95_cumulative_shortfall",
        "identification_class",
        "near_optimal_1pct_frac",
        "near_optimal_1pct_count",
        "n_coarse",
        "n_refined",
        "n_surface",
        "implementation_only",
    }
)

_SHA256_HEX_RE = re.compile(r"^[0-9a-fA-F]{64}$")


class BatchResultValidationError(ValueError):
    """Stored batch payload or optimizer echo failed contract validation."""


class ProvenanceChangedError(ValueError):
    """Queued job fingerprint no longer matches current model/data/contract."""


def normalize_batch_request_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Return deterministic scenario inputs without client buffer controls."""
    profile = str(payload["profile"]).strip()
    canonical = PROFILE_ALIASES.get(profile.upper(), profile)
    return {
        "profile": canonical if any(p.name == canonical for p in PRIMARY_PROFILES) else profile,
        "horizon_years": int(payload["horizon_years"]),
        "expense_income_ratio": float(payload["expense_income_ratio"]),
        "rebalance_frequency": str(payload["rebalance_frequency"]).lower().strip(),
        "conversion_cost": float(payload["conversion_cost"]),
    }


def compute_batch_fingerprint(normalized: dict[str, Any]) -> str:
    manifest = load_manifest()
    material = {
        "kind": BUFFER_SENSITIVITY_JOB_KIND,
        "contract_version": BUFFER_SENSITIVITY_CONTRACT_VERSION,
        "presentation_version": BUFFER_SENSITIVITY_PRESENTATION_VERSION,
        "request": normalized,
        "tested_buffers": list(DOCUMENTED_BUFFERS),
        "model_version": model_version(),
        "data_as_of": data_as_of(),
        "dataset_sha256": dataset_sha256(),
        "simulation_paths": PRODUCTION_N_PATHS,
        "simulation_seed": PRODUCTION_SEED,
        "canonical_optimization_specification": manifest.get(
            "canonical_optimization_specification"
        ),
    }
    encoded = json.dumps(material, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def assert_job_fingerprint_current(
    *,
    request_payload: dict[str, Any],
    request_fingerprint: str,
    model_version_value: str,
    data_as_of_value: str,
    contract_version_value: str,
) -> None:
    """Fail if queued job snapshot/provenance no longer matches current authority."""
    if model_version_value != model_version():
        raise ProvenanceChangedError("Batch job model version no longer matches")
    if data_as_of_value != data_as_of():
        raise ProvenanceChangedError("Batch job data date no longer matches")
    if contract_version_value != BUFFER_SENSITIVITY_CONTRACT_VERSION:
        raise ProvenanceChangedError("Batch job contract version no longer matches")
    expected = compute_batch_fingerprint(request_payload)
    if expected != request_fingerprint:
        raise ProvenanceChangedError("Batch job provenance no longer matches fingerprint")


def _require_finite_number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise BatchResultValidationError(f"Field '{field}' must be a finite non-boolean number")
    number = float(value)
    if not math.isfinite(number):
        raise BatchResultValidationError(f"Field '{field}' must be finite")
    return number


def _require_non_negative_number(value: Any, field: str) -> float:
    number = _require_finite_number(value, field)
    if number < 0.0:
        raise BatchResultValidationError(f"Field '{field}' must be non-negative")
    return number


def _require_probability(value: Any, field: str) -> float:
    number = _require_finite_number(value, field)
    if number < 0.0 or number > 1.0:
        raise BatchResultValidationError(f"Field '{field}' must be in [0, 1]")
    return number


def _require_non_negative_int(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise BatchResultValidationError(
            f"Field '{field}' must be a non-negative integer (not bool/float)"
        )
    if value < 0:
        raise BatchResultValidationError(f"Field '{field}' must be non-negative")
    return value


def _require_positive_int(value: Any, field: str) -> int:
    number = _require_non_negative_int(value, field)
    if number <= 0:
        raise BatchResultValidationError(f"Field '{field}' must be positive")
    return number


def _require_non_empty_str(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise BatchResultValidationError(f"Field '{field}' must be a non-empty string")
    return value


def _require_exact_int(value: Any, field: str, expected: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise BatchResultValidationError(f"Field '{field}' must be an integer")
    if value != expected:
        raise BatchResultValidationError(f"Field '{field}' must equal production constant")
    return value


def _require_exact_str(value: Any, field: str, expected: str) -> str:
    text = _require_non_empty_str(value, field)
    if text != expected:
        raise BatchResultValidationError(f"Field '{field}' must equal authoritative value")
    return text


def _exact_keys(obj: dict[str, Any], required: frozenset[str], *, label: str) -> None:
    keys = frozenset(obj.keys())
    missing = sorted(required - keys)
    unexpected = sorted(keys - required)
    if missing:
        raise BatchResultValidationError(f"{label} missing required fields")
    if unexpected:
        raise BatchResultValidationError(f"{label} contains unexpected fields")


def assert_optimize_response_matches_request(
    payload: dict[str, Any],
    *,
    scenario: dict[str, Any],
    buffer_months: float,
) -> None:
    """Verify one public optimize_allocation payload echoes the batch request."""
    if not isinstance(payload, dict):
        raise BatchResultValidationError("Optimizer response must be an object")
    checks = (
        ("profile", scenario["profile"], payload.get("profile")),
        ("horizon_years", int(scenario["horizon_years"]), payload.get("horizon_years")),
        (
            "expense_income_ratio",
            float(scenario["expense_income_ratio"]),
            payload.get("expense_income_ratio"),
        ),
        ("buffer_months", float(buffer_months), payload.get("buffer_months")),
        (
            "rebalance_frequency",
            scenario["rebalance_frequency"],
            payload.get("rebalance_frequency"),
        ),
        (
            "conversion_cost",
            float(scenario["conversion_cost"]),
            payload.get("conversion_cost"),
        ),
    )
    for _name, expected, observed in checks:
        if isinstance(expected, float):
            if not isinstance(observed, (int, float)) or isinstance(observed, bool):
                raise BatchResultValidationError("Optimizer response scenario mismatch")
            if not math.isclose(float(observed), float(expected), rel_tol=0.0, abs_tol=1e-12):
                raise BatchResultValidationError("Optimizer response scenario mismatch")
        elif observed != expected:
            raise BatchResultValidationError("Optimizer response scenario mismatch")


def assert_shared_production_provenance(
    payloads: list[dict[str, Any]],
    *,
    expected_model_version: str,
    expected_data_as_of: str,
) -> None:
    """Require identical authoritative provenance across all buffer responses."""
    if len(payloads) != len(DOCUMENTED_BUFFERS):
        raise BatchResultValidationError("Expected exactly four optimizer responses")

    for idx, payload in enumerate(payloads):
        if not isinstance(payload, dict):
            raise BatchResultValidationError("Optimizer response must be an object")
        _require_exact_str(
            payload.get("model_version"),
            f"responses[{idx}].model_version",
            expected_model_version,
        )
        _require_exact_str(
            payload.get("data_as_of"),
            f"responses[{idx}].data_as_of",
            expected_data_as_of,
        )
        _require_exact_int(
            payload.get("simulation_paths"),
            f"responses[{idx}].simulation_paths",
            PRODUCTION_N_PATHS,
        )
        _require_exact_int(
            payload.get("simulation_seed"),
            f"responses[{idx}].simulation_seed",
            PRODUCTION_SEED,
        )

    model_versions = {payload["model_version"] for payload in payloads}
    data_dates = {payload["data_as_of"] for payload in payloads}
    paths = {payload["simulation_paths"] for payload in payloads}
    seeds = {payload["simulation_seed"] for payload in payloads}
    if len(model_versions) != 1:
        raise BatchResultValidationError("Inconsistent model_version across responses")
    if len(data_dates) != 1:
        raise BatchResultValidationError("Inconsistent data_as_of across responses")
    if len(paths) != 1:
        raise BatchResultValidationError("Inconsistent simulation_paths across responses")
    if len(seeds) != 1:
        raise BatchResultValidationError("Inconsistent simulation_seed across responses")


def build_buffer_result_row(optimize_payload: dict[str, Any]) -> dict[str, Any]:
    """Map one public optimize_allocation payload into the batch result row."""
    for prohibited in PROHIBITED_RESULT_FIELDS:
        if prohibited in optimize_payload:
            raise BatchResultValidationError(
                "Prohibited field present in optimize payload"
            )

    implementation_only = {}
    for key in IMPLEMENTATION_ONLY_FIELDS:
        if key == "wealth_depletion_probability":
            implementation_only[key] = _require_probability(optimize_payload[key], key)
        else:
            implementation_only[key] = _require_non_negative_number(
                optimize_payload[key], key
            )
    weights_raw = optimize_payload.get("weights")
    if not isinstance(weights_raw, list):
        raise BatchResultValidationError("weights must be a list")
    weights = [
        _require_non_negative_number(w, f"weights[{idx}]")
        for idx, w in enumerate(weights_raw)
    ]
    row = {
        "buffer_months": _require_finite_number(
            optimize_payload["buffer_months"], "buffer_months"
        ),
        "weights": weights,
        "shortfall_probability": _require_probability(
            optimize_payload["shortfall_probability"], "shortfall_probability"
        ),
        "cvar95_cumulative_shortfall": _require_non_negative_number(
            optimize_payload["cvar95_cumulative_shortfall"],
            "cvar95_cumulative_shortfall",
        ),
        "var95_cumulative_shortfall": _require_non_negative_number(
            optimize_payload["var95_cumulative_shortfall"],
            "var95_cumulative_shortfall",
        ),
        "identification_class": str(optimize_payload["identification_class"]),
        "near_optimal_1pct_frac": _require_probability(
            optimize_payload["near_optimal_1pct_frac"], "near_optimal_1pct_frac"
        ),
        "near_optimal_1pct_count": _require_non_negative_int(
            optimize_payload["near_optimal_1pct_count"], "near_optimal_1pct_count"
        ),
        "n_coarse": _require_positive_int(optimize_payload["n_coarse"], "n_coarse"),
        "n_refined": _require_positive_int(optimize_payload["n_refined"], "n_refined"),
        "n_surface": _require_positive_int(optimize_payload["n_surface"], "n_surface"),
        "implementation_only": implementation_only,
    }
    for key in IMPLEMENTATION_ONLY_FIELDS:
        if key in row:
            raise BatchResultValidationError(
                "Implementation-only field duplicated outside nest"
            )
    return row


def build_batch_result_payload(
    *,
    scenario: dict[str, Any],
    buffer_rows: list[dict[str, Any]],
    provenance_source: dict[str, Any],
) -> dict[str, Any]:
    """Assemble the atomic succeeded batch payload."""
    if [row.get("buffer_months") for row in buffer_rows] != DOCUMENTED_BUFFER_MONTHS_FLOAT:
        raise BatchResultValidationError(
            "Batch results must be ordered exactly as documented buffers"
        )
    if not isinstance(provenance_source, dict):
        raise BatchResultValidationError("Optimizer provenance source must be an object")

    manifest = load_manifest()
    canonical_spec = manifest.get("canonical_optimization_specification")
    if not isinstance(canonical_spec, str) or not canonical_spec.strip():
        raise BatchResultValidationError("canonical_optimization_specification missing")

    model_ver = provenance_source.get("model_version")
    data_date = provenance_source.get("data_as_of")
    paths = provenance_source.get("simulation_paths")
    seed = provenance_source.get("simulation_seed")
    if model_ver is None or data_date is None or paths is None or seed is None:
        raise BatchResultValidationError("Optimizer provenance is incomplete")

    payload = {
        "contract_version": BUFFER_SENSITIVITY_CONTRACT_VERSION,
        "presentation_version": BUFFER_SENSITIVITY_PRESENTATION_VERSION,
        "tested_buffers": list(DOCUMENTED_BUFFERS),
        "units": {
            "cumulative_shortfall": UNITS_CUMULATIVE_SHORTFALL
        },
        "provenance": {
            "model_version": _require_exact_str(
                model_ver, "provenance.model_version", model_version()
            ),
            "data_as_of": _require_exact_str(
                data_date, "provenance.data_as_of", data_as_of()
            ),
            "dataset_sha256": dataset_sha256(),
            "simulation_paths": _require_exact_int(
                paths, "provenance.simulation_paths", PRODUCTION_N_PATHS
            ),
            "simulation_seed": _require_exact_int(
                seed, "provenance.simulation_seed", PRODUCTION_SEED
            ),
            "canonical_optimization_specification": canonical_spec,
            "fx_path_policy": FX_PATH_POLICY,
        },
        "scenario": {
            "profile": scenario["profile"],
            "horizon_years": int(scenario["horizon_years"]),
            "expense_income_ratio": float(scenario["expense_income_ratio"]),
            "rebalance_frequency": scenario["rebalance_frequency"],
            "conversion_cost": float(scenario["conversion_cost"]),
        },
        "results": buffer_rows,
    }
    for prohibited in PROHIBITED_RESULT_FIELDS:
        if prohibited in payload:
            raise BatchResultValidationError("Prohibited top-level field")
    validate_batch_result_payload(payload)
    return payload


def _validate_weights(weights: Any) -> None:
    if not isinstance(weights, list) or len(weights) != 3:
        raise BatchResultValidationError("weights must be a list of length 3")
    values = [_require_non_negative_number(w, f"weights[{idx}]") for idx, w in enumerate(weights)]
    if abs(sum(values) - 1.0) > WEIGHT_SUM_ATOL:
        raise BatchResultValidationError("weights must sum to 1")


def _validate_result_row(row: Any, *, expected_buffer: float) -> None:
    if not isinstance(row, dict):
        raise BatchResultValidationError("Buffer result row must be an object")
    _exact_keys(row, REQUIRED_ROW_KEYS, label="result row")
    for prohibited in PROHIBITED_RESULT_FIELDS:
        if prohibited in row:
            raise BatchResultValidationError("Prohibited field in buffer row")
    for key in IMPLEMENTATION_ONLY_FIELDS:
        if key in row:
            raise BatchResultValidationError("Implementation-only field leaked")

    buffer_months = _require_finite_number(row["buffer_months"], "buffer_months")
    if buffer_months != expected_buffer:
        raise BatchResultValidationError("buffer_months does not match documented order")

    _validate_weights(row["weights"])
    _require_probability(row["shortfall_probability"], "shortfall_probability")
    _require_non_negative_number(
        row["cvar95_cumulative_shortfall"], "cvar95_cumulative_shortfall"
    )
    _require_non_negative_number(
        row["var95_cumulative_shortfall"], "var95_cumulative_shortfall"
    )

    identification = row["identification_class"]
    if (
        not isinstance(identification, str)
        or identification not in SUPPORTED_IDENTIFICATION_CLASSES
    ):
        raise BatchResultValidationError("Unknown identification_class")

    _require_probability(row["near_optimal_1pct_frac"], "near_optimal_1pct_frac")
    near_count = _require_non_negative_int(
        row["near_optimal_1pct_count"], "near_optimal_1pct_count"
    )
    _require_positive_int(row["n_coarse"], "n_coarse")
    _require_positive_int(row["n_refined"], "n_refined")
    n_surface = _require_positive_int(row["n_surface"], "n_surface")
    if near_count > n_surface:
        raise BatchResultValidationError("near_optimal_1pct_count exceeds n_surface")

    impl = row["implementation_only"]
    if not isinstance(impl, dict):
        raise BatchResultValidationError("implementation_only must be an object")
    _exact_keys(impl, frozenset(IMPLEMENTATION_ONLY_FIELDS), label="implementation_only")
    for key in IMPLEMENTATION_ONLY_FIELDS:
        field = f"implementation_only.{key}"
        if key == "wealth_depletion_probability":
            _require_probability(impl[key], field)
        else:
            _require_non_negative_number(impl[key], field)


def _validate_provenance(provenance: Any) -> None:
    if not isinstance(provenance, dict):
        raise BatchResultValidationError("provenance must be an object")
    _exact_keys(provenance, REQUIRED_PROVENANCE_KEYS, label="provenance")
    _require_exact_str(
        provenance["model_version"], "provenance.model_version", model_version()
    )
    _require_exact_str(provenance["data_as_of"], "provenance.data_as_of", data_as_of())
    sha = provenance["dataset_sha256"]
    if not isinstance(sha, str) or not _SHA256_HEX_RE.fullmatch(sha):
        raise BatchResultValidationError("provenance.dataset_sha256 must be 64 hex chars")
    _require_exact_int(
        provenance["simulation_paths"],
        "provenance.simulation_paths",
        PRODUCTION_N_PATHS,
    )
    _require_exact_int(
        provenance["simulation_seed"],
        "provenance.simulation_seed",
        PRODUCTION_SEED,
    )
    _require_non_empty_str(
        provenance["canonical_optimization_specification"],
        "provenance.canonical_optimization_specification",
    )
    if provenance["fx_path_policy"] != FX_PATH_POLICY:
        raise BatchResultValidationError("provenance.fx_path_policy mismatch")


def _validate_scenario(scenario: Any) -> None:
    if not isinstance(scenario, dict):
        raise BatchResultValidationError("scenario must be an object")
    _exact_keys(scenario, REQUIRED_SCENARIO_KEYS, label="scenario")
    _require_non_empty_str(scenario["profile"], "scenario.profile")
    if isinstance(scenario["horizon_years"], bool) or not isinstance(
        scenario["horizon_years"], int
    ):
        raise BatchResultValidationError("scenario.horizon_years must be an integer")
    _require_finite_number(scenario["expense_income_ratio"], "scenario.expense_income_ratio")
    _require_non_empty_str(scenario["rebalance_frequency"], "scenario.rebalance_frequency")
    _require_finite_number(scenario["conversion_cost"], "scenario.conversion_cost")


def validate_batch_result_payload(result: dict[str, Any]) -> None:
    """Validate the full buffer_sensitivity_batch_v1 succeeded payload."""
    from .lifecycle import assert_json_safe_result

    if not isinstance(result, dict):
        raise BatchResultValidationError("Batch result must be an object")
    _exact_keys(result, REQUIRED_TOP_LEVEL_KEYS, label="batch result")
    for prohibited in PROHIBITED_RESULT_FIELDS:
        if prohibited in result:
            raise BatchResultValidationError("Prohibited top-level field")

    if result["contract_version"] != BUFFER_SENSITIVITY_CONTRACT_VERSION:
        raise BatchResultValidationError("Invalid batch contract_version")
    if result["presentation_version"] != BUFFER_SENSITIVITY_PRESENTATION_VERSION:
        raise BatchResultValidationError("Invalid presentation_version")
    if result["tested_buffers"] != DOCUMENTED_BUFFERS:
        raise BatchResultValidationError("Invalid tested_buffers")

    units = result["units"]
    if not isinstance(units, dict) or set(units.keys()) != {"cumulative_shortfall"}:
        raise BatchResultValidationError("Invalid units object")
    if units["cumulative_shortfall"] != UNITS_CUMULATIVE_SHORTFALL:
        raise BatchResultValidationError("Invalid cumulative_shortfall units")

    _validate_provenance(result["provenance"])
    _validate_scenario(result["scenario"])

    rows = result["results"]
    if not isinstance(rows, list) or len(rows) != len(DOCUMENTED_BUFFERS):
        raise BatchResultValidationError("Batch result must contain exactly four buffer rows")

    observed_buffers = []
    for row, expected in zip(rows, DOCUMENTED_BUFFER_MONTHS_FLOAT):
        _validate_result_row(row, expected_buffer=expected)
        observed_buffers.append(row["buffer_months"])

    if observed_buffers != DOCUMENTED_BUFFER_MONTHS_FLOAT:
        raise BatchResultValidationError("Buffer rows must be exactly [1.0, 3.0, 6.0, 12.0]")
    if len(set(observed_buffers)) != len(observed_buffers):
        raise BatchResultValidationError("Duplicate buffer rows are not allowed")

    assert_json_safe_result(result)
