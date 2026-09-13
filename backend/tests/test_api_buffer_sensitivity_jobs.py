"""API and lifecycle tests for buffer-sensitivity batch jobs.

These tests mock the research optimizer. They must not run the real 10k-path
path generation in the fast suite.
"""

from __future__ import annotations

import ast
import inspect
import json
from datetime import timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
from celery.exceptions import SoftTimeLimitExceeded
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.db import IntegrityError
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework.throttling import AnonRateThrottle

from calculations.batch_contract import (
    BUFFER_SENSITIVITY_CONTRACT_VERSION,
    DOCUMENTED_BUFFERS,
    BatchResultValidationError,
    build_batch_result_payload,
    build_buffer_result_row,
    compute_batch_fingerprint,
    normalize_batch_request_payload,
    validate_batch_result_payload,
)
from calculations.batch_services import (
    QUEUE_UNAVAILABLE_MESSAGE,
    SAFE_FAILURE_MESSAGE,
    claim_buffer_sensitivity_job,
    create_or_reuse_buffer_sensitivity_job,
    store_buffer_sensitivity_failure,
    store_buffer_sensitivity_success,
)
from calculations.manifest import (
    compute_request_fingerprint,
    data_as_of,
    dataset_sha256,
    model_version,
    normalize_request_payload,
)
from calculations.models import BufferSensitivityJob, OptimizationJob
from calculations.tasks import run_buffer_sensitivity_job, run_optimization_job
from project.settings import (
    BUFFER_SENSITIVITY_LEASE_SAFETY_MARGIN_SECONDS,
    BUFFER_SENSITIVITY_LEASE_SECONDS,
    BUFFER_SENSITIVITY_QUEUE,
    BUFFER_SENSITIVITY_TASK_SOFT_TIME_LIMIT,
    BUFFER_SENSITIVITY_TASK_TIME_LIMIT,
    OPTIMIZATION_LEASE_SAFETY_MARGIN_SECONDS,
    OPTIMIZATION_LEASE_SECONDS,
    OPTIMIZATION_TASK_SOFT_TIME_LIMIT,
    OPTIMIZATION_TASK_TIME_LIMIT,
    validate_task_time_limits,
)

pytestmark = pytest.mark.django_db

BATCH_URL = "/api/v1/buffer-sensitivity-jobs/"


@pytest.fixture(autouse=True)
def _reset_throttles(settings):
    rates = {
        "optimization_submit": "1000/min",
        "buffer_sensitivity_submit": "1000/min",
        "job_poll": "1000/min",
        "model_metadata": "1000/min",
        "anon": "1000/min",
    }
    settings.REST_FRAMEWORK = {
        **settings.REST_FRAMEWORK,
        "DEFAULT_THROTTLE_RATES": rates,
    }
    AnonRateThrottle.THROTTLE_RATES = rates
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def batch_request():
    return {
        "profile": "P2",
        "horizon_years": 3,
        "expense_income_ratio": 0.95,
        "rebalance_frequency": "monthly",
        "conversion_cost": 0.0,
    }


def _optimize_payload_for_buffer(buffer_months: float) -> dict:
    return {
        "model_version": "1.0.0",
        "data_as_of": "2025-12-31",
        "simulation_paths": 10000,
        "simulation_seed": 42,
        "profile": "P2_foreign_income_mismatch",
        "horizon_years": 3,
        "weights": [1.0, 0.0, 0.0],
        "expense_income_ratio": 0.95,
        "buffer_months": float(buffer_months),
        "rebalance_frequency": "monthly",
        "conversion_cost": 0.0,
        "shortfall_probability": max(0.0, 0.05 - 0.01 * buffer_months),
        "var95_cumulative_shortfall": max(0.0, 1.0 - 0.05 * buffer_months),
        "cvar95_cumulative_shortfall": max(0.0, 1.2 - 0.05 * buffer_months),
        "mean_cumulative_shortfall": max(0.0, 0.06 - 0.004 * buffer_months),
        "identification_class": "A_WELL_IDENTIFIED",
        "n_coarse": 1326,
        "n_refined": 199,
        "n_surface": 1473,
        "near_optimal_1pct_frac": 0.02,
        "near_optimal_1pct_count": 35,
        "wealth_depletion_probability": 0.01,
        "mean_terminal_wealth": 9.0,
        "median_terminal_wealth": 7.0,
        "p05_terminal_wealth": 0.5,
        "p95_terminal_wealth": 20.0,
    }


@pytest.fixture
def fake_batch_optimize():
    def _side_effect(**kwargs):
        return _optimize_payload_for_buffer(kwargs["buffer_months"])

    return _side_effect


