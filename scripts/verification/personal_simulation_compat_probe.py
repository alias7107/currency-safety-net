

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from research_engine.household.cashflows import (  # noqa: E402
    daily_paths_to_monthly_rates,
    nominal_cashflows,
)
from research_engine.api import _validate_weights  # noqa: E402
from research_engine.household.portfolio import (  # noqa: E402
    initial_holdings,
    rebalance_holdings_with_cost,
)
from research_engine.household.profiles import (  # noqa: E402
    PRIMARY_PROFILES,
    HouseholdProfile,
)
from research_engine.household.risk_metrics import summarize_run  # noqa: E402
from research_engine.household.settlement import simulate_household  # noqa: E402
from research_engine.optimization.evaluator import evaluate_weights  # noqa: E402
from research_engine.simulation.path_builder import returns_to_levels  # noqa: E402

# Tolerances for KZT-normalized quantities (units of initial monthly income I0 = 1).
ATOL = 1e-9
RTOL = 1e-12

MODEL_S0 = np.array([502.57, 591.68])  # MODEL_MANIFEST starting_fx_levels
USER_RATES = np.array([479.35, 547.125])  # arbitrary user-entered assumptions
N_PATHS = 256
N_DAYS = 756  # 3 years × 252 weekdays; 36 household months

results: list[dict] = []


def record(name: str, ok: bool, **details) -> None:
    results.append({"check": name, "ok": bool(ok), **details})


def synthetic_returns(seed: int, sd: float = 0.009) -> np.ndarray:
    rng = np.random.default_rng(seed)
    z = rng.standard_normal((N_PATHS, N_DAYS, 2))
    corr = np.array([[1.0, 0.0], [0.6, 0.8]])  # correlated USD/EUR shocks
    return sd * (z @ corr.T)


def profile(name: str, qi, qe) -> HouseholdProfile:
    return HouseholdProfile(name, *qi, *qe)


def run(prof, s0, levels, weights, ei, buffer_months, freq, cost):
    cf = nominal_cashflows(prof, 1.0, ei * 1.0, float(s0[0]), float(s0[1]))
    monthly = daily_paths_to_monthly_rates(levels)
    w0 = buffer_months * ei
    sim = simulate_household(
        monthly, cf, np.asarray(weights, dtype=float), w0,
        rebalance_frequency=freq, conversion_cost=cost,
    )
    stats = summarize_run(sim.monthly_shortfall, sim.terminal_wealth, cf.E0, monthly.shape[1])
    return sim, stats, cf


def max_diff(a, b):
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    abs_d = float(np.max(np.abs(a - b))) if a.size else 0.0
    scale = float(np.max(np.abs(a))) if a.size else 0.0
    return abs_d, (abs_d / scale if scale > 0 else 0.0)


# 1. Rebasing equivalence: model S0 vs user rate as the starting level.
r = synthetic_returns(20261111)
levels_model = returns_to_levels(r, MODEL_S0)
levels_user = returns_to_levels(r, USER_RATES)
custom = profile("custom_probe", (0.31, 0.52, 0.17), (0.66, 0.09, 0.25))
weights_cases = {
    "mixed": [0.2, 0.5, 0.3],
    "kzt_only": [1.0, 0.0, 0.0],
    "off_grid": [0.3333, 0.4441, 0.2226],
}
scenario_cases = [(0.95, 1.0), (1.05, 3.0), (0.80, 12.0)]
worst = {"abs": 0.0, "rel": 0.0}
discrete_equal = True
case_count = 0
observed_sf: list[float] = []
observed_cvar: list[float] = []
for wname, weights in weights_cases.items():
    for ei, buf in scenario_cases:
        for freq in ("monthly", "quarterly", "none"):
            for cost in (0.0, 0.0025, 0.01):
                a_sim, a_st, _ = run(custom, MODEL_S0, levels_model, weights, ei, buf, freq, cost)
                b_sim, b_st, _ = run(custom, USER_RATES, levels_user, weights, ei, buf, freq, cost)
                for arr_a, arr_b in (
                    (a_sim.monthly_shortfall, b_sim.monthly_shortfall),
                    (a_sim.terminal_wealth, b_sim.terminal_wealth),
                    (a_sim.cumulative_conversion_cost, b_sim.cumulative_conversion_cost),
                ):
                    d_abs, d_rel = max_diff(arr_a, arr_b)
                    worst["abs"] = max(worst["abs"], d_abs)
                    worst["rel"] = max(worst["rel"], d_rel)
                for key in ("cvar95_cumulative_shortfall", "var95_cumulative_shortfall",
                            "expected_cumulative_shortfall", "mean_terminal_wealth"):
                    d_abs, _ = max_diff([a_st[key]], [b_st[key]])
                    worst["abs"] = max(worst["abs"], d_abs)
                for key in ("shortfall_probability", "wealth_depletion_probability"):
                    if a_st[key] != b_st[key]:
                        discrete_equal = False
                observed_sf.append(a_st["shortfall_probability"])
                observed_cvar.append(a_st["cvar95_cumulative_shortfall"])
                case_count += 1
