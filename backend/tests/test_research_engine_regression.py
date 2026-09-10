"""Regression gates for the copied research calculation engine."""

from __future__ import annotations

import json
import math
import resource
import time

import numpy as np
import pytest

from research_engine import config, evaluate_allocation, optimize_allocation
from research_engine.api import (
    DATA_AS_OF,
    EngineValidationError,
    PRODUCTION_N_PATHS,
    PRODUCTION_SEED,
    generate_baseline_fx_levels,
)
from research_engine.household.cashflows import daily_paths_to_monthly_rates
from research_engine.optimization.evaluator import (
    load_or_generate_fx_levels,
    monthly_fx_for_horizon,
)
from research_engine.simulation.path_builder import returns_to_levels
from research_engine.simulation.stationary_bootstrap import StationaryBootstrapSimulator
from research_engine.simulation.validation import load_baseline_bundle

P2_CVAR = 1.1871802686857733
P2_PSHORT = 0.0491
P4_CVAR = 0.5082906243903793
P4_PSHORT = 0.0283
CVAR_ATOL = 1e-6
PSHORT_ATOL = 1e-4
ALL_KZT = [1.0, 0.0, 0.0]


def _assert_json_safe(payload: dict) -> None:
    json.dumps(payload)
    assert "expected_shortfall" not in payload
    assert "n_paths" not in payload
    assert "seed" not in payload
    for key, value in payload.items():
        assert not isinstance(value, np.ndarray), key
        assert not isinstance(value, np.generic), key
    for weight in payload["weights"]:
        assert isinstance(weight, float)
        assert math.isfinite(weight)


def _assert_model_metadata(payload: dict) -> None:
    assert payload["model_version"] == "1.0.0"
    assert payload["data_as_of"] == DATA_AS_OF
    assert payload["simulation_paths"] == PRODUCTION_N_PATHS == 10_000
    assert payload["simulation_seed"] == PRODUCTION_SEED == 42


def _assert_metrics(payload: dict, cvar: float, p_short: float) -> None:
    assert payload["weights"] == pytest.approx(ALL_KZT, abs=1e-12)
    assert payload["cvar95_cumulative_shortfall"] == pytest.approx(cvar, abs=CVAR_ATOL)
    assert payload["shortfall_probability"] == pytest.approx(p_short, abs=PSHORT_ATOL)
    assert math.isfinite(payload["var95_cumulative_shortfall"])
    assert math.isfinite(payload["mean_cumulative_shortfall"])


def test_fx_generator_uses_full_five_year_horizon(fx_bundle):
    levels, s0 = fx_bundle
    assert levels.shape == (config.OPT_N_PATHS, config.HORIZON_5Y_DAYS + 1, 2)
    assert s0.shape == (2,)
    assert np.all(np.isfinite(levels))
    assert np.all(levels > 0)


def test_horizon_slice_does_not_equal_direct_shorter_simulation(fx_bundle):
    """Protect the seeded 5Y-then-slice sequence used by the research results."""
    daily_5y, s0 = fx_bundle
    bundle = load_baseline_bundle()
    assert np.allclose(s0, bundle.s0)

    sim = StationaryBootstrapSimulator(expected_block_length=config.OPT_BLOCK_LENGTH)
    sim.fit(bundle.returns)
    direct_3y = returns_to_levels(
        sim.simulate(
            config.OPT_N_PATHS,
            config.HORIZON_3Y_DAYS,
            random_seed=config.OPT_RANDOM_SEED,
        ),
        bundle.s0,
    )
    sliced_3y = daily_5y[:, : config.HORIZON_3Y_DAYS + 1, :]
    assert sliced_3y.shape == (config.OPT_N_PATHS, config.HORIZON_3Y_DAYS + 1, 2)
    assert not np.allclose(sliced_3y, direct_3y)

    direct_1y = returns_to_levels(
        sim.simulate(
            config.OPT_N_PATHS,
            config.HORIZON_1Y_DAYS,
            random_seed=config.OPT_RANDOM_SEED,
        ),
        bundle.s0,
    )
    sliced_1y = daily_5y[:, : config.HORIZON_1Y_DAYS + 1, :]
    assert not np.allclose(sliced_1y, direct_1y)

    monthly_from_api = monthly_fx_for_horizon(daily_5y, 3)
    monthly_from_slice = daily_paths_to_monthly_rates(sliced_3y)
    assert np.allclose(monthly_from_api, monthly_from_slice)


