
from __future__ import annotations

import json
import shutil
import time
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from calculations.household_contract import (
    live_provenance,
    parse_household_request,
    snapshot_from_provenance,
    validate_household_result,
)
from research_engine import analyze_household, config, evaluate_allocation
from research_engine import personal
from research_engine.api import EngineValidationError
from research_engine.household.profiles import PRIMARY_PROFILES
from research_engine.optimization.evaluator import monthly_fx_for_horizon
from research_engine.personal import (
    PersonalAnalysisProvenanceError,
    build_household_profile,
    engine_provenance,
    evaluate_current_policy,
    validate_household_inputs,
)
from research_engine.simulation.path_builder import returns_to_levels

P2_CVAR = 1.1871802686857733
P2_PSHORT = 0.0491
P4_CVAR = 0.5082906243903793
P4_PSHORT = 0.0283
CVAR_ATOL = 1e-6
PSHORT_ATOL = 1e-4


def scenario(**overrides):
    base = dict(
        income_shares=[0.3, 0.6, 0.1],
        expense_shares=[0.8, 0.0, 0.2],
        current_weights=[0.25, 0.5, 0.25],
        expense_income_ratio=0.95,
        buffer_months=3.0,
        horizon_years=1,
        rebalance_frequency="monthly",
        conversion_cost=0.0025,
    )
    base.update(overrides)
    return base


def request_for(kwargs):
    body = {
        "contract_version": personal.CONTRACT_VERSION,
        **{k: v for k, v in kwargs.items() if k != "current_weights"},
        "current_reserve_weights": kwargs["current_weights"],
    }
    return parse_household_request(body)


@pytest.fixture
def synthetic_bundle(monkeypatch):
    """Small deterministic 5-year bundle; counts resolver calls (test-only)."""
    rng = np.random.default_rng(20261111)
    returns = 0.009 * rng.standard_normal((48, config.HORIZON_5Y_DAYS, 2))
    levels = returns_to_levels(returns, np.array([502.57, 591.68]))
    s0 = levels[0, 0, :].copy()
    calls = {"count": 0}

    def resolver(_bundle):
        calls["count"] += 1
        return levels, s0

    monkeypatch.setattr(personal, "_resolve_fx_bundle", resolver)
    return calls


def _validate(result, kwargs):
    live = live_provenance()
    validate_household_result(
        result,
        request=request_for(kwargs),
        snapshot=snapshot_from_provenance(live),
        live=live,
    )


# ---------------------------------------------------------------------------
# Strict facade validation (no bundle is resolved for rejected input)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "overrides",
    [
        {"income_shares": [True, 0.0, 0.0]},
        {"expense_shares": ["1", 0.0, 0.0]},
        {"current_weights": [0.5, 0.5]},
        {"current_weights": [0.5, 0.5 + 2e-12, 0.0]},
        {"current_weights": None},
        {"expense_income_ratio": None},
        {"expense_income_ratio": "0.95"},
        {"expense_income_ratio": 0.7},
        {"buffer_months": True},
        {"buffer_months": 0.0},
        {"buffer_months": 13.0},
        {"horizon_years": 3.0},
        {"horizon_years": 2},
        {"rebalance_frequency": "MONTHLY"},
        {"conversion_cost": 0.02},
        {"conversion_cost": float("nan")},
    ],
)
def test_facade_rejects_invalid_inputs_before_any_paths(monkeypatch, overrides):
    def forbidden(_bundle):
        raise AssertionError("bundle must not be resolved for invalid input")

    monkeypatch.setattr(personal, "_resolve_fx_bundle", forbidden)
    with pytest.raises(EngineValidationError):
        analyze_household(**scenario(**overrides))


def test_facade_requires_every_argument():
    kwargs = scenario()
    kwargs.pop("conversion_cost")
    with pytest.raises(TypeError):
        analyze_household(**kwargs)


def test_validation_preserves_values_without_renormalization():
    weights = [0.25, 0.5, 0.25 + 5e-13]
    out = validate_household_inputs(**scenario(current_weights=weights, income_shares=weights))
    assert out["current_weights"] == weights
    assert out["income_shares"] == weights
    build_household_profile(out["income_shares"], out["expense_shares"])