record(
    "rebasing_equivalence_model_s0_vs_user_rates",
    worst["abs"] <= ATOL and discrete_equal,
    cases=case_count,
    max_abs_diff=worst["abs"],
    max_rel_diff=worst["rel"],
    discrete_probability_metrics_identical=discrete_equal,
    synthetic_shortfall_probability_range=[min(observed_sf), max(observed_sf)],
    synthetic_cvar95_range=[min(observed_cvar), max(observed_cvar)],
    tolerance={"atol": ATOL, "note": "KZT-normalized units, I0 = 1"},
)

# 1b. Levels depend on S0 only through scale: S_user(t)/R == S_model(t)/S0.
ratio_d, _ = max_diff(levels_user / USER_RATES, levels_model / MODEL_S0)
record("relative_paths_identical", ratio_d <= 1e-12, max_abs_diff=ratio_d)

# 2. Revaluing user nominal amounts at historical S0 changes the composition.
income_kzt, income_usd = 300_000.0, 1_000.0
share_user = income_usd * USER_RATES[0] / (income_kzt + income_usd * USER_RATES[0])
share_hist = income_usd * MODEL_S0[0] / (income_kzt + income_usd * MODEL_S0[0])
record(
    "historical_revaluation_changes_shares",
    abs(share_user - share_hist) > 1e-6,
    usd_income_share_at_user_rate=share_user,
    usd_income_share_if_revalued_at_model_s0=share_hist,
)

# 3. Custom vectors equal to P1–P4 reproduce the profile objects exactly.
small_levels = returns_to_levels(synthetic_returns(7, sd=0.012), MODEL_S0)
monthly_small = daily_paths_to_monthly_rates(small_levels)
p_equal = True
for prof in PRIMARY_PROFILES:
    twin = profile(
        "custom_" + prof.name,
        (prof.qI_kzt, prof.qI_usd, prof.qI_eur),
        (prof.qE_kzt, prof.qE_usd, prof.qE_eur),
    )
    cf_a = nominal_cashflows(prof, 1.0, 0.95, *MODEL_S0)
    cf_b = nominal_cashflows(twin, 1.0, 0.95, *MODEL_S0)
    for w in ([1.0, 0.0, 0.0], [0.2, 0.5, 0.3]):
        ev_a = evaluate_weights(monthly_small, cf_a, 0.95, np.array(w), rebalance_frequency="monthly", conversion_cost=0.005)
        ev_b = evaluate_weights(monthly_small, cf_b, 0.95, np.array(w), rebalance_frequency="monthly", conversion_cost=0.005)
        if not (np.array_equal(ev_a.path_losses, ev_b.path_losses) and ev_a.cvar95 == ev_b.cvar95):
            p_equal = False
record("custom_vectors_reproduce_p1_p4_bitwise", p_equal)

# 4. Same-policy determinism (current policy evaluated twice on the same paths).
cf_c = nominal_cashflows(custom, 1.0, 0.95, *MODEL_S0)
ev1 = evaluate_weights(monthly_small, cf_c, 2.85, np.array([0.2, 0.5, 0.3]), rebalance_frequency="quarterly", conversion_cost=0.01)
ev2 = evaluate_weights(monthly_small, cf_c, 2.85, np.array([0.2, 0.5, 0.3]), rebalance_frequency="quarterly", conversion_cost=0.01)
record(
    "same_policy_bitwise_deterministic",
    np.array_equal(ev1.path_losses, ev2.path_losses) and np.array_equal(ev1.terminal_wealth, ev2.terminal_wealth),
)