def test_evaluate_p2_3y_all_kzt(fx_bundle):
    result = evaluate_allocation(
        "P2",
        ALL_KZT,
        horizon_years=3,
        _fx_bundle=fx_bundle,
    )
    _assert_json_safe(result)
    _assert_model_metadata(result)
    _assert_metrics(result, P2_CVAR, P2_PSHORT)
    assert result["profile"] == "P2_foreign_income_mismatch"
    assert result["horizon_years"] == 3


def test_evaluate_p4_3y_all_kzt(fx_bundle):
    result = evaluate_allocation(
        "P4",
        ALL_KZT,
        horizon_years=3,
        _fx_bundle=fx_bundle,
    )
    _assert_json_safe(result)
    _assert_model_metadata(result)
    _assert_metrics(result, P4_CVAR, P4_PSHORT)
    assert result["profile"] == "P4_full_multi_currency"


def test_evaluate_rejects_invalid_inputs(fx_bundle):
    with pytest.raises(EngineValidationError):
        evaluate_allocation("P2", [0.5, 0.5, 0.5], horizon_years=3, _fx_bundle=fx_bundle)
    with pytest.raises(EngineValidationError):
        evaluate_allocation("P2", [1.0, 0.0, 0.0], horizon_years=2, _fx_bundle=fx_bundle)
    with pytest.raises(EngineValidationError):
        evaluate_allocation("P2", [-0.1, 1.1, 0.0], horizon_years=3, _fx_bundle=fx_bundle)
    with pytest.raises(EngineValidationError):
        evaluate_allocation("P2", ALL_KZT, expense_income_ratio=1.5, _fx_bundle=fx_bundle)
    with pytest.raises(EngineValidationError):
        evaluate_allocation("P2", ALL_KZT, buffer_months=24, _fx_bundle=fx_bundle)


@pytest.mark.slow
def test_optimize_p2_3y(fx_bundle, benchmark_log):
    started = time.perf_counter()
    rss_before = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    result = optimize_allocation("P2", horizon_years=3, _fx_bundle=fx_bundle)
    elapsed = time.perf_counter() - started
    rss_after = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    benchmark_log["P2_3Y"] = {
        "seconds": elapsed,
        "ru_maxrss_before": rss_before,
        "ru_maxrss_after": rss_after,
        "ru_maxrss_units": "bytes_on_darwin",
    }
    _assert_json_safe(result)
    _assert_model_metadata(result)
    _assert_metrics(result, P2_CVAR, P2_PSHORT)
    assert result["identification_class"] == "A_WELL_IDENTIFIED"
    assert result["n_coarse"] == 1326
    assert result["n_refined"] == 199
    assert result["n_surface"] == 1473


@pytest.mark.slow
def test_optimize_p4_3y(fx_bundle, benchmark_log):
    started = time.perf_counter()
    rss_before = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    result = optimize_allocation("P4", horizon_years=3, _fx_bundle=fx_bundle)
    elapsed = time.perf_counter() - started
    rss_after = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    benchmark_log["P4_3Y"] = {
        "seconds": elapsed,
        "ru_maxrss_before": rss_before,
        "ru_maxrss_after": rss_after,
        "ru_maxrss_units": "bytes_on_darwin",
    }
    _assert_json_safe(result)
    _assert_model_metadata(result)
    _assert_metrics(result, P4_CVAR, P4_PSHORT)
    assert result["identification_class"] == "A_WELL_IDENTIFIED"
    assert result["n_coarse"] == 1326
    assert result["n_refined"] == 105
    assert result["n_surface"] == 1403


def test_production_generator_uses_full_five_year_path_length():
    levels, _s0 = generate_baseline_fx_levels(use_cache=False)
    assert levels.shape == (PRODUCTION_N_PATHS, config.HORIZON_5Y_DAYS + 1, 2)


def test_internal_small_draw_still_uses_five_year_horizon():
    """Internal helper may vary path count; horizon must remain 1,260 weekdays."""
    levels, _s0 = load_or_generate_fx_levels(n_paths=8, seed=42, use_cache=False)
    assert levels.shape[1] == config.HORIZON_5Y_DAYS + 1