def test_batch_defaults_and_accepted_inputs(api_client, django_capture_on_commit_callbacks):
    with patch("calculations.tasks.run_buffer_sensitivity_job.apply_async") as mock_delay:
        with django_capture_on_commit_callbacks(execute=True):
            response = api_client.post(
                BATCH_URL,
                {"profile": "P2", "horizon_years": 3},
                format="json",
            )
    assert response.status_code == 202
    body = response.json()
    assert body["cached"] is False
    assert body["status"] == "queued"
    assert body["contract_version"] == BUFFER_SENSITIVITY_CONTRACT_VERSION
    assert body["tested_buffers"] == DOCUMENTED_BUFFERS
    job = BufferSensitivityJob.objects.get(id=body["job_id"])
    assert job.request_payload["expense_income_ratio"] == 0.95
    assert job.request_payload["rebalance_frequency"] == "monthly"
    assert job.request_payload["conversion_cost"] == 0.0
    assert "buffer_months" not in job.request_payload
    mock_delay.assert_called_once()
    assert mock_delay.call_args.kwargs["queue"] == BUFFER_SENSITIVITY_QUEUE


def test_batch_unknown_fields_rejected(api_client, batch_request):
    payload = {**batch_request, "unexpected": True}
    response = api_client.post(BATCH_URL, payload, format="json")
    assert response.status_code == 400
    assert "unknown_fields" in response.json()["error"]["details"]


@pytest.mark.parametrize(
    "field,value",
    [
        ("buffer_months", 1),
        ("buffers", [1, 3]),
        ("buffer_set", [1]),
        ("tested_buffers", [1, 3, 6, 12]),
        ("target", 0.05),
        ("target_metric", "shortfall_probability"),
        ("target_value", 0.05),
        ("risk_target", 0.1),
        ("n_paths", 1000),
        ("seed", 7),
        ("_fx_bundle", []),
        ("fx_bundle", []),
        ("model_version", "x"),
        ("dataset_path", "/tmp/x"),
        ("weights", [1, 0, 0]),
        ("grid", {}),
    ],
)
def test_batch_forbidden_fields_rejected(api_client, batch_request, field, value):
    payload = {**batch_request, field: value}
    response = api_client.post(BATCH_URL, payload, format="json")
    assert response.status_code == 400
    assert "forbidden_fields" in response.json()["error"]["details"]


def test_batch_fingerprint_stable_and_separated_from_single(batch_request):
    normalized = normalize_batch_request_payload(batch_request)
    first = compute_batch_fingerprint(normalized)
    second = compute_batch_fingerprint(normalized)
    assert first == second

    with_targetish = dict(normalized)
    # Targets are not part of fingerprint material; identical scenario stays identical.
    assert compute_batch_fingerprint(with_targetish) == first

    single = normalize_request_payload({**batch_request, "buffer_months": 1})
    assert compute_request_fingerprint(single) != first

    changed = dict(normalized)
    changed["horizon_years"] = 5
    assert compute_batch_fingerprint(changed) != first


def test_batch_fingerprint_changes_with_contract_and_provenance(batch_request):
    normalized = normalize_batch_request_payload(batch_request)
    baseline = compute_batch_fingerprint(normalized)
    with patch(
        "calculations.batch_contract.BUFFER_SENSITIVITY_CONTRACT_VERSION",
        "buffer_sensitivity_batch_v_test",
    ):
        assert compute_batch_fingerprint(normalized) != baseline
    with patch(
        "calculations.batch_contract.BUFFER_SENSITIVITY_PRESENTATION_VERSION",
        "presentation_v_test",
    ):
        assert compute_batch_fingerprint(normalized) != baseline
    with patch("calculations.batch_contract.model_version", return_value="9.9.9"):
        assert compute_batch_fingerprint(normalized) != baseline
    with patch("calculations.batch_contract.data_as_of", return_value="1900-01-01"):
        assert compute_batch_fingerprint(normalized) != baseline


@override_settings(CELERY_TASK_ALWAYS_EAGER=False)
def test_batch_sequential_duplicate_submission_one_dispatch(
    api_client,
    batch_request,
    django_capture_on_commit_callbacks,
):
    """Sequential identical POSTs reuse one row and dispatch once (not a true race)."""
    with patch("calculations.tasks.run_buffer_sensitivity_job.apply_async") as mock_delay:
        with django_capture_on_commit_callbacks(execute=True):
            first = api_client.post(BATCH_URL, batch_request, format="json")
        job_id = first.json()["job_id"]
        with django_capture_on_commit_callbacks(execute=True):
            second = api_client.post(BATCH_URL, batch_request, format="json")
        assert second.status_code == 202
        assert second.json()["job_id"] == job_id
        assert mock_delay.call_count == 1
        assert BufferSensitivityJob.objects.count() == 1


def test_batch_integrity_race_reuses_existing(batch_request):
    winner = create_or_reuse_buffer_sensitivity_job(batch_request)
    assert winner.created is True
    empty = MagicMock()
    empty.select_for_update.return_value.first.return_value = None
    with patch.object(BufferSensitivityJob.objects, "filter", return_value=empty):
        with patch.object(
            BufferSensitivityJob.objects,
            "create",
            side_effect=IntegrityError("UNIQUE constraint failed"),
        ):
            outcome = create_or_reuse_buffer_sensitivity_job(batch_request)
    assert outcome.created is False
    assert outcome.job.id == winner.job.id
    assert outcome.should_dispatch is False


