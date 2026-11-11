
from __future__ import annotations

import ast
import copy
import inspect
import json
import math
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

import pytest
from django.core.cache import cache
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework.throttling import AnonRateThrottle

from calculations import household_contract
from calculations.household_contract import (
    CONTRACT_VERSION,
    HouseholdRequestError,
    HouseholdResultValidationError,
    UnsupportedScenarioError,
    compute_household_fingerprint,
    live_provenance,
    parse_household_request,
    snapshot_from_provenance,
    validate_household_result,
)
from calculations.household_services import claim_household_analysis_job
from calculations.models import BufferSensitivityJob, HouseholdAnalysisJob, OptimizationJob
from calculations.retention import cleanup_expired_jobs
from calculations.tasks import run_household_analysis_job
from research_engine.household.profiles import HouseholdProfile
from research_engine.personal import (
    CURRENT_POLICY_LABEL,
    ENGINE_INTERFACE_VERSION,
    OPTIMIZED_POLICY_LABEL,
    TIE_ABSOLUTE_TOLERANCE,
    UNITS,
    PersonalAnalysisProvenanceError,
    comparison_outcome,
)

pytestmark = pytest.mark.django_db

URL = "/api/v1/household-analysis-jobs/"
PUBLISH = "calculations.tasks.run_household_analysis_job.apply_async"
ENGINE = "research_engine.analyze_household"


@pytest.fixture(autouse=True)
def _throttles_and_switch(settings):
    rates = {
        "optimization_submit": "1000/min",
        "buffer_sensitivity_submit": "1000/min",
        "household_analysis_submit": "1000/min",
        "job_poll": "1000/min",
        "model_metadata": "1000/min",
        "anon": "1000/min",
    }
    settings.REST_FRAMEWORK = {**settings.REST_FRAMEWORK, "DEFAULT_THROTTLE_RATES": rates}
    AnonRateThrottle.THROTTLE_RATES = rates
    settings.HOUSEHOLD_ANALYSIS_SUBMISSIONS_ENABLED = True
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def client():
    return APIClient()


def valid_body(**overrides):
    body = {
        "contract_version": CONTRACT_VERSION,
        "income_shares": [0.3, 0.6, 0.1],
        "expense_shares": [0.8, 0.0, 0.2],
        "current_reserve_weights": [0.25, 0.5, 0.25],
        "expense_income_ratio": 0.95,
        "buffer_months": 3.0,
        "horizon_years": 3,
        "rebalance_frequency": "monthly",
        "conversion_cost": 0.0025,
    }
    body.update(overrides)
    return body


def normalized(body=None):
    return parse_household_request(body or valid_body())


def _policy(label, weights, cvar, *, sf=0.05):
    return {
        "label": label,
        "weights": list(weights),
        "objective": {"cvar95_cumulative_shortfall": cvar},
        "diagnostics": {"shortfall_probability": sf, "var95_cumulative_shortfall": 0.1},
        "implementation_only": {
            "mean_cumulative_shortfall": 0.02,
            "wealth_depletion_probability": 0.01,
            "mean_terminal_wealth": 5.0,
            "median_terminal_wealth": 4.5,
            "p05_terminal_wealth": 1.0,
            "p95_terminal_wealth": 9.0,
        },
    }


def make_result(request, provenance=None, *, current_cvar=0.6, optimized_cvar=0.4):
    """Contract-valid synthetic result (arbitrary values, not model output)."""
    provenance = provenance or live_provenance()
    delta = optimized_cvar - current_cvar
    optimized = _policy(OPTIMIZED_POLICY_LABEL, [1.0, 0.0, 0.0], optimized_cvar)
    optimized["identification"] = {
        "applies_to": "optimization_surface",
        "identification_class": "A_WELL_IDENTIFIED",
        "n_coarse": 1326,
        "n_refined": 199,
        "n_surface": 1473,
        "near_optimal_1pct_count": 35,
        "near_optimal_1pct_frac": 35 / 1473,
    }
    return {
        "contract_version": CONTRACT_VERSION,
        "engine_interface_version": ENGINE_INTERFACE_VERSION,
        "units": {"cumulative_shortfall": UNITS, "terminal_wealth": UNITS},
        "scenario": copy.deepcopy(request),
        "provenance": dict(provenance),
        "current_policy": _policy(
            CURRENT_POLICY_LABEL, request["current_reserve_weights"], current_cvar
        ),
        "optimized_policy": optimized,
        "comparison": {
            "objective": "cvar95_cumulative_shortfall",
            "direction": "lower_is_better",
            "cvar95_optimized_minus_current": delta,
            "outcome": comparison_outcome(delta),
            "tie_absolute_tolerance": TIE_ABSOLUTE_TOLERANCE,
            "includes_initial_switching_cost": False,
        },
    }