# Constant-FX helpers for exact accounting checks.
def constant_monthly(months: int) -> np.ndarray:
    return np.tile(MODEL_S0, (1, months, 1)).reshape(1, months, 2)


# 5. Surplus retention: income above modeled expenses stays in holdings.
kzt_only = profile("kzt_only", (1.0, 0.0, 0.0), (1.0, 0.0, 0.0))
cf_k = nominal_cashflows(kzt_only, 1.0, 0.8, *MODEL_S0)
sim_k = simulate_household(constant_monthly(12), cf_k, np.array([1.0, 0.0, 0.0]), 0.8, rebalance_frequency="monthly", conversion_cost=0.0)
expected_terminal = 0.8 + 12 * (1.0 - 0.8)
record(
    "surplus_retained_in_holdings",
    abs(float(sim_k.terminal_wealth[0]) - expected_terminal) <= 1e-12,
    terminal_wealth=float(sim_k.terminal_wealth[0]),
    expected=expected_terminal,
)

# 6. No initial switching cost: holdings start at the policy weights for free.
cf_k1 = nominal_cashflows(kzt_only, 1.0, 1.0, *MODEL_S0)
sim_usd = simulate_household(constant_monthly(12), cf_k1, np.array([0.0, 1.0, 0.0]), 3.0, rebalance_frequency="monthly", conversion_cost=0.01)
_, _, _, switch_fee = rebalance_holdings_with_cost(
    np.array([3.0]), np.array([0.0]), np.array([0.0]),
    np.array([0.0, 1.0, 0.0]), np.array([MODEL_S0[0]]), np.array([MODEL_S0[1]]), 0.01,
)
record(
    "no_initial_switch_cost_charged",
    float(sim_usd.cumulative_conversion_cost[0]) == 0.0,
    engine_cumulative_cost=float(sim_usd.cumulative_conversion_cost[0]),
    hypothetical_switch_from_all_kzt_fee=float(switch_fee[0]),
)

# 7. rebalance_frequency="none": composition drifts through cash flows.
usd_income = profile("usd_income", (0.0, 1.0, 0.0), (1.0, 0.0, 0.0))
cf_u = nominal_cashflows(usd_income, 1.0, 0.8, *MODEL_S0)
compositions = {}
for freq in ("none", "monthly"):
    sim = simulate_household(constant_monthly(6), cf_u, np.array([1.0, 0.0, 0.0]), 2.4, rebalance_frequency=freq, conversion_cost=0.0)
    hk, hu, he = (float(x[0]) for x in sim.holdings_end)
    values = np.array([hk, hu * MODEL_S0[0], he * MODEL_S0[1]])
    compositions[freq] = (values / values.sum()).round(6).tolist()
record(
    "none_policy_drifts_monthly_restores",
    compositions["none"] != [1.0, 0.0, 0.0] and compositions["monthly"] == [1.0, 0.0, 0.0],
    end_composition=compositions,
)

# 8. Share-sum tolerance enforced by HouseholdProfile (1e-12).
accepted = True
try:
    profile("tol_ok", (0.5, 0.5 + 5e-13, 0.0), (1.0, 0.0, 0.0))
except ValueError:
    accepted = False
rejected = False
try:
    profile("tol_bad", (0.5, 0.5 + 2e-12, 0.0), (1.0, 0.0, 0.0))
except ValueError:
    rejected = True
record("household_profile_share_tolerance_1e-12", accepted and rejected)

# 9. Off-grid weights are evaluated directly (no snapping to the bp grid).
ev_off = evaluate_weights(monthly_small, cf_c, 2.85, np.array([0.3333, 0.4441, 0.2226]))
record("off_grid_weights_evaluated_unsnapped", np.allclose(ev_off.weights, [0.3333, 0.4441, 0.2226], atol=0, rtol=0))


# 10. Proposed strict vector adapter vs HouseholdProfile at the 1e-12 boundary.
#     The adapter mirrors the constructor's left-to-right sum ((a + b) + c).
SHARE_SUM_TOL = 1e-12