# ---------------------------------------------------------------------------
# Synthetic-bundle wiring tests (real optimize_cell, small paths, 1-year)
# ---------------------------------------------------------------------------


def test_one_bundle_shared_by_both_policies_and_json_safe(monkeypatch, synthetic_bundle):
    seen = {}
    real_eval = personal.evaluate_current_policy
    real_opt = personal.optimize_cell

    def spy_eval(monthly, profile, s0, inputs):
        seen["eval_monthly"] = monthly
        seen["eval_profile"] = profile
        return real_eval(monthly, profile, s0, inputs)

    def spy_opt(monthly, profile, s0, **kwargs):
        seen["opt_monthly"] = monthly
        seen["opt_profile"] = profile
        seen["opt_kwargs"] = kwargs
        return real_opt(monthly, profile, s0, **kwargs)

    monkeypatch.setattr(personal, "evaluate_current_policy", spy_eval)
    monkeypatch.setattr(personal, "optimize_cell", spy_opt)

    kwargs = scenario()
    result = analyze_household(**kwargs)

    assert synthetic_bundle["count"] == 1
    assert seen["eval_monthly"] is seen["opt_monthly"]
    assert seen["eval_profile"] is seen["opt_profile"]
    assert seen["eval_profile"].name == "custom_household"
    assert "weights" not in seen["opt_kwargs"]  # current mix never joins the surface
    assert set(seen["opt_kwargs"]) == {
        "expense_income_ratio",
        "buffer_months",
        "rebalance_frequency",
        "conversion_cost",
    }
    encoded = json.dumps(result, allow_nan=False)
    assert "ndarray" not in encoded
    assert result["current_policy"]["weights"] == kwargs["current_weights"]
    assert result["scenario"]["current_reserve_weights"] == kwargs["current_weights"]
    assert result["optimized_policy"]["identification"]["applies_to"] == "optimization_surface"
    assert "identification" not in result["current_policy"]
    assert result["comparison"]["includes_initial_switching_cost"] is False
    _validate(result, kwargs)


def test_same_policy_consistency(synthetic_bundle):
    first = analyze_household(**scenario())
    optimized_weights = first["optimized_policy"]["weights"]
    kwargs = scenario(current_weights=optimized_weights)
    second = analyze_household(**kwargs)
    assert second["optimized_policy"] == first["optimized_policy"]
    assert (
        second["current_policy"]["objective"] == second["optimized_policy"]["objective"]
    )
    assert second["comparison"]["cvar95_optimized_minus_current"] == 0.0
    assert second["comparison"]["outcome"] == "equal_within_tolerance"
    _validate(second, kwargs)


def _fake_eval(cvar):
    return SimpleNamespace(
        cvar95=cvar,
        var95=0.1,
        shortfall_probability=0.05,
        expected_cumulative_shortfall=0.02,
        wealth_depletion_probability=0.01,
        mean_terminal_wealth=5.0,
        median_terminal_wealth=4.5,
        p05_terminal_wealth=1.0,
        p95_terminal_wealth=9.0,
    )


def _fake_cell(cvar):
    return SimpleNamespace(
        ev_star=_fake_eval(cvar),
        w_star=np.array([1.0, 0.0, 0.0]),
        identification_class="B_WEAKLY_IDENTIFIED",
        opt_row=pd.Series(
            {
                "n_coarse": 1326,
                "n_refined": 10,
                "n_surface": 1330,
                "near_optimal_1pct_count": 4,
                "near_optimal_1pct_frac": 4 / 1330,
            }
        ),
    )