def submit(client, django_capture_on_commit_callbacks, body=None):
    with patch(PUBLISH) as publish:
        with django_capture_on_commit_callbacks(execute=True):
            response = client.post(URL, body or valid_body(), format="json")
    return response, publish


# ---------------------------------------------------------------------------
# Submission, switch, envelopes
# ---------------------------------------------------------------------------


def test_valid_request_queues_job_with_snapshot(client, django_capture_on_commit_callbacks):
    response, publish = submit(client, django_capture_on_commit_callbacks)
    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "queued"
    assert body["cached"] is False
    assert body["contract_version"] == CONTRACT_VERSION
    assert body["status_url"] == f"{URL}{body['job_id']}/"
    publish.assert_called_once_with(args=(body["job_id"],))

    job = HouseholdAnalysisJob.objects.get(id=body["job_id"])
    live = live_provenance()
    assert job.request_payload == normalized()
    assert job.request_fingerprint == compute_household_fingerprint(normalized(), live)
    assert job.engine_interface_version == ENGINE_INTERFACE_VERSION
    assert job.dataset_sha256 == live["dataset_sha256"]
    assert job.data_as_of == live["data_as_of"]
    assert job.simulation_paths == 10_000 and job.simulation_seed == 42
    assert job.canonical_optimization_specification == live["canonical_optimization_specification"]


def test_submissions_disabled_by_default(client, settings):
    del settings.HOUSEHOLD_ANALYSIS_SUBMISSIONS_ENABLED
    from django.conf import settings as live_settings

    assert getattr(live_settings, "HOUSEHOLD_ANALYSIS_SUBMISSIONS_ENABLED", False) is False


def test_project_default_is_disabled():
    source = (Path(__file__).resolve().parents[1] / "project" / "settings.py").read_text()
    assert '"HOUSEHOLD_ANALYSIS_SUBMISSIONS_ENABLED", default=False' in source


def test_disabled_switch_rejects_post_and_keeps_get(client, settings, django_capture_on_commit_callbacks):
    response, _ = submit(client, django_capture_on_commit_callbacks)
    job_id = response.json()["job_id"]
    settings.HOUSEHOLD_ANALYSIS_SUBMISSIONS_ENABLED = False
    with patch(PUBLISH) as publish, patch(ENGINE) as engine:
        blocked = client.post(URL, valid_body(horizon_years=5), format="json")
    assert blocked.status_code == 503
    assert blocked.json()["error"]["code"] == "submissions_disabled"
    publish.assert_not_called()
    engine.assert_not_called()
    assert HouseholdAnalysisJob.objects.count() == 1
    detail = client.get(f"{URL}{job_id}/")
    assert detail.status_code == 200
    assert detail.json()["status"] == "queued"


def test_get_unknown_job_404(client):
    response = client.get(f"{URL}00000000-0000-0000-0000-000000000000/")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_duplicate_submission_reuses_job_and_dispatches_once(
    client, django_capture_on_commit_callbacks
):
    with patch(PUBLISH) as publish:
        with django_capture_on_commit_callbacks(execute=True):
            first = client.post(URL, valid_body(), format="json")
        with django_capture_on_commit_callbacks(execute=True):
            second = client.post(URL, valid_body(), format="json")
    assert first.status_code == second.status_code == 202
    assert first.json()["job_id"] == second.json()["job_id"]
    assert publish.call_count == 1
    assert HouseholdAnalysisJob.objects.count() == 1