def canonical_number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if not math.isfinite(number):
        return None
    return 0.0 if number == 0.0 else number  # canonicalize -0.0


def adapter_accepts(vector) -> bool:
    if not isinstance(vector, (list, tuple)) or len(vector) != 3:
        return False
    values = [canonical_number(v) for v in vector]
    if any(v is None or v < 0.0 for v in values):
        return False
    total = values[0] + values[1] + values[2]  # same association as HouseholdProfile
    return abs(total - 1.0) <= SHARE_SUM_TOL


def profile_accepts(vector) -> bool:
    try:
        HouseholdProfile("boundary", *vector, 1.0, 0.0, 0.0)
        HouseholdProfile("boundary", 1.0, 0.0, 0.0, *vector)
        return True
    except ValueError:
        return False


rng_b = np.random.default_rng(5101)
samples = 50_000
agree = 0
fsum_disagree = 0
accepted_vectors = []
for _ in range(samples):
    a, b = sorted(rng_b.uniform(0.0, 1.0, size=2))
    sign = 1.0 if rng_b.random() < 0.5 else -1.0
    delta = sign * SHARE_SUM_TOL + rng_b.uniform(-6e-16, 6e-16)
    vec = [float(a), float(b - a), float(1.0 - b + delta)]
    if vec[2] < 0.0:
        continue
    ours = adapter_accepts(vec)
    theirs = profile_accepts(vec)
    agree += int(ours == theirs)
    fsum_rule = abs(math.fsum(vec) - 1.0) <= SHARE_SUM_TOL
    fsum_disagree += int(fsum_rule != theirs)
    if ours:
        accepted_vectors.append(vec)
holdings_ok = all(
    np.all(np.isfinite(initial_holdings(2.0, np.array(v), *MODEL_S0))) for v in accepted_vectors[:5000]
)
record(
    "strict_adapter_matches_household_profile_at_boundary",
    agree == samples and holdings_ok,
    boundary_samples=samples,
    adapter_profile_agreement=agree,
    fsum_rule_disagreements_with_profile=fsum_disagree,
    accepted_vectors_pass_initial_holdings=holdings_ok,
    rejects=[
        adapter_accepts([True, 0.0, 0.0]) is False,
        adapter_accepts(["0.5", 0.5, 0.0]) is False,
        adapter_accepts([0.5, 0.5]) is False,
        adapter_accepts([1.0, -0.0, 0.0]) is True,
        adapter_accepts([1.0, -1e-18, 0.0]) is False,
        adapter_accepts([1.0, float("nan"), 0.0]) is False,
    ],
)

# 11. The existing public weight helper renormalizes; the new adapter must not reuse it.
near_one = [0.25, 0.5, 0.25 + 5e-13]
renormalized = _validate_weights(near_one)
record(
    "existing_validate_weights_renormalizes",
    adapter_accepts(near_one) and not np.array_equal(renormalized, np.array(near_one)),
    input=near_one,
    validate_weights_output=[float(x) for x in renormalized],
    evaluate_weights_uses_input_exactly=bool(
        np.array_equal(
            evaluate_weights(monthly_small, cf_c, 2.85, np.array(near_one)).weights,
            np.array(near_one),
        )
    ),
)

# 12. Canonical numeric serialization: 1 and 1.0 serialize identically; no rounding.
canon = [canonical_number(v) for v in (1, 1.0, -0.0, 0, 0.1 + 0.2)]
encoded = json.dumps(canon, separators=(",", ":"))
roundtrip_ok = all(
    float(json.dumps(x)) == x for x in rng_b.uniform(0.0, 1.0, size=2000).tolist()
)
record(
    "canonical_serialization",
    encoded == "[1.0,1.0,0.0,0.0,0.30000000000000004]" and roundtrip_ok,
    encoded=encoded,
    float_repr_roundtrip_exact=roundtrip_ok,
)

summary = {
    "probe": "personal_simulation_compat_probe",
    "synthetic_paths": N_PATHS,
    "synthetic_days": N_DAYS,
    "production_generator_used": False,
    "optimizer_run": False,
    "checks": results,
    "all_ok": all(item["ok"] for item in results),
}
print(json.dumps(summary, indent=2))
sys.exit(0 if summary["all_ok"] else 1)