@pytest.mark.parametrize(
    "current_cvar,optimized_cvar,outcome",
    [
        (0.20, 0.35, "current_lower"),  # off-grid current mix beats the surface
        (0.50, 0.50 + 4e-9, "equal_within_tolerance"),
        (0.50, 0.30, "optimized_lower"),
    ],
)
def test_outcomes_report_measured_values_honestly(
    monkeypatch, synthetic_bundle, current_cvar, optimized_cvar, outcome
):
    monkeypatch.setattr(personal, "evaluate_current_policy", lambda *a, **k: _fake_eval(current_cvar))
    monkeypatch.setattr(personal, "optimize_cell", lambda *a, **k: _fake_cell(optimized_cvar))
    kwargs = scenario(current_weights=[0.3333, 0.4441, 0.2226])
    result = analyze_household(**kwargs)
    assert result["comparison"]["outcome"] == outcome
    assert result["comparison"]["cvar95_optimized_minus_current"] == optimized_cvar - current_cvar
    assert result["optimized_policy"]["weights"] == [1.0, 0.0, 0.0]  # not replaced
    assert result["current_policy"]["objective"]["cvar95_cumulative_shortfall"] == current_cvar
    _validate(result, kwargs)


# ---------------------------------------------------------------------------
# Strict provenance reader
# ---------------------------------------------------------------------------


def _manifest_copy(tmp_path, mutate):
    data = json.loads(personal._MANIFEST_PATH.read_text(encoding="utf-8"))
    mutate(data)
    path = tmp_path / "MODEL_MANIFEST.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


@pytest.mark.parametrize(
    "mutate",
    [
        lambda m: m.pop("model_version"),
        lambda m: m.update({"model_version": ""}),
        lambda m: m.pop("canonical_optimization_specification"),
        lambda m: m["dataset"].pop("data_as_of"),
        lambda m: m["dataset"].update({"data_as_of": "2024-12-31"}),
        lambda m: m["dataset"].update({"target_sha256": "not-a-digest"}),
        lambda m: m["dataset"].update({"target_sha256": "0" * 64}),
        lambda m: m.update({"random_seed": 7}),
        lambda m: m.update({"n_simulation_paths": 5000}),
        lambda m: m.update({"simulation_horizon_days_generated": 756}),
    ],
)
def test_engine_provenance_has_no_fallbacks(monkeypatch, tmp_path, mutate):
    monkeypatch.setattr(personal, "_MANIFEST_PATH", _manifest_copy(tmp_path, mutate))
    with pytest.raises(PersonalAnalysisProvenanceError):
        engine_provenance()


def test_engine_provenance_rejects_unreadable_manifest(monkeypatch, tmp_path):
    monkeypatch.setattr(personal, "_MANIFEST_PATH", tmp_path / "missing.json")
    with pytest.raises(PersonalAnalysisProvenanceError):
        engine_provenance()
    broken = tmp_path / "broken.json"
    broken.write_text("{", encoding="utf-8")
    monkeypatch.setattr(personal, "_MANIFEST_PATH", broken)
    with pytest.raises(PersonalAnalysisProvenanceError):
        engine_provenance()


def test_engine_provenance_verifies_dataset_file(monkeypatch, tmp_path):
    root = tmp_path / "engine"
    shutil.copytree(personal._ENGINE_ROOT / "data", root / "data")
    (root / "data" / "processed" / "fx_daily_2010_2025.csv").write_text("tampered", encoding="utf-8")
    shutil.copy(personal._MANIFEST_PATH, root / "MODEL_MANIFEST.json")
    monkeypatch.setattr(personal, "_ENGINE_ROOT", root)
    monkeypatch.setattr(personal, "_MANIFEST_PATH", root / "MODEL_MANIFEST.json")
    with pytest.raises(PersonalAnalysisProvenanceError):
        engine_provenance()


def test_live_provenance_matches_manifest():
    provenance = engine_provenance()
    assert provenance == {
        "model_version": "1.0.0",
        "data_as_of": "2025-12-31",
        "dataset_sha256": "def1997c9bac432d918772c31b78a12632e50674353ecc0ed0ba2e7e3f25c494",
        "simulation_paths": 10_000,
        "simulation_seed": 42,
        "canonical_optimization_specification": "Phase 2C grid-integrity corrected",
        "fx_path_policy": "single_bundle_shared_by_both_policies",
    }