@pytest.mark.django_db(transaction=True)
def test_broker_failure_returns_safe_503(client):
    # Real commit semantics: on_commit publishes inside the request transaction.
    with patch(PUBLISH, side_effect=RuntimeError("redis://secret down")):
        response = client.post(URL, valid_body(), format="json")
    assert response.status_code == 503
    body = response.json()
    assert body["error"]["code"] == "queue_unavailable"
    assert "redis" not in json.dumps(body)
    job = HouseholdAnalysisJob.objects.get(id=body["job_id"])
    assert job.status == HouseholdAnalysisJob.Status.FAILED
    assert job.error_code == "queue_unavailable"


def test_provenance_unavailable_returns_503_without_job(client):
    with patch(
        "calculations.household_contract.engine_provenance",
        side_effect=PersonalAnalysisProvenanceError("model_version missing"),
    ), patch(PUBLISH) as publish:
        response = client.post(URL, valid_body(), format="json")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "provenance_unavailable"
    assert "model_version" not in json.dumps(response.json())
    assert HouseholdAnalysisJob.objects.count() == 0
    publish.assert_not_called()


def test_submit_throttle_is_separate_scope(client, settings, django_capture_on_commit_callbacks):
    rates = {**settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"], "household_analysis_submit": "2/min"}
    settings.REST_FRAMEWORK = {**settings.REST_FRAMEWORK, "DEFAULT_THROTTLE_RATES": rates}
    AnonRateThrottle.THROTTLE_RATES = rates
    cache.clear()
    codes = []
    with patch(PUBLISH):
        for horizon in (1, 3, 5):
            with django_capture_on_commit_callbacks(execute=True):
                codes.append(client.post(URL, valid_body(horizon_years=horizon), format="json").status_code)
    assert codes == [202, 202, 429]


# ---------------------------------------------------------------------------
# Strict validation and the documented order
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "overrides",
    [
        {"income_shares": [True, 0.0, 0.0]},
        {"income_shares": ["0.5", 0.5, 0.0]},
        {"income_shares": [0.5, 0.5]},
        {"income_shares": [0.5, 0.5, 0.0, 0.0]},
        {"income_shares": [1.2, -0.2, 0.0]},
        {"income_shares": {"kzt": 1.0}},
        {"expense_shares": [0.5, 0.4, 0.0]},
        {"current_reserve_weights": [0.5, 0.5, 0.5]},
        {"current_reserve_weights": "auto"},
        {"expense_income_ratio": True},
        {"expense_income_ratio": "0.95"},
        {"expense_income_ratio": None},
        {"expense_income_ratio": 0.0},
        {"buffer_months": "3"},
        {"buffer_months": -1.0},
        {"conversion_cost": -0.001},
        {"conversion_cost": False},
        {"horizon_years": 3.0},
        {"horizon_years": True},
        {"horizon_years": "3"},
        {"horizon_years": 2},
        {"rebalance_frequency": "Monthly"},
        {"rebalance_frequency": " monthly"},
        {"rebalance_frequency": "weekly"},
        {"contract_version": "household_analysis_v2"},
    ],
)
def test_strict_validation_returns_400_without_job(client, overrides):
    with patch(PUBLISH) as publish, patch(ENGINE) as engine:
        response = client.post(URL, valid_body(**overrides), format="json")
    assert response.status_code == 400, overrides
    assert response.json()["error"]["code"] == "validation_error"
    assert HouseholdAnalysisJob.objects.count() == 0
    publish.assert_not_called()
    engine.assert_not_called()


@pytest.mark.parametrize(
    "mutation",
    [
        lambda b: b.update({"profile": "P2"}),
        lambda b: b.update({"weights": [1.0, 0.0, 0.0]}),
        lambda b: b.update({"n_paths": 100}),
        lambda b: b.update({"provenance": {"model_version": "x"}}),
        lambda b: b.update({"monthly_contribution": 50000}),
        lambda b: b.pop("conversion_cost"),
        lambda b: b.pop("current_reserve_weights"),
    ],
)
def test_envelope_rejects_unknown_forbidden_and_missing(client, mutation):
    body = valid_body()
    mutation(body)
    response = client.post(URL, body, format="json")
    assert response.status_code == 400
    assert HouseholdAnalysisJob.objects.count() == 0


