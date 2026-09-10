"""JSON-safe public API for the copied research calculation engine.

Django and other callers must use only ``evaluate_allocation`` and
``optimize_allocation``. Path-level arrays stay internal.

Production calculations always use ``n_paths=10000`` and ``seed=42``.
Those values are not public request parameters; tests may inject
``_fx_bundle`` only.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np

from . import config
from .household.profiles import PRIMARY_PROFILES, HouseholdProfile
from .optimization.evaluator import (
    evaluate_weights,
    load_or_generate_fx_levels,
    monthly_fx_for_horizon,
)
from .robustness.optimize import optimize_cell

SUPPORTED_HORIZON_YEARS = tuple(config.HH_HORIZON_YEARS)
SUPPORTED_REBALANCE_FREQUENCIES = tuple(config.ROB_REBALANCE_FREQS)
EXPENSE_INCOME_RATIO_MIN = float(min(config.HH_EXPENSE_INCOME_RATIOS))
EXPENSE_INCOME_RATIO_MAX = float(max(config.HH_EXPENSE_INCOME_RATIOS))
BUFFER_MONTHS_MIN = float(min(config.HH_BUFFER_MONTHS))
BUFFER_MONTHS_MAX = float(max(config.HH_BUFFER_MONTHS))
CONVERSION_COST_MIN = 0.0
CONVERSION_COST_MAX = float(max(config.ROB_CONVERSION_COSTS))
WEIGHT_SUM_ATOL = 1e-10
PRODUCTION_N_PATHS = int(config.OPT_N_PATHS)
PRODUCTION_SEED = int(config.OPT_RANDOM_SEED)
DATA_AS_OF = "2025-12-31"
PROFILE_ALIASES = {
    "P1": "P1_local_control",
    "P2": "P2_foreign_income_mismatch",
    "P3": "P3_mixed_income",
    "P4": "P4_full_multi_currency",
}


class EngineValidationError(ValueError):
    """Invalid public-API arguments."""


def _model_version() -> str:
    manifest = Path(__file__).resolve().parent / "MODEL_MANIFEST.json"
    try:
        return str(json.loads(manifest.read_text(encoding="utf-8"))["model_version"])
    except (OSError, KeyError, json.JSONDecodeError, TypeError):
        return "1.0.0"


def generate_baseline_fx_levels(
    *,
    use_cache: bool = False,
) -> tuple[np.ndarray, np.ndarray]:
    """Generate the verified 5-year, 1,260-weekday path set, then callers slice.

    Always uses the production path count and seed. Do not simulate 252 or 756
    days directly: that changes the seeded random sequence.
    """
    levels, s0 = load_or_generate_fx_levels(
        n_paths=PRODUCTION_N_PATHS,
        seed=PRODUCTION_SEED,
        use_cache=use_cache,
    )
    expected_days = int(config.HORIZON_5Y_DAYS) + 1
    if levels.shape[1] != expected_days:
        raise RuntimeError(
            "FX generator must produce the full 5-year path including t=0 "
            f"(expected {expected_days} levels, got {levels.shape[1]})"
        )
    return levels, s0


def evaluate_allocation(
    profile: str,
    weights: Sequence[float],
    horizon_years: int = 3,
    expense_income_ratio: float | None = None,
    buffer_months: float | None = None,
    rebalance_frequency: str | None = None,
    conversion_cost: float | None = None,
    *,
    _fx_bundle: tuple[np.ndarray, np.ndarray] | None = None,
) -> dict[str, Any]:
    """Evaluate one allocation. Returns JSON-safe scalars and lists only."""
    profile_obj = _resolve_profile(profile)
    w = _validate_weights(weights)
    years = _validate_horizon(horizon_years)
    ei = _validate_expense_income_ratio(expense_income_ratio)
    buf = _validate_buffer_months(buffer_months)
    freq = _validate_rebalance_frequency(rebalance_frequency)
    cost = _validate_conversion_cost(conversion_cost)
    daily_levels, s0 = _resolve_fx_bundle(_fx_bundle)
    monthly = monthly_fx_for_horizon(daily_levels, years)
    cf, _e0, w0 = _cashflows(profile_obj, s0, ei, buf)
    ev = evaluate_weights(
        monthly,
        cf,
        w0,
        w,
        rebalance_frequency=freq,
        conversion_cost=cost,
    )
    return _evaluation_payload(
        profile_obj=profile_obj,
        horizon_years=years,
        weights=w,
        expense_income_ratio=ei,
        buffer_months=buf,
        rebalance_frequency=freq,
        conversion_cost=cost,
        ev=ev,
    )


def optimize_allocation(
    profile: str,
    horizon_years: int = 3,
    expense_income_ratio: float | None = None,
    buffer_months: float | None = None,
    rebalance_frequency: str | None = None,
    conversion_cost: float | None = None,
    *,
    _fx_bundle: tuple[np.ndarray, np.ndarray] | None = None,
) -> dict[str, Any]:
    """Optimize weights by delegating to the copied ``optimize_cell`` routine."""
    profile_obj = _resolve_profile(profile)
    years = _validate_horizon(horizon_years)
    ei = _validate_expense_income_ratio(expense_income_ratio)
    buf = _validate_buffer_months(buffer_months)
    freq = _validate_rebalance_frequency(rebalance_frequency)
    cost = _validate_conversion_cost(conversion_cost)
    daily_levels, s0 = _resolve_fx_bundle(_fx_bundle)
    monthly = monthly_fx_for_horizon(daily_levels, years)
    cell = optimize_cell(
        monthly,
        profile_obj,
        s0,
        expense_income_ratio=ei,
        buffer_months=buf,
        rebalance_frequency=freq,
        conversion_cost=cost,
    )
    payload = _evaluation_payload(
        profile_obj=profile_obj,
        horizon_years=years,
        weights=np.asarray(cell.w_star, dtype=float),
        expense_income_ratio=ei,
        buffer_months=buf,
        rebalance_frequency=freq,
        conversion_cost=cost,
        ev=cell.ev_star,
    )
    payload["identification_class"] = str(cell.identification_class)
    payload["n_coarse"] = int(cell.opt_row["n_coarse"])
    payload["n_refined"] = int(cell.opt_row["n_refined"])
    payload["n_surface"] = int(cell.opt_row["n_surface"])
    payload["near_optimal_1pct_frac"] = _as_float(cell.opt_row["near_optimal_1pct_frac"])
    payload["near_optimal_1pct_count"] = int(cell.opt_row["near_optimal_1pct_count"])
    return payload


def _resolve_fx_bundle(
    fx_bundle: tuple[np.ndarray, np.ndarray] | None,
) -> tuple[np.ndarray, np.ndarray]:
    if fx_bundle is not None:
        levels, s0 = fx_bundle
        expected_days = int(config.HORIZON_5Y_DAYS) + 1
        if np.asarray(levels).shape[1] != expected_days:
            raise EngineValidationError(
                "Internal FX bundle must contain the full 5-year path "
                f"(expected {expected_days} levels including t=0)"
            )
        if np.asarray(levels).shape[0] != PRODUCTION_N_PATHS:
            raise EngineValidationError(
                "Internal FX bundle must use the production path count "
                f"({PRODUCTION_N_PATHS})"
            )
        return levels, s0
    return generate_baseline_fx_levels(use_cache=False)


def _cashflows(profile: HouseholdProfile, s0: np.ndarray, ei: float, buffer_months: float):
    from .household.cashflows import nominal_cashflows

    i0 = float(config.OPT_I0)
    e0 = ei * i0
    w0 = buffer_months * e0
    cf = nominal_cashflows(profile, i0, e0, float(s0[0]), float(s0[1]))
    return cf, e0, w0


def _resolve_profile(profile: str) -> HouseholdProfile:
    if not isinstance(profile, str) or not profile.strip():
        raise EngineValidationError("profile must be a non-empty string")
    raw = profile.strip()
    name = PROFILE_ALIASES.get(raw.upper(), raw)
    for item in PRIMARY_PROFILES:
        if item.name == name or item.name.lower() == name.lower():
            _assert_share_simplex(
                [item.qI_kzt, item.qI_usd, item.qI_eur],
                label="income shares",
            )
            _assert_share_simplex(
                [item.qE_kzt, item.qE_usd, item.qE_eur],
                label="expense shares",
            )
            return item
    known = ", ".join([p.name for p in PRIMARY_PROFILES])
    raise EngineValidationError(f"unknown profile {profile!r}; known: {known}")


def _validate_horizon(horizon_years: int) -> int:
    try:
        years = int(horizon_years)
    except (TypeError, ValueError) as exc:
        raise EngineValidationError("horizon_years must be an integer") from exc
    if years not in SUPPORTED_HORIZON_YEARS:
        raise EngineValidationError(
            f"horizon_years must be one of {SUPPORTED_HORIZON_YEARS}"
        )
    return years


def _validate_expense_income_ratio(value: float | None) -> float:
    ratio = config.OPT_EXPENSE_INCOME_RATIO if value is None else value
    ratio = _as_float(ratio, name="expense_income_ratio")
    if ratio < EXPENSE_INCOME_RATIO_MIN or ratio > EXPENSE_INCOME_RATIO_MAX:
        raise EngineValidationError(
            "expense_income_ratio must be between "
            f"{EXPENSE_INCOME_RATIO_MIN} and {EXPENSE_INCOME_RATIO_MAX}"
        )
    return ratio


def _validate_buffer_months(value: float | None) -> float:
    buf = float(config.OPT_BUFFER_MONTHS) if value is None else value
    buf = _as_float(buf, name="buffer_months")
    if buf < BUFFER_MONTHS_MIN or buf > BUFFER_MONTHS_MAX:
        raise EngineValidationError(
            "buffer_months must be between "
            f"{BUFFER_MONTHS_MIN} and {BUFFER_MONTHS_MAX}"
        )
    return buf


def _validate_rebalance_frequency(value: str | None) -> str:
    freq = config.HH_REBALANCE_FREQUENCY if value is None else value
    if not isinstance(freq, str):
        raise EngineValidationError("rebalance_frequency must be a string")
    freq = freq.lower().strip()
    if freq not in SUPPORTED_REBALANCE_FREQUENCIES:
        raise EngineValidationError(
            f"rebalance_frequency must be one of {SUPPORTED_REBALANCE_FREQUENCIES}"
        )
    return freq


def _validate_conversion_cost(value: float | None) -> float:
    cost = config.HH_CONVERSION_COST if value is None else value
    cost = _as_float(cost, name="conversion_cost")
    if cost < CONVERSION_COST_MIN or cost > CONVERSION_COST_MAX:
        raise EngineValidationError(
            "conversion_cost must be between "
            f"{CONVERSION_COST_MIN} and {CONVERSION_COST_MAX}"
        )
    return cost


def _validate_weights(weights: Sequence[float]) -> np.ndarray:
    if isinstance(weights, Mapping):
        try:
            raw = [weights["kzt"], weights["usd"], weights["eur"]]
        except KeyError as exc:
            raise EngineValidationError(
                "weights mapping must contain kzt, usd, and eur"
            ) from exc
    else:
        try:
            raw = list(weights)
        except TypeError as exc:
            raise EngineValidationError("weights must be a sequence of 3 numbers") from exc
    if len(raw) != 3:
        raise EngineValidationError("weights must have length 3: [kzt, usd, eur]")
    w = np.array([_as_float(v, name="weights") for v in raw], dtype=float)
    if np.any(~np.isfinite(w)):
        raise EngineValidationError("weights must be finite")
    if np.any(w < -1e-15):
        raise EngineValidationError("weights must be nonnegative")
    if abs(float(w.sum()) - 1.0) > WEIGHT_SUM_ATOL:
        raise EngineValidationError("weights must sum to 1")
    w = np.maximum(w, 0.0)
    w = w / w.sum()
    return w


def _assert_share_simplex(shares: Sequence[float], label: str) -> None:
    vals = [_as_float(v, name=label) for v in shares]
    if any(v < -1e-15 for v in vals):
        raise EngineValidationError(f"{label} must be nonnegative")
    if abs(sum(vals) - 1.0) > WEIGHT_SUM_ATOL:
        raise EngineValidationError(f"{label} must sum to 1")


def _as_float(value: Any, name: str = "value") -> float:
    try:
        out = float(value)
    except (TypeError, ValueError) as exc:
        raise EngineValidationError(f"{name} must be a number") from exc
    if not math.isfinite(out):
        raise EngineValidationError(f"{name} must be finite")
    return out


def _json_number(value: Any) -> float:
    return float(np.asarray(value, dtype=float).reshape(-1)[0])


def _json_weights(weights: np.ndarray) -> list[float]:
    return [float(x) for x in np.asarray(weights, dtype=float).reshape(3)]


def _evaluation_payload(
    *,
    profile_obj: HouseholdProfile,
    horizon_years: int,
    weights: np.ndarray,
    expense_income_ratio: float,
    buffer_months: float,
    rebalance_frequency: str,
    conversion_cost: float,
    ev: Any,
) -> dict[str, Any]:
    payload = {
        "model_version": _model_version(),
        "data_as_of": DATA_AS_OF,
        "simulation_paths": PRODUCTION_N_PATHS,
        "simulation_seed": PRODUCTION_SEED,
        "profile": str(profile_obj.name),
        "horizon_years": int(horizon_years),
        "weights": _json_weights(weights),
        "expense_income_ratio": float(expense_income_ratio),
        "buffer_months": float(buffer_months),
        "rebalance_frequency": str(rebalance_frequency),
        "conversion_cost": float(conversion_cost),
        "shortfall_probability": _json_number(ev.shortfall_probability),
        "var95_cumulative_shortfall": _json_number(ev.var95),
        "cvar95_cumulative_shortfall": _json_number(ev.cvar95),
        "mean_cumulative_shortfall": _json_number(ev.expected_cumulative_shortfall),
        "wealth_depletion_probability": _json_number(ev.wealth_depletion_probability),
        "mean_terminal_wealth": _json_number(ev.mean_terminal_wealth),
        "median_terminal_wealth": _json_number(ev.median_terminal_wealth),
        "p05_terminal_wealth": _json_number(ev.p05_terminal_wealth),
        "p95_terminal_wealth": _json_number(ev.p95_terminal_wealth),
    }
    return payload
