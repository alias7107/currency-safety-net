
from __future__ import annotations

import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any, Sequence

import numpy as np

from . import config
from .api import (
    DATA_AS_OF,
    PRODUCTION_N_PATHS,
    PRODUCTION_SEED,
    SUPPORTED_HORIZON_YEARS,
    SUPPORTED_REBALANCE_FREQUENCIES,
    EngineValidationError,
    _resolve_fx_bundle,
    _validate_buffer_months,
    _validate_conversion_cost,
    _validate_expense_income_ratio,
    _validate_horizon,
    _validate_rebalance_frequency,
)
from .household.profiles import HouseholdProfile
from .optimization.evaluator import evaluate_weights, monthly_fx_for_horizon
from .robustness.optimize import make_cashflows, optimize_cell

CONTRACT_VERSION = "household_analysis_v1"
ENGINE_INTERFACE_VERSION = "personal_analysis_engine_v1"
UNITS = "months_of_initial_monthly_income_I0_equals_1"
FX_PATH_POLICY = "single_bundle_shared_by_both_policies"
CURRENT_POLICY_LABEL = "current_mix_under_selected_rebalancing"
OPTIMIZED_POLICY_LABEL = "lowest_cvar95_found_on_evaluated_grid"
PERSONAL_PROFILE_NAME = "custom_household"

# Mirrors HouseholdProfile.__post_init__ (left-to-right sum, 1e-12).
SHARE_SUM_TOLERANCE = 1e-12
# Comparison tie tolerance; equals the engine's zero-CVaR tolerance.
TIE_ABSOLUTE_TOLERANCE = float(config.OPT_CVAR_ZERO_TOL)

IMPLEMENTATION_ONLY_FIELDS = (
    "mean_cumulative_shortfall",
    "wealth_depletion_probability",
    "mean_terminal_wealth",
    "median_terminal_wealth",
    "p05_terminal_wealth",
    "p95_terminal_wealth",
)

_ENGINE_ROOT = Path(__file__).resolve().parent
_MANIFEST_PATH = _ENGINE_ROOT / "MODEL_MANIFEST.json"
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class PersonalAnalysisValidationError(EngineValidationError):
    """Invalid custom-household scenario arguments."""


class PersonalAnalysisProvenanceError(RuntimeError):
    """Authoritative model/data provenance is missing, invalid or inconsistent."""


# ---------------------------------------------------------------------------
# Strict validation adapter (no coercion, no defaults, no renormalization)
# ---------------------------------------------------------------------------