def test_non_object_and_non_finite_bodies_rejected(client):
    assert client.post(URL, [1, 2, 3], format="json").status_code == 400
    raw = json.dumps(valid_body()).replace("0.95", "NaN")
    response = client.post(URL, raw, content_type="application/json")
    assert response.status_code == 400
    with pytest.raises(HouseholdRequestError):
        parse_household_request(valid_body(expense_income_ratio=float("inf")))
    with pytest.raises(HouseholdRequestError):
        parse_household_request(valid_body(income_shares=[float("nan"), 0.5, 0.5]))


def test_sum_tolerance_matches_household_profile():
    ok = [0.5, 0.5 + 5e-13, 0.0]
    bad = [0.5, 0.5 + 2e-12, 0.0]
    parsed = parse_household_request(valid_body(income_shares=ok, current_reserve_weights=ok))
    assert parsed["income_shares"] == ok  # preserved exactly, not renormalized
    assert parsed["current_reserve_weights"] == ok
    HouseholdProfile("ok", *ok, 1.0, 0.0, 0.0)
    with pytest.raises(HouseholdRequestError):
        parse_household_request(valid_body(income_shares=bad))
    with pytest.raises(ValueError):
        HouseholdProfile("bad", *bad, 1.0, 0.0, 0.0)


def test_negative_zero_is_canonicalized():
    parsed = parse_household_request(
        valid_body(current_reserve_weights=[1.0, -0.0, 0.0], conversion_cost=-0.0)
    )
    assert math.copysign(1.0, parsed["current_reserve_weights"][1]) == 1.0
    assert math.copysign(1.0, parsed["conversion_cost"]) == 1.0


def test_zero_reserve_with_null_weights_is_422_no_current_reserve(client):
    with patch(PUBLISH) as publish, patch(ENGINE) as engine:
        response = client.post(
            URL, valid_body(buffer_months=0, current_reserve_weights=None), format="json"
        )
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "unsupported_scenario"
    assert [reason["code"] for reason in error["reasons"]] == ["no_current_reserve"]
    assert HouseholdAnalysisJob.objects.count() == 0
    publish.assert_not_called()
    engine.assert_not_called()


@pytest.mark.parametrize(
    "overrides,detail",
    [
        ({"buffer_months": 3.0, "current_reserve_weights": None}, "current_reserve_weights_required"),
        ({"buffer_months": 0.0, "current_reserve_weights": [1.0, 0.0, 0.0]}, "reserve_weights_without_reserve"),
        ({"buffer_months": -0.5, "current_reserve_weights": None}, None),
        ({"buffer_months": 0.0, "current_reserve_weights": [1.0, 0.0]}, None),
    ],
)
def test_reserve_consistency_and_types_are_400(client, overrides, detail):
    response = client.post(URL, valid_body(**overrides), format="json")
    assert response.status_code == 400
    if detail:
        assert detail in json.dumps(response.json())
    assert HouseholdAnalysisJob.objects.count() == 0


def test_types_are_checked_before_eligibility(client):
    response = client.post(
        URL,
        valid_body(buffer_months=0.0, current_reserve_weights=None, horizon_years=True),
        format="json",
    )
    assert response.status_code == 400


@pytest.mark.parametrize(
    "overrides,codes",
    [
        ({"expense_income_ratio": 0.6}, ["expense_income_ratio_out_of_supported_range"]),
        ({"expense_income_ratio": 1.2}, ["expense_income_ratio_out_of_supported_range"]),
        ({"buffer_months": 0.5}, ["buffer_months_out_of_supported_range"]),
        ({"buffer_months": 20.0}, ["buffer_months_out_of_supported_range"]),
        ({"conversion_cost": 0.02}, ["conversion_cost_out_of_supported_range"]),
        (
            {"expense_income_ratio": 0.6, "buffer_months": 0, "current_reserve_weights": None},
            ["expense_income_ratio_out_of_supported_range", "no_current_reserve"],
        ),
    ],
)
def test_out_of_domain_inputs_are_422_with_reasons(client, overrides, codes):
    with patch(PUBLISH) as publish, patch(ENGINE) as engine:
        response = client.post(URL, valid_body(**overrides), format="json")
    assert response.status_code == 422
    assert [r["code"] for r in response.json()["error"]["reasons"]] == codes
    assert HouseholdAnalysisJob.objects.count() == 0
    publish.assert_not_called()
    engine.assert_not_called()