@override_settings(CELERY_TASK_ALWAYS_EAGER=False)
def test_batch_cached_success(
    api_client,
    batch_request,
    fake_batch_optimize,
    django_capture_on_commit_callbacks,
):
    with patch("calculations.tasks.run_buffer_sensitivity_job.apply_async") as mock_delay:
        with django_capture_on_commit_callbacks(execute=True):
            create = api_client.post(BATCH_URL, batch_request, format="json")
        job_id = create.json()["job_id"]
        with patch("research_engine.optimize_allocation", side_effect=fake_batch_optimize):
            run_buffer_sensitivity_job(job_id)
        with django_capture_on_commit_callbacks(execute=True):
            again = api_client.post(BATCH_URL, batch_request, format="json")
        assert again.status_code == 200
        assert again.json()["cached"] is True
        assert again.json()["job_id"] == job_id
        assert again.json()["result"]["tested_buffers"] == DOCUMENTED_BUFFERS
        assert mock_delay.call_count == 1


def test_batch_worker_four_public_calls_ordered_no_fx_bundle(fake_batch_optimize):
    scenario = normalize_batch_request_payload(
        {
            "profile": "P2",
            "horizon_years": 3,
            "expense_income_ratio": 0.95,
            "rebalance_frequency": "monthly",
            "conversion_cost": 0.0,
        }
    )
    job = BufferSensitivityJob.objects.create(
        status=BufferSensitivityJob.Status.QUEUED,
        request_fingerprint=compute_batch_fingerprint(scenario),
        request_payload=scenario,
        model_version="1.0.0",
        data_as_of="2025-12-31",
        contract_version=BUFFER_SENSITIVITY_CONTRACT_VERSION,
    )
    with patch(
        "research_engine.optimize_allocation", side_effect=fake_batch_optimize
    ) as mock_opt:
        result = run_buffer_sensitivity_job(str(job.id))
    assert result["status"] == "succeeded"
    assert mock_opt.call_count == 4
    buffers = [c.kwargs["buffer_months"] for c in mock_opt.call_args_list]
    assert buffers == [1.0, 3.0, 6.0, 12.0]
    for c in mock_opt.call_args_list:
        assert "_fx_bundle" not in c.kwargs
        assert len(c.args) == 0 or "_fx_bundle" not in str(c)
    job.refresh_from_db()
    assert job.status == BufferSensitivityJob.Status.SUCCEEDED
    payload = job.result_payload
    assert payload["tested_buffers"] == DOCUMENTED_BUFFERS
    assert [row["buffer_months"] for row in payload["results"]] == [1.0, 3.0, 6.0, 12.0]
    for row in payload["results"]:
        assert "mean_cumulative_shortfall" not in row
        assert "mean_cumulative_shortfall" in row["implementation_only"]
        assert "resilience_score" not in row
        assert "recommended_buffer" not in row
    json.dumps(payload)


def test_batch_atomic_failure_no_partial_result(fake_batch_optimize):
    scenario = normalize_batch_request_payload(
        {
            "profile": "P2",
            "horizon_years": 3,
            "expense_income_ratio": 0.95,
            "rebalance_frequency": "monthly",
            "conversion_cost": 0.0,
        }
    )
    job = BufferSensitivityJob.objects.create(
        status=BufferSensitivityJob.Status.QUEUED,
        request_fingerprint=compute_batch_fingerprint(scenario),
        request_payload=scenario,
        model_version="1.0.0",
        data_as_of="2025-12-31",
        contract_version=BUFFER_SENSITIVITY_CONTRACT_VERSION,
    )

    def _fail_on_third(**kwargs):
        if kwargs["buffer_months"] == 6.0:
            raise RuntimeError("boom at buffer 6")
        return fake_batch_optimize(**kwargs)

    with patch("research_engine.optimize_allocation", side_effect=_fail_on_third):
        result = run_buffer_sensitivity_job(str(job.id))
    job.refresh_from_db()
    assert result["status"] == "failed"
    assert job.status == BufferSensitivityJob.Status.FAILED
    assert job.result_payload is None
    assert job.error_code == "optimization_failed"
    assert job.error_message == SAFE_FAILURE_MESSAGE
    assert "boom" not in (job.error_message or "")