# ---------------------------------------------------------------------------
# Production-bundle checks (session fixture from the production generator)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("profile", PRIMARY_PROFILES, ids=lambda p: p.name)
@pytest.mark.parametrize(
    "weights,ratio,buffer,freq,cost",
    [
        ([1.0, 0.0, 0.0], 0.95, 1.0, "monthly", 0.0),
        ([0.2, 0.5, 0.3], 1.05, 3.0, "quarterly", 0.005),
    ],
)
def test_custom_profile_equals_research_profile_evaluation(
    fx_bundle, profile, weights, ratio, buffer, freq, cost
):
    reference = evaluate_allocation(
        profile.name,
        weights,
        horizon_years=3,
        expense_income_ratio=ratio,
        buffer_months=buffer,
        rebalance_frequency=freq,
        conversion_cost=cost,
        _fx_bundle=fx_bundle,
    )
    levels, s0 = fx_bundle
    inputs = validate_household_inputs(
        income_shares=[profile.qI_kzt, profile.qI_usd, profile.qI_eur],
        expense_shares=[profile.qE_kzt, profile.qE_usd, profile.qE_eur],
        current_weights=weights,
        expense_income_ratio=ratio,
        buffer_months=buffer,
        horizon_years=3,
        rebalance_frequency=freq,
        conversion_cost=cost,
    )
    custom = build_household_profile(inputs["income_shares"], inputs["expense_shares"])
    ev = evaluate_current_policy(monthly_fx_for_horizon(levels, 3), custom, s0, inputs)
    assert ev.cvar95 == reference["cvar95_cumulative_shortfall"]
    assert ev.shortfall_probability == reference["shortfall_probability"]
    assert ev.var95 == reference["var95_cumulative_shortfall"]
    assert ev.expected_cumulative_shortfall == reference["mean_cumulative_shortfall"]
    assert ev.wealth_depletion_probability == reference["wealth_depletion_probability"]
    assert ev.mean_terminal_wealth == reference["mean_terminal_wealth"]
    assert ev.p05_terminal_wealth == reference["p05_terminal_wealth"]


def _canonical_gate(fx_bundle, income, expense, cvar, p_short, n_refined, n_surface, key):
    kwargs = dict(
        income_shares=income,
        expense_shares=expense,
        current_weights=[1.0, 0.0, 0.0],
        expense_income_ratio=0.95,
        buffer_months=1.0,
        horizon_years=3,
        rebalance_frequency="monthly",
        conversion_cost=0.0,
    )
    started = time.perf_counter()
    result = analyze_household(**kwargs, _fx_bundle=fx_bundle)
    # Local timing only (shared session bundle, generation excluded); not a VPS benchmark.
    print(f"\n{key} analyze_household seconds={time.perf_counter() - started:.1f}")
    optimized = result["optimized_policy"]
    assert optimized["weights"] == pytest.approx([1.0, 0.0, 0.0], abs=1e-12)
    assert optimized["objective"]["cvar95_cumulative_shortfall"] == pytest.approx(cvar, abs=CVAR_ATOL)
    assert optimized["diagnostics"]["shortfall_probability"] == pytest.approx(p_short, abs=PSHORT_ATOL)
    ident = optimized["identification"]
    assert ident["identification_class"] == "A_WELL_IDENTIFIED"
    assert (ident["n_coarse"], ident["n_refined"], ident["n_surface"]) == (1326, n_refined, n_surface)
    # The all-KZT current mix is the reported optimum, so both sides agree exactly.
    assert result["current_policy"]["objective"] == optimized["objective"]
    assert result["comparison"]["outcome"] == "equal_within_tolerance"
    _validate(result, kwargs)


@pytest.mark.slow
def test_custom_p2_shares_reproduce_canonical_optimization(fx_bundle):
    _canonical_gate(
        fx_bundle, [0.0, 1.0, 0.0], [1.0, 0.0, 0.0], P2_CVAR, P2_PSHORT, 199, 1473,
        "PERSONAL_P2_3Y",
    )


@pytest.mark.slow
def test_custom_p4_shares_reproduce_canonical_optimization(fx_bundle):
    _canonical_gate(
        fx_bundle, [0.0, 0.5, 0.5], [0.8, 0.0, 0.2], P4_CVAR, P4_PSHORT, 105, 1403,
        "PERSONAL_P4_3Y",
    )