@pytest.mark.parametrize(
    "overrides",
    [
        {"expense_income_ratio": 1.02},
        {"expense_income_ratio": 0.8},
        {"expense_income_ratio": 1.05},
        {"buffer_months": 1},
        {"buffer_months": 12},
        {"buffer_months": 7.3},
        {"conversion_cost": 0.01},
        {"conversion_cost": 0},
    ],
)
def test_supported_boundaries_and_non_grid_values_accepted(overrides):
    parsed = parse_household_request(valid_body(**overrides))
    for key, value in overrides.items():
        assert parsed[key] == float(value)
        assert isinstance(parsed[key], float)


# ---------------------------------------------------------------------------
# Fingerprint and provenance
# ---------------------------------------------------------------------------


def test_equivalent_numbers_share_a_fingerprint():
    live = live_provenance()
    as_floats = normalized(valid_body(buffer_months=3.0, income_shares=[1.0, 0.0, 0.0]))
    as_ints = normalized(valid_body(buffer_months=3, income_shares=[1, 0, 0]))
    assert as_floats == as_ints
    assert compute_household_fingerprint(as_floats, live) == compute_household_fingerprint(as_ints, live)


@pytest.mark.parametrize(
    "overrides",
    [
        {"income_shares": [0.3, 0.5, 0.2]},
        {"expense_shares": [0.7, 0.1, 0.2]},
        {"current_reserve_weights": [0.25, 0.5 + 5e-13, 0.25]},
        {"expense_income_ratio": 0.9500000000000001},
        {"buffer_months": 3.25},
        {"horizon_years": 5},
        {"rebalance_frequency": "none"},
        {"conversion_cost": 0.005},
    ],
)
def test_every_input_changes_fingerprint(overrides):
    live = live_provenance()
    base = compute_household_fingerprint(normalized(), live)
    assert compute_household_fingerprint(normalized(valid_body(**overrides)), live) != base


@pytest.mark.parametrize(
    "field,value",
    [
        ("model_version", "9.9.9"),
        ("data_as_of", "1999-12-31"),
        ("dataset_sha256", "0" * 64),
        ("simulation_paths", 9_999),
        ("simulation_seed", 41),
        ("canonical_optimization_specification", "other spec"),
    ],
)
def test_every_provenance_field_changes_fingerprint(field, value):
    live = live_provenance()
    base = compute_household_fingerprint(normalized(), live)
    assert compute_household_fingerprint(normalized(), {**live, field: value}) != base


def test_contract_and_engine_versions_change_fingerprint():
    live = live_provenance()
    request = normalized()
    base = compute_household_fingerprint(request, live)
    with patch.object(household_contract, "CONTRACT_VERSION", "household_analysis_v9"):
        assert compute_household_fingerprint(request, live) != base
    with patch.object(household_contract, "ENGINE_INTERFACE_VERSION", "personal_analysis_engine_v9"):
        assert compute_household_fingerprint(request, live) != base


def _queued_job(client, django_capture_on_commit_callbacks, body=None):
    response, _ = submit(client, django_capture_on_commit_callbacks, body)
    return HouseholdAnalysisJob.objects.get(id=response.json()["job_id"])