def test_batch_soft_timeout_fails_whole_job(fake_batch_optimize):
    scenario = normalize_batch_request_payload(
        {
            "profile": "P2",
            "horizon_years": 3,
            "expense_income_ratio": 0.95,
            "rebalance_frequency": "monthly",
            "conversion_cost": 0.0,
        }
    )
    job = BufferSensitivityJob.objects.create(
        status=BufferSensitivityJob.Status.QUEUED,
        request_fingerprint=compute_batch_fingerprint(scenario),
        request_payload=scenario,
        model_version="1.0.0",
        data_as_of="2025-12-31",
        contract_version=BUFFER_SENSITIVITY_CONTRACT_VERSION,
    )
    with patch(
        "research_engine.optimize_allocation",
        side_effect=SoftTimeLimitExceeded(),
    ):
        result = run_buffer_sensitivity_job(str(job.id))
    job.refresh_from_db()
    assert result["status"] == "failed"
    assert job.error_code == "soft_time_limit"
    assert job.result_payload is None


def test_batch_claim_redelivery_and_stale_protection():
    job = BufferSensitivityJob.objects.create(
        status=BufferSensitivityJob.Status.QUEUED,
        request_fingerprint="batch-lease",
        request_payload={"profile": "P2_foreign_income_mismatch", "horizon_years": 3,
                         "expense_income_ratio": 0.95, "rebalance_frequency": "monthly",
                         "conversion_cost": 0.0},
        model_version="1.0.0",
        data_as_of="2025-12-31",
    )
    first = claim_buffer_sensitivity_job(str(job.id), "task-1")
    assert first is not None
    assert claim_buffer_sensitivity_job(str(job.id), "task-1", redelivered=False) is None
    assert claim_buffer_sensitivity_job(str(job.id), "task-2") is None
    second = claim_buffer_sensitivity_job(str(job.id), "task-1", redelivered=True)
    assert second is not None
    assert second.attempt_count == 2
    assert claim_buffer_sensitivity_job(str(job.id), "task-1", redelivered=True) is None
    job.refresh_from_db()
    assert job.status == BufferSensitivityJob.Status.FAILED
    assert job.error_code == "max_attempts_exceeded"


def test_batch_expired_lease_recovery_and_stale_store(fake_batch_optimize):
    job = BufferSensitivityJob.objects.create(
        status=BufferSensitivityJob.Status.RUNNING,
        request_fingerprint="batch-expired",
        request_payload={"profile": "P2_foreign_income_mismatch", "horizon_years": 3,
                         "expense_income_ratio": 0.95, "rebalance_frequency": "monthly",
                         "conversion_cost": 0.0},
        model_version="1.0.0",
        data_as_of="2025-12-31",
        celery_task_id="old-task",
        attempt_count=1,
        lease_expires_at=timezone.now() - timedelta(seconds=5),
    )
    recovered = claim_buffer_sensitivity_job(str(job.id), "new-task")
    assert recovered is not None
    rows = [build_buffer_result_row(_optimize_payload_for_buffer(b)) for b in DOCUMENTED_BUFFERS]
    result = build_batch_result_payload(
        scenario=job.request_payload,
        buffer_rows=rows,
        provenance_source=_optimize_payload_for_buffer(1),
    )
    assert store_buffer_sensitivity_success(str(job.id), "new-task", result) is True
    assert store_buffer_sensitivity_success(str(job.id), "stale-task", result) is False
    assert (
        store_buffer_sensitivity_failure(
            str(job.id),
            "stale-task",
            error_code="optimization_failed",
            exc=RuntimeError("late"),
        )
        is False
    )
    job.refresh_from_db()
    assert job.status == BufferSensitivityJob.Status.SUCCEEDED


@pytest.mark.django_db(transaction=True)
@override_settings(CELERY_TASK_ALWAYS_EAGER=False)
def test_batch_broker_failure_returns_503(api_client, batch_request):
    with patch(
        "calculations.tasks.run_buffer_sensitivity_job.apply_async",
        side_effect=ConnectionError("redis down"),
    ):
        response = api_client.post(BATCH_URL, batch_request, format="json")
    assert response.status_code == 503
    body = response.json()
    assert body["error"]["code"] == "queue_unavailable"
    assert body["error"]["message"] == QUEUE_UNAVAILABLE_MESSAGE
    job = BufferSensitivityJob.objects.get(id=body["job_id"])
    assert job.status == BufferSensitivityJob.Status.FAILED
    assert job.error_code == "queue_unavailable"


@override_settings(BUFFER_SENSITIVITY_SUBMISSIONS_ENABLED=False)
def test_batch_feature_switch_disables_post_keeps_get(api_client, batch_request):
    job = BufferSensitivityJob.objects.create(
        status=BufferSensitivityJob.Status.SUCCEEDED,
        request_fingerprint="switch",
        request_payload=normalize_batch_request_payload(batch_request),
        result_payload={"contract_version": BUFFER_SENSITIVITY_CONTRACT_VERSION},
        model_version="1.0.0",
        data_as_of="2025-12-31",
    )
    post = api_client.post(BATCH_URL, batch_request, format="json")
    assert post.status_code == 503
    assert post.json()["error"]["code"] == "submissions_disabled"
    detail = api_client.get(f"{BATCH_URL}{job.id}/")
    assert detail.status_code == 200
    assert detail.json()["status"] == "succeeded"