def canonical_number(value: Any, name: str) -> float:
    """Finite non-boolean int/float as ``float``; ``-0.0`` becomes ``0.0``."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PersonalAnalysisValidationError(f"{name} must be a finite number")
    number = float(value)
    if not math.isfinite(number):
        raise PersonalAnalysisValidationError(f"{name} must be finite")
    return 0.0 if number == 0.0 else number


def validate_share_vector(value: Any, name: str) -> list[float]:
    """Three non-negative entries (KZT, USD, EUR) summing to 1 within 1e-12.

    The sum uses ``(v0 + v1) + v2``, the same expression as
    ``HouseholdProfile.__post_init__``. Accepted values are returned unchanged
    apart from ``-0.0`` canonicalization; nothing is renormalized or snapped.
    """
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise PersonalAnalysisValidationError(f"{name} must contain exactly 3 numbers")
    values = [canonical_number(item, name) for item in value]
    if any(item < 0.0 for item in values):
        raise PersonalAnalysisValidationError(f"{name} entries must be non-negative")
    total = values[0] + values[1] + values[2]
    if abs(total - 1.0) > SHARE_SUM_TOLERANCE:
        raise PersonalAnalysisValidationError(f"{name} must sum to 1")
    return values


def _strict_int(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise PersonalAnalysisValidationError(f"{name} must be an integer")
    return int(value)


def _strict_choice(value: Any, name: str, allowed: Sequence[str]) -> str:
    if not isinstance(value, str) or value not in allowed:
        raise PersonalAnalysisValidationError(f"{name} must be one of {list(allowed)}")
    return value


def validate_household_inputs(
    *,
    income_shares: Any,
    expense_shares: Any,
    current_weights: Any,
    expense_income_ratio: Any,
    buffer_months: Any,
    horizon_years: Any,
    rebalance_frequency: Any,
    conversion_cost: Any,
) -> dict[str, Any]:
    """Validate and canonicalize facade inputs without coercion or defaults."""
    income = validate_share_vector(income_shares, "income_shares")
    expense = validate_share_vector(expense_shares, "expense_shares")
    weights = validate_share_vector(current_weights, "current_weights")
    ratio = canonical_number(expense_income_ratio, "expense_income_ratio")
    buffer = canonical_number(buffer_months, "buffer_months")
    cost = canonical_number(conversion_cost, "conversion_cost")
    horizon = _strict_int(horizon_years, "horizon_years")
    freq = _strict_choice(
        rebalance_frequency, "rebalance_frequency", SUPPORTED_REBALANCE_FREQUENCIES
    )

    # Existing range validators run only after strict checks, so their
    # coercion and default behaviour can never apply here.
    _validate_expense_income_ratio(ratio)
    _validate_buffer_months(buffer)
    _validate_conversion_cost(cost)
    if horizon not in SUPPORTED_HORIZON_YEARS:
        raise PersonalAnalysisValidationError(
            f"horizon_years must be one of {list(SUPPORTED_HORIZON_YEARS)}"
        )
    _validate_horizon(horizon)
    _validate_rebalance_frequency(freq)

    return {
        "income_shares": income,
        "expense_shares": expense,
        "current_weights": weights,
        "expense_income_ratio": ratio,
        "buffer_months": buffer,
        "horizon_years": horizon,
        "rebalance_frequency": freq,
        "conversion_cost": cost,
    }


def build_household_profile(income: Sequence[float], expense: Sequence[float]) -> HouseholdProfile:
    """Custom profile; ``HouseholdProfile`` remains the authoritative check."""
    try:
        return HouseholdProfile(PERSONAL_PROFILE_NAME, *income, *expense)
    except ValueError as exc:
        raise PersonalAnalysisValidationError(str(exc)) from exc


# ---------------------------------------------------------------------------
# Authoritative provenance (no fallbacks)
# ---------------------------------------------------------------------------


def _require_text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise PersonalAnalysisProvenanceError(f"{label} missing from model manifest")
    return value


def engine_provenance() -> dict[str, Any]:
    """Read and verify provenance from MODEL_MANIFEST.json and the dataset file.

    Unlike ``api._model_version``, this never falls back to a default value.
    """
    try:
        manifest = json.loads(_MANIFEST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PersonalAnalysisProvenanceError("model manifest unreadable") from exc
    if not isinstance(manifest, dict):
        raise PersonalAnalysisProvenanceError("model manifest must be an object")

    model_version = _require_text(manifest.get("model_version"), "model_version")
    spec = _require_text(
        manifest.get("canonical_optimization_specification"),
        "canonical_optimization_specification",
    )
    dataset = manifest.get("dataset")
    if not isinstance(dataset, dict):
        raise PersonalAnalysisProvenanceError("dataset missing from model manifest")
    data_as_of = _require_text(dataset.get("data_as_of"), "dataset.data_as_of")
    if data_as_of != DATA_AS_OF:
        raise PersonalAnalysisProvenanceError("manifest data_as_of disagrees with engine")
    dataset_sha = _require_text(dataset.get("target_sha256"), "dataset.target_sha256")
    if not _SHA256_RE.match(dataset_sha):
        raise PersonalAnalysisProvenanceError("dataset.target_sha256 is not a sha256 digest")
    relative = _require_text(dataset.get("relative_path"), "dataset.relative_path")
    dataset_path = (_ENGINE_ROOT / relative).resolve()
    if _ENGINE_ROOT not in dataset_path.parents:
        raise PersonalAnalysisProvenanceError("dataset path escapes the engine package")
    try:
        actual_sha = hashlib.sha256(dataset_path.read_bytes()).hexdigest()
    except OSError as exc:
        raise PersonalAnalysisProvenanceError("dataset file unreadable") from exc
    if actual_sha != dataset_sha:
        raise PersonalAnalysisProvenanceError("dataset file hash disagrees with manifest")
    if manifest.get("random_seed") != PRODUCTION_SEED:
        raise PersonalAnalysisProvenanceError("manifest seed disagrees with engine")
    if manifest.get("n_simulation_paths") != PRODUCTION_N_PATHS:
        raise PersonalAnalysisProvenanceError("manifest path count disagrees with engine")
    if manifest.get("simulation_horizon_days_generated") != int(config.HORIZON_5Y_DAYS):
        raise PersonalAnalysisProvenanceError("manifest generated horizon disagrees with engine")

    return {
        "model_version": model_version,
        "data_as_of": data_as_of,
        "dataset_sha256": dataset_sha,
        "simulation_paths": int(PRODUCTION_N_PATHS),
        "simulation_seed": int(PRODUCTION_SEED),
        "canonical_optimization_specification": spec,
        "fx_path_policy": FX_PATH_POLICY,
    }


# ---------------------------------------------------------------------------
# Computation
# ---------------------------------------------------------------------------


def _policy_summary(ev: Any) -> dict[str, Any]:
    return {
        "objective": {"cvar95_cumulative_shortfall": float(ev.cvar95)},
        "diagnostics": {
            "shortfall_probability": float(ev.shortfall_probability),
            "var95_cumulative_shortfall": float(ev.var95),
        },
        "implementation_only": {
            "mean_cumulative_shortfall": float(ev.expected_cumulative_shortfall),
            "wealth_depletion_probability": float(ev.wealth_depletion_probability),
            "mean_terminal_wealth": float(ev.mean_terminal_wealth),
            "median_terminal_wealth": float(ev.median_terminal_wealth),
            "p05_terminal_wealth": float(ev.p05_terminal_wealth),
            "p95_terminal_wealth": float(ev.p95_terminal_wealth),
        },
    }


def evaluate_current_policy(
    monthly_fx: np.ndarray,
    profile: HouseholdProfile,
    s0: np.ndarray,
    inputs: dict[str, Any],
) -> Any:
    """Current mix as starting allocation and rebalancing target (no snapping)."""
    cf, _e0, w0 = make_cashflows(
        profile, s0, inputs["expense_income_ratio"], inputs["buffer_months"]
    )
    return evaluate_weights(
        monthly_fx,
        cf,
        w0,
        np.array(inputs["current_weights"], dtype=float),
        rebalance_frequency=inputs["rebalance_frequency"],
        conversion_cost=inputs["conversion_cost"],
    )


def comparison_outcome(delta: float) -> str:
    if abs(delta) <= TIE_ABSOLUTE_TOLERANCE:
        return "equal_within_tolerance"
    return "optimized_lower" if delta < 0.0 else "current_lower"


def analyze_household(
    *,
    income_shares: Sequence[float],
    expense_shares: Sequence[float],
    current_weights: Sequence[float],
    expense_income_ratio: float,
    buffer_months: float,
    horizon_years: int,
    rebalance_frequency: str,
    conversion_cost: float,
    _fx_bundle: tuple[np.ndarray, np.ndarray] | None = None,
) -> dict[str, Any]:
    """Evaluate the current mix and optimize CVaR95 on one shared FX bundle.

    Returns JSON-safe scalars and lists only. The optimized policy is the
    lowest-CVaR95 allocation found on the evaluated grid; the current mix is
    not added to the identification surface, and no switching cost is charged.
    """
    inputs = validate_household_inputs(
        income_shares=income_shares,
        expense_shares=expense_shares,
        current_weights=current_weights,
        expense_income_ratio=expense_income_ratio,
        buffer_months=buffer_months,
        horizon_years=horizon_years,
        rebalance_frequency=rebalance_frequency,
        conversion_cost=conversion_cost,
    )
    provenance = engine_provenance()
    profile = build_household_profile(inputs["income_shares"], inputs["expense_shares"])

    daily_levels, s0 = _resolve_fx_bundle(_fx_bundle)
    monthly = monthly_fx_for_horizon(daily_levels, inputs["horizon_years"])

    ev_current = evaluate_current_policy(monthly, profile, s0, inputs)
    cell = optimize_cell(
        monthly,
        profile,
        s0,
        expense_income_ratio=inputs["expense_income_ratio"],
        buffer_months=inputs["buffer_months"],
        rebalance_frequency=inputs["rebalance_frequency"],
        conversion_cost=inputs["conversion_cost"],
    )

    if engine_provenance() != provenance:
        raise PersonalAnalysisProvenanceError("provenance changed during computation")

    current = _policy_summary(ev_current)
    optimized = _policy_summary(cell.ev_star)
    delta = (
        optimized["objective"]["cvar95_cumulative_shortfall"]
        - current["objective"]["cvar95_cumulative_shortfall"]
    )
    opt_row = cell.opt_row

    return {
        "contract_version": CONTRACT_VERSION,
        "engine_interface_version": ENGINE_INTERFACE_VERSION,
        "units": {"cumulative_shortfall": UNITS, "terminal_wealth": UNITS},
        "scenario": {
            "income_shares": list(inputs["income_shares"]),
            "expense_shares": list(inputs["expense_shares"]),
            "current_reserve_weights": list(inputs["current_weights"]),
            "expense_income_ratio": inputs["expense_income_ratio"],
            "buffer_months": inputs["buffer_months"],
            "horizon_years": inputs["horizon_years"],
            "rebalance_frequency": inputs["rebalance_frequency"],
            "conversion_cost": inputs["conversion_cost"],
        },
        "provenance": provenance,
        "current_policy": {
            "label": CURRENT_POLICY_LABEL,
            "weights": list(inputs["current_weights"]),
            **current,
        },
        "optimized_policy": {
            "label": OPTIMIZED_POLICY_LABEL,
            "weights": [float(x) for x in np.asarray(cell.w_star, dtype=float).reshape(3)],
            **optimized,
            "identification": {
                "applies_to": "optimization_surface",
                "identification_class": str(cell.identification_class),
                "n_coarse": int(opt_row["n_coarse"]),
                "n_refined": int(opt_row["n_refined"]),
                "n_surface": int(opt_row["n_surface"]),
                "near_optimal_1pct_count": int(opt_row["near_optimal_1pct_count"]),
                "near_optimal_1pct_frac": float(opt_row["near_optimal_1pct_frac"]),
            },
        },
        "comparison": {
            "objective": "cvar95_cumulative_shortfall",
            "direction": "lower_is_better",
            "cvar95_optimized_minus_current": float(delta),
            "outcome": comparison_outcome(delta),
            "tie_absolute_tolerance": TIE_ABSOLUTE_TOLERANCE,
            "includes_initial_switching_cost": False,
        },
    }