@pytest.mark.parametrize(
    "field,value",
    [
        ("model_version", "0.0.1"),
        ("data_as_of", "2000-01-01"),
        ("dataset_sha256", "f" * 64),
        ("canonical_optimization_specification", "legacy"),
        ("contract_version", "household_analysis_v0"),
        ("engine_interface_version", "personal_analysis_engine_v0"),
        ("request_fingerprint", "a" * 64),
    ],
)
def test_stale_snapshot_fails_before_any_engine_call(
    client, django_capture_on_commit_callbacks, field, value
):
    job = _queued_job(client, django_capture_on_commit_callbacks)
    setattr(job, field, value)
    job.save()
    with patch(ENGINE) as engine:
        outcome = run_household_analysis_job(str(job.id))
    engine.assert_not_called()
    job.refresh_from_db()
    assert outcome["status"] == "failed"
    assert job.status == HouseholdAnalysisJob.Status.FAILED
    assert job.error_code == "provenance_changed"
    assert job.result_payload is None


def test_live_provenance_drift_fails_before_engine_call(client, django_capture_on_commit_callbacks):
    job = _queued_job(client, django_capture_on_commit_callbacks)
    drifted = {**live_provenance(), "model_version": "2.0.0"}
    with patch("calculations.household_contract.engine_provenance", return_value=drifted), patch(
        ENGINE
    ) as engine:
        run_household_analysis_job(str(job.id))
    engine.assert_not_called()
    job.refresh_from_db()
    assert job.error_code == "provenance_changed"


def test_tampered_stored_request_fails_before_engine_call(client, django_capture_on_commit_callbacks):
    job = _queued_job(client, django_capture_on_commit_callbacks)
    job.request_payload = {**job.request_payload, "buffer_months": 30.0}
    job.save()
    with patch(ENGINE) as engine:
        run_household_analysis_job(str(job.id))
    engine.assert_not_called()
    job.refresh_from_db()
    assert job.error_code == "provenance_changed"


# ---------------------------------------------------------------------------
# Task, atomic result validation, lifecycle
# ---------------------------------------------------------------------------


def test_task_success_and_cached_post(client, django_capture_on_commit_callbacks):
    job = _queued_job(client, django_capture_on_commit_callbacks)
    with patch(ENGINE, side_effect=lambda **_: make_result(job.request_payload)) as engine:
        outcome = run_household_analysis_job(str(job.id))
    assert outcome["status"] == "succeeded"
    kwargs = engine.call_args.kwargs
    assert set(kwargs) == {
        "income_shares",
        "expense_shares",
        "current_weights",
        "expense_income_ratio",
        "buffer_months",
        "horizon_years",
        "rebalance_frequency",
        "conversion_cost",
    }
    assert kwargs["current_weights"] == job.request_payload["current_reserve_weights"]
    job.refresh_from_db()
    assert job.status == HouseholdAnalysisJob.Status.SUCCEEDED
    assert job.result_payload["comparison"]["outcome"] == "optimized_lower"

    detail = client.get(f"{URL}{job.id}/")
    assert detail.status_code == 200
    assert detail.json()["result"] == job.result_payload

    with patch(PUBLISH) as publish:
        cached = client.post(URL, valid_body(), format="json")
    assert cached.status_code == 200
    assert cached.json()["cached"] is True
    assert cached.json()["result"] == job.result_payload
    publish.assert_not_called()


def _corrupt(mutator):
    def factory(request):
        result = make_result(request)
        mutator(result)
        return result

    return factory