def test_batch_404_and_poll_detail(api_client):
    missing = api_client.get("/api/v1/buffer-sensitivity-jobs/00000000-0000-0000-0000-000000000001/")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"


@override_settings(
    REST_FRAMEWORK={
        "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
        "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
        "DEFAULT_THROTTLE_RATES": {
            "optimization_submit": "1000/min",
            "buffer_sensitivity_submit": "2/min",
            "job_poll": "120/min",
            "model_metadata": "60/min",
            "anon": "60/min",
        },
        "EXCEPTION_HANDLER": "calculations.exceptions.api_exception_handler",
        "UNAUTHENTICATED_USER": None,
    }
)
def test_batch_submit_throttle_separate_from_optimization(
    api_client,
    batch_request,
    django_capture_on_commit_callbacks,
):
    cache.clear()
    AnonRateThrottle.THROTTLE_RATES = {
        "optimization_submit": "1000/min",
        "buffer_sensitivity_submit": "2/min",
        "job_poll": "120/min",
        "model_metadata": "60/min",
        "anon": "60/min",
    }
    bodies = [
        {**batch_request, "profile": "P1"},
        {**batch_request, "profile": "P2"},
        {**batch_request, "profile": "P3"},
    ]
    with patch("calculations.tasks.run_buffer_sensitivity_job.apply_async"):
        with patch("calculations.tasks.run_optimization_job.delay"):
            statuses = []
            for body in bodies:
                with django_capture_on_commit_callbacks(execute=True):
                    statuses.append(
                        api_client.post(BATCH_URL, body, format="json").status_code
                    )
            # Optimization quota untouched.
            opt = api_client.post(
                "/api/v1/optimization-jobs/",
                {
                    "profile": "P4",
                    "horizon_years": 3,
                    "buffer_months": 1,
                    "expense_income_ratio": 0.95,
                    "rebalance_frequency": "monthly",
                    "conversion_cost": 0.0,
                },
                format="json",
            )
    assert statuses[:2] == [202, 202]
    assert statuses[2] == 429
    assert opt.status_code == 202


def test_http_views_never_invoke_optimizer_directly():
    views_path = Path(__file__).resolve().parents[1] / "calculations" / "views.py"
    source = views_path.read_text(encoding="utf-8")
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            names = [alias.name for alias in node.names]
            assert "optimize_allocation" not in names
            assert (node.module or "") != "research_engine"
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name):
                assert func.id != "optimize_allocation"
            if isinstance(func, ast.Attribute):
                assert func.attr != "optimize_allocation"
    assert "from research_engine" not in source


def test_task_routing_and_documented_limits():
    assert run_buffer_sensitivity_job.name == "calculations.run_buffer_sensitivity_job"
    assert run_buffer_sensitivity_job.queue == BUFFER_SENSITIVITY_QUEUE
    assert int(run_buffer_sensitivity_job.soft_time_limit) == BUFFER_SENSITIVITY_TASK_SOFT_TIME_LIMIT
    assert int(run_buffer_sensitivity_job.time_limit) == BUFFER_SENSITIVITY_TASK_TIME_LIMIT
    assert int(run_optimization_job.soft_time_limit) == OPTIMIZATION_TASK_SOFT_TIME_LIMIT
    assert int(run_optimization_job.time_limit) == OPTIMIZATION_TASK_TIME_LIMIT
    assert OPTIMIZATION_LEASE_SECONDS >= OPTIMIZATION_TASK_TIME_LIMIT + OPTIMIZATION_LEASE_SAFETY_MARGIN_SECONDS
    assert (
        BUFFER_SENSITIVITY_LEASE_SECONDS
        >= BUFFER_SENSITIVITY_TASK_TIME_LIMIT + BUFFER_SENSITIVITY_LEASE_SAFETY_MARGIN_SECONDS
    )
    validate_task_time_limits(
        soft_time_limit=OPTIMIZATION_TASK_SOFT_TIME_LIMIT,
        hard_time_limit=OPTIMIZATION_TASK_TIME_LIMIT,
        lease_seconds=OPTIMIZATION_LEASE_SECONDS,
        safety_margin_seconds=OPTIMIZATION_LEASE_SAFETY_MARGIN_SECONDS,
        label="optimization job",
    )
    with pytest.raises(ImproperlyConfigured):
        validate_task_time_limits(
            soft_time_limit=240,
            hard_time_limit=180,
            lease_seconds=300,
            safety_margin_seconds=60,
            label="bad soft/hard",
        )
    with pytest.raises(ImproperlyConfigured):
        validate_task_time_limits(
            soft_time_limit=100,
            hard_time_limit=180,
            lease_seconds=200,
            safety_margin_seconds=60,
            label="bad lease margin",
        )