@pytest.mark.parametrize(
    "mutator",
    [
        lambda r: r["scenario"].update({"buffer_months": 3.5}),
        lambda r: r["current_policy"].update({"weights": [0.25, 0.25, 0.5]}),
        lambda r: r["comparison"].update({"cvar95_optimized_minus_current": -0.3}),
        lambda r: r["comparison"].update({"outcome": "current_lower"}),
        lambda r: r["comparison"].update({"includes_initial_switching_cost": True}),
        lambda r: r["comparison"].update({"tie_absolute_tolerance": 1e-6}),
        lambda r: r["provenance"].update({"dataset_sha256": "1" * 64}),
        lambda r: r["provenance"].pop("data_as_of"),
        lambda r: r.pop("optimized_policy"),
        lambda r: r["current_policy"].update({"identification": {}}),
        lambda r: r["current_policy"].update({"mean_terminal_wealth": 1.0}),
        lambda r: r["current_policy"]["diagnostics"].update({"shortfall_probability": 1.2}),
        lambda r: r["current_policy"]["objective"].update({"cvar95_cumulative_shortfall": -0.1}),
        lambda r: r["optimized_policy"]["implementation_only"].update({"mean_terminal_wealth": float("nan")}),
        lambda r: r["optimized_policy"].update({"weights": [0.6, 0.6, 0.0]}),
        lambda r: r["optimized_policy"]["identification"].update({"identification_class": "Z"}),
        lambda r: r["optimized_policy"]["identification"].update({"near_optimal_1pct_count": 5000}),
        lambda r: r["optimized_policy"]["identification"].update({"n_surface": True}),
        lambda r: r["units"].update({"terminal_wealth": "kzt"}),
        lambda r: r.update({"engine_interface_version": "other"}),
    ],
)
def test_invalid_results_are_never_stored(client, django_capture_on_commit_callbacks, mutator):
    job = _queued_job(client, django_capture_on_commit_callbacks)
    with patch(ENGINE, side_effect=lambda **_: _corrupt(mutator)(job.request_payload)):
        outcome = run_household_analysis_job(str(job.id))
    job.refresh_from_db()
    assert outcome["status"] == "failed"
    assert job.status == HouseholdAnalysisJob.Status.FAILED
    assert job.error_code == "result_validation_failed"
    assert job.result_payload is None


@pytest.mark.parametrize(
    "current_cvar,optimized_cvar,outcome",
    [
        (0.6, 0.4, "optimized_lower"),
        (0.30, 0.35, "current_lower"),
        (0.5, 0.5 + 5e-9, "equal_within_tolerance"),
        (0.0, 0.0, "equal_within_tolerance"),
    ],
)
def test_all_comparison_outcomes_validate(current_cvar, optimized_cvar, outcome):
    request = normalized()
    live = live_provenance()
    result = make_result(request, live, current_cvar=current_cvar, optimized_cvar=optimized_cvar)
    assert result["comparison"]["outcome"] == outcome
    validate_household_result(
        result, request=request, snapshot=snapshot_from_provenance(live), live=live
    )


def test_engine_exception_fails_safely(client, django_capture_on_commit_callbacks):
    job = _queued_job(client, django_capture_on_commit_callbacks)
    with patch(ENGINE, side_effect=RuntimeError("engine detail")):
        run_household_analysis_job(str(job.id))
    job.refresh_from_db()
    assert job.error_code == "analysis_failed"
    assert "engine detail" not in job.error_message


def test_stale_write_is_rejected_not_reported_success(client, django_capture_on_commit_callbacks):
    job = _queued_job(client, django_capture_on_commit_callbacks)

    def takeover(**_):
        HouseholdAnalysisJob.objects.filter(id=job.id).update(celery_task_id="other-worker")
        return make_result(job.request_payload)

    with patch(ENGINE, side_effect=takeover):
        outcome = run_household_analysis_job(str(job.id))
    assert outcome == {"job_id": str(job.id), "skipped": True, "status": "stale_result_rejected"}
    job.refresh_from_db()
    assert job.status == HouseholdAnalysisJob.Status.RUNNING
    assert job.result_payload is None


def test_claim_duplicate_redelivery_and_attempt_limit(client, django_capture_on_commit_callbacks):
    job = _queued_job(client, django_capture_on_commit_callbacks)
    assert claim_household_analysis_job(str(job.id), "task-1") is not None
    assert claim_household_analysis_job(str(job.id), "task-1", redelivered=False) is None
    assert claim_household_analysis_job(str(job.id), "task-1", redelivered=True) is not None
    assert claim_household_analysis_job(str(job.id), "task-1", redelivered=True) is None
    job.refresh_from_db()
    assert job.status == HouseholdAnalysisJob.Status.FAILED
    assert job.error_code == "max_attempts_exceeded"


def test_failed_job_retry_in_place(client, django_capture_on_commit_callbacks):
    job = _queued_job(client, django_capture_on_commit_callbacks)
    with patch(ENGINE, side_effect=RuntimeError("boom")):
        run_household_analysis_job(str(job.id))
    with patch(PUBLISH) as publish:
        with django_capture_on_commit_callbacks(execute=True):
            retry = client.post(URL, valid_body(), format="json")
    assert retry.status_code == 202
    assert retry.json()["job_id"] == str(job.id)
    publish.assert_called_once()
    job.refresh_from_db()
    assert job.status == HouseholdAnalysisJob.Status.QUEUED
    assert job.dataset_sha256 == live_provenance()["dataset_sha256"]


def test_task_source_calls_only_public_facade_without_fx_bundle():
    source = inspect.getsource(run_household_analysis_job)
    assert "from research_engine import analyze_household" in source
    assert "_fx_bundle=" not in source
    assert "_fx_bundle =" not in source
    assert "optimize_cell" not in source
    assert "evaluate_weights" not in source


def test_views_never_import_engine_or_compute():
    source = (Path(__file__).resolve().parents[1] / "calculations" / "views.py").read_text()
    assert "from research_engine" not in source
    tree = ast.parse(source)
    called = {
        node.func.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    }
    assert "analyze_household" not in called


def test_task_limits_and_default_queue(settings):
    assert run_household_analysis_job.name == "calculations.run_household_analysis_job"
    assert int(run_household_analysis_job.soft_time_limit) == settings.HOUSEHOLD_ANALYSIS_TASK_SOFT_TIME_LIMIT == 180
    assert int(run_household_analysis_job.time_limit) == settings.HOUSEHOLD_ANALYSIS_TASK_TIME_LIMIT == 240
    assert settings.HOUSEHOLD_ANALYSIS_LEASE_SECONDS == 300
    assert "calculations.run_household_analysis_job" not in settings.CELERY_TASK_ROUTES
    assert settings.CELERY_TASK_ANNOTATIONS["calculations.run_household_analysis_job"] == {
        "soft_time_limit": 180,
        "time_limit": 240,
    }


# ---------------------------------------------------------------------------
# Retention
# ---------------------------------------------------------------------------


def _household_row(status, completed_at, fingerprint):
    live = live_provenance()
    return HouseholdAnalysisJob.objects.create(
        status=status,
        request_fingerprint=fingerprint,
        request_payload=normalized(),
        completed_at=completed_at,
        **snapshot_from_provenance(live),
    )


@override_settings(JOB_RETENTION_DAYS=7)
def test_retention_deletes_terminal_household_jobs_only(capsys):
    now = timezone.now()
    old = now - timedelta(days=8)
    _household_row(HouseholdAnalysisJob.Status.SUCCEEDED, old, "h-old-success")
    _household_row(HouseholdAnalysisJob.Status.FAILED, old, "h-old-failed")
    _household_row(HouseholdAnalysisJob.Status.SUCCEEDED, now - timedelta(days=6), "h-fresh")
    running = _household_row(HouseholdAnalysisJob.Status.RUNNING, None, "h-running")
    HouseholdAnalysisJob.objects.filter(id=running.id).update(updated_at=old)
    queued = _household_row(HouseholdAnalysisJob.Status.QUEUED, None, "h-queued")
    HouseholdAnalysisJob.objects.filter(id=queued.id).update(updated_at=old)
    OptimizationJob.objects.create(
        status=OptimizationJob.Status.FAILED,
        request_fingerprint="opt-old",
        request_payload={"profile": "P2"},
        model_version="1.0.0",
        data_as_of="2025-12-31",
        completed_at=old,
    )

    call_command("cleanup_expired_jobs", "--dry-run")
    dry = capsys.readouterr().out
    assert "optimization=1 buffer_sensitivity=0 household_analysis=2 total=3" in dry
    assert HouseholdAnalysisJob.objects.count() == 5

    result = cleanup_expired_jobs()
    assert result.household_analysis_count == 2
    assert result.total == 3
    remaining = set(HouseholdAnalysisJob.objects.values_list("request_fingerprint", flat=True))
    assert remaining == {"h-fresh", "h-running", "h-queued"}
    assert BufferSensitivityJob.objects.count() == 0
    assert "0.3" not in dry  # no payload values in output