def test_batch_result_builder_rejects_numpy_and_nonfinite():
    rows = [build_buffer_result_row(_optimize_payload_for_buffer(b)) for b in DOCUMENTED_BUFFERS]
    payload = build_batch_result_payload(
        scenario=normalize_batch_request_payload(
            {
                "profile": "P2",
                "horizon_years": 3,
                "expense_income_ratio": 0.95,
                "rebalance_frequency": "monthly",
                "conversion_cost": 0.0,
            }
        ),
        buffer_rows=rows,
        provenance_source=_optimize_payload_for_buffer(1),
    )
    validate_batch_result_payload(payload)

    payload["results"][0]["weights"] = np.array([1.0, 0.0, 0.0])
    with pytest.raises((TypeError, BatchResultValidationError)):
        validate_batch_result_payload(payload)

    with pytest.raises(BatchResultValidationError):
        build_buffer_result_row(
            {
                **_optimize_payload_for_buffer(1),
                "cvar95_cumulative_shortfall": float("nan"),
            }
        )


@override_settings(CELERY_TASK_ALWAYS_EAGER=False)
def test_batch_failed_retry_in_place(
    api_client,
    batch_request,
    django_capture_on_commit_callbacks,
):
    with patch("calculations.tasks.run_buffer_sensitivity_job.apply_async") as mock_delay:
        with django_capture_on_commit_callbacks(execute=True):
            create = api_client.post(BATCH_URL, batch_request, format="json")
        job = BufferSensitivityJob.objects.get(id=create.json()["job_id"])
        job.status = BufferSensitivityJob.Status.FAILED
        job.error_code = "optimization_failed"
        job.error_message = SAFE_FAILURE_MESSAGE
        job.attempt_count = 1
        job.save()
        with django_capture_on_commit_callbacks(execute=True):
            retry = api_client.post(BATCH_URL, batch_request, format="json")
        assert retry.status_code == 202
        assert retry.json()["job_id"] == str(job.id)
        job.refresh_from_db()
        assert job.status == BufferSensitivityJob.Status.QUEUED
        assert mock_delay.call_count == 2


def test_production_task_source_never_passes_fx_bundle():
    source = inspect.getsource(run_buffer_sensitivity_job)
    assert "optimize_allocation(" in source
    assert "_fx_bundle=" not in source
    assert "_fx_bundle =" not in source


def _valid_batch_payload():
    scenario = normalize_batch_request_payload(
        {
            "profile": "P2",
            "horizon_years": 3,
            "expense_income_ratio": 0.95,
            "rebalance_frequency": "monthly",
            "conversion_cost": 0.0,
        }
    )
    rows = [build_buffer_result_row(_optimize_payload_for_buffer(b)) for b in DOCUMENTED_BUFFERS]
    return build_batch_result_payload(
        scenario=scenario,
        buffer_rows=rows,
        provenance_source=_optimize_payload_for_buffer(1),
    )


def _assert_owned_failure(job, *, error_code: str, forbidden_snippets: list[str]):
    job.refresh_from_db()
    assert job.status == BufferSensitivityJob.Status.FAILED
    assert job.result_payload is None
    assert job.error_code == error_code
    assert job.error_message == SAFE_FAILURE_MESSAGE
    text = json.dumps(
        {
            "error_code": job.error_code,
            "error_message": job.error_message,
            "result": job.result_payload,
        }
    )
    for snippet in forbidden_snippets:
        assert snippet not in text


def test_validate_rejects_swapped_duplicate_wrong_and_missing_buffers():
    payload = _valid_batch_payload()
    swapped = dict(payload)
    swapped["results"] = [payload["results"][1], payload["results"][0], payload["results"][2], payload["results"][3]]
    with pytest.raises(BatchResultValidationError):
        validate_batch_result_payload(swapped)

    duplicated = dict(payload)
    duplicated["results"] = [payload["results"][0], payload["results"][0], payload["results"][2], payload["results"][3]]
    with pytest.raises(BatchResultValidationError):
        validate_batch_result_payload(duplicated)

    wrong_value = dict(payload)
    wrong_rows = [dict(r) for r in payload["results"]]
    wrong_rows[0] = dict(wrong_rows[0])
    wrong_rows[0]["buffer_months"] = 2.0
    wrong_value["results"] = wrong_rows
    with pytest.raises(BatchResultValidationError):
        validate_batch_result_payload(wrong_value)

    missing = dict(payload)
    missing["results"] = payload["results"][:3]
    with pytest.raises(BatchResultValidationError):
        validate_batch_result_payload(missing)


def test_validate_rejects_missing_unexpected_row_fields_and_impl_leak():
    payload = _valid_batch_payload()
    missing_field = dict(payload)
    row = dict(payload["results"][0])
    del row["shortfall_probability"]
    missing_field["results"] = [row, *payload["results"][1:]]
    with pytest.raises(BatchResultValidationError):
        validate_batch_result_payload(missing_field)

    unexpected = dict(payload)
    row = dict(payload["results"][0])
    row["internal_debug"] = True
    unexpected["results"] = [row, *payload["results"][1:]]
    with pytest.raises(BatchResultValidationError):
        validate_batch_result_payload(unexpected)

    leaked = dict(payload)
    row = dict(payload["results"][0])
    row["mean_cumulative_shortfall"] = 0.1
    leaked["results"] = [row, *payload["results"][1:]]
    with pytest.raises(BatchResultValidationError):
        validate_batch_result_payload(leaked)


def test_validate_rejects_weight_and_probability_and_count_corruption():
    payload = _valid_batch_payload()

    def _with_row_change(**changes):
        mutated = dict(payload)
        row = dict(payload["results"][0])
        row.update(changes)
        mutated["results"] = [row, *payload["results"][1:]]
        return mutated

    with pytest.raises(BatchResultValidationError):
        validate_batch_result_payload(_with_row_change(weights=[1.0, 0.0]))
    with pytest.raises(BatchResultValidationError):
        validate_batch_result_payload(_with_row_change(weights=[-0.1, 0.6, 0.5]))
    with pytest.raises(BatchResultValidationError):
        validate_batch_result_payload(_with_row_change(weights=[0.5, 0.5, 0.5]))
    with pytest.raises(BatchResultValidationError):
        validate_batch_result_payload(_with_row_change(shortfall_probability=True))
    with pytest.raises(BatchResultValidationError):
        validate_batch_result_payload(_with_row_change(shortfall_probability=1.5))
    with pytest.raises(BatchResultValidationError):
        validate_batch_result_payload(_with_row_change(cvar95_cumulative_shortfall=-0.01))
    with pytest.raises(BatchResultValidationError):
        validate_batch_result_payload(_with_row_change(var95_cumulative_shortfall=float("inf")))
    with pytest.raises(BatchResultValidationError):
        validate_batch_result_payload(_with_row_change(near_optimal_1pct_count=1.5))
    with pytest.raises(BatchResultValidationError):
        validate_batch_result_payload(_with_row_change(near_optimal_1pct_count=-1))
    with pytest.raises(BatchResultValidationError):
        validate_batch_result_payload(_with_row_change(n_coarse=True))
    with pytest.raises(BatchResultValidationError):
        validate_batch_result_payload(
            _with_row_change(near_optimal_1pct_count=999999, n_surface=10)
        )
    with pytest.raises(BatchResultValidationError):
        validate_batch_result_payload(_with_row_change(identification_class="Z_UNKNOWN"))


def test_validate_rejects_malformed_provenance_and_versions():
    payload = _valid_batch_payload()
    bad = dict(payload)
    provenance = dict(payload["provenance"])
    provenance["dataset_sha256"] = "not-a-sha"
    bad["provenance"] = provenance
    with pytest.raises(BatchResultValidationError):
        validate_batch_result_payload(bad)

    missing_prov = dict(payload)
    provenance = dict(payload["provenance"])
    del provenance["model_version"]
    missing_prov["provenance"] = provenance
    with pytest.raises(BatchResultValidationError):
        validate_batch_result_payload(missing_prov)

    bad_version = dict(payload)
    bad_version["contract_version"] = "other"
    with pytest.raises(BatchResultValidationError):
        validate_batch_result_payload(bad_version)

    assert len(payload["provenance"]["dataset_sha256"]) == 64
    assert payload["provenance"]["dataset_sha256"] == dataset_sha256()


def _queued_batch_job(
    *,
    fingerprint: str | None = None,
    model_version_value: str | None = None,
    data_as_of_value: str | None = None,
    contract_version_value: str | None = None,
):
    scenario = normalize_batch_request_payload(
        {
            "profile": "P2",
            "horizon_years": 3,
            "expense_income_ratio": 0.95,
            "rebalance_frequency": "monthly",
            "conversion_cost": 0.0,
        }
    )
    fp = fingerprint if fingerprint is not None else compute_batch_fingerprint(scenario)
    return BufferSensitivityJob.objects.create(
        status=BufferSensitivityJob.Status.QUEUED,
        request_fingerprint=fp,
        request_payload=scenario,
        model_version=model_version_value or model_version(),
        data_as_of=data_as_of_value or data_as_of(),
        contract_version=contract_version_value or BUFFER_SENSITIVITY_CONTRACT_VERSION,
    )


def test_worker_rejects_mismatched_scenario_echo():
    job = _queued_batch_job()

    def _bad_echo(**kwargs):
        payload = _optimize_payload_for_buffer(kwargs["buffer_months"])
        payload["horizon_years"] = 5
        return payload

    with patch("research_engine.optimize_allocation", side_effect=_bad_echo):
        result = run_buffer_sensitivity_job(str(job.id))
    assert result["status"] == "failed"
    _assert_owned_failure(
        job,
        error_code="result_validation_failed",
        forbidden_snippets=["horizon_years", "5", "mismatch", "Traceback"],
    )


def test_worker_rejects_cross_response_provenance_drift():
    job = _queued_batch_job()

    def _drift(**kwargs):
        payload = _optimize_payload_for_buffer(kwargs["buffer_months"])
        if kwargs["buffer_months"] == 6.0:
            payload["simulation_seed"] = 99
        return payload

    with patch("research_engine.optimize_allocation", side_effect=_drift):
        result = run_buffer_sensitivity_job(str(job.id))
    assert result["status"] == "failed"
    _assert_owned_failure(
        job,
        error_code="result_validation_failed",
        forbidden_snippets=["99", "simulation_seed", "Traceback"],
    )


def test_worker_rejects_changed_fingerprint_before_optimize():
    job = _queued_batch_job(fingerprint="0" * 64)
    with patch("research_engine.optimize_allocation") as mock_opt:
        result = run_buffer_sensitivity_job(str(job.id))
    assert mock_opt.call_count == 0
    assert result["status"] == "failed"
    _assert_owned_failure(
        job,
        error_code="provenance_changed",
        forbidden_snippets=["0" * 64, "fingerprint", "Traceback"],
    )


def test_worker_rejects_consistently_wrong_model_version():
    job = _queued_batch_job()

    def _wrong_model(**kwargs):
        payload = _optimize_payload_for_buffer(kwargs["buffer_months"])
        payload["model_version"] = "9.9.9"
        return payload

    with patch("research_engine.optimize_allocation", side_effect=_wrong_model) as mock_opt:
        result = run_buffer_sensitivity_job(str(job.id))
    assert mock_opt.call_count == 4
    assert result["status"] == "failed"
    _assert_owned_failure(
        job,
        error_code="result_validation_failed",
        forbidden_snippets=["9.9.9", "Traceback"],
    )


def test_worker_rejects_consistently_wrong_data_as_of():
    job = _queued_batch_job()

    def _wrong_date(**kwargs):
        payload = _optimize_payload_for_buffer(kwargs["buffer_months"])
        payload["data_as_of"] = "1900-01-01"
        return payload

    with patch("research_engine.optimize_allocation", side_effect=_wrong_date) as mock_opt:
        result = run_buffer_sensitivity_job(str(job.id))
    assert mock_opt.call_count == 4
    assert result["status"] == "failed"
    _assert_owned_failure(
        job,
        error_code="result_validation_failed",
        forbidden_snippets=["1900-01-01", "Traceback"],
    )


@pytest.mark.parametrize(
    "field,value",
    [
        ("model_version_value", "9.9.9"),
        ("data_as_of_value", "1900-01-01"),
        ("contract_version_value", "buffer_sensitivity_batch_v_old"),
    ],
)
def test_worker_rejects_job_snapshot_mismatch_before_optimize(field, value):
    kwargs = {field: value}
    job = _queued_batch_job(**kwargs)
    with patch("research_engine.optimize_allocation") as mock_opt:
        result = run_buffer_sensitivity_job(str(job.id))
    assert mock_opt.call_count == 0
    assert result["status"] == "failed"
    _assert_owned_failure(
        job,
        error_code="provenance_changed",
        forbidden_snippets=[str(value), "Traceback"],
    )


def test_build_batch_result_rejects_missing_provenance_without_fallback():
    scenario = normalize_batch_request_payload(
        {
            "profile": "P2",
            "horizon_years": 3,
            "expense_income_ratio": 0.95,
            "rebalance_frequency": "monthly",
            "conversion_cost": 0.0,
        }
    )
    rows = [build_buffer_result_row(_optimize_payload_for_buffer(b)) for b in DOCUMENTED_BUFFERS]
    incomplete = _optimize_payload_for_buffer(1)
    del incomplete["model_version"]
    with pytest.raises(BatchResultValidationError):
        build_batch_result_payload(
            scenario=scenario,
            buffer_rows=rows,
            provenance_source=incomplete,
        )
    none_model = _optimize_payload_for_buffer(1)
    none_model["model_version"] = None
    with pytest.raises(BatchResultValidationError):
        build_batch_result_payload(
            scenario=scenario,
            buffer_rows=rows,
            provenance_source=none_model,
        )


def test_stale_store_success_not_reported_as_succeeded(fake_batch_optimize):
    job = _queued_batch_job()
    with patch("research_engine.optimize_allocation", side_effect=fake_batch_optimize):
        with patch(
            "calculations.tasks.store_buffer_sensitivity_success",
            return_value=False,
        ) as mock_store:
            result = run_buffer_sensitivity_job(str(job.id))
    assert mock_store.called
    assert result["skipped"] is True
    assert result["status"] == "stale_result_rejected"
    job.refresh_from_db()
    # Ownership still this worker until a real stale race; mocked store leaves DB running.
    assert job.status == BufferSensitivityJob.Status.RUNNING
    assert job.result_payload is None
