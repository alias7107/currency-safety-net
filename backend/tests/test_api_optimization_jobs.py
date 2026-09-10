"""API and Celery tests for asynchronous optimization jobs.

These tests must not run the real 887 MB optimization path generation.
"""

from __future__ import annotations

import ast
import json
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.db import IntegrityError
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework.throttling import AnonRateThrottle

from calculations.models import OptimizationJob
from calculations.services import (
    MAX_ATTEMPTS,
    QUEUE_UNAVAILABLE_MESSAGE,
    SAFE_FAILURE_MESSAGE,
    claim_job_for_execution,
    create_or_reuse_job,
    store_failure,
    store_success,
)
from calculations.tasks import run_optimization_job
from project.settings import (
    DEV_SECRET_FALLBACK,
    validate_lease_configuration,
    validate_secret_configuration,
)
pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _reset_throttles(settings):
    """Keep default tests above the development submit throttle."""
    rates = {
        "optimization_submit": "1000/min",
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
def sample_request():
    return {
        "profile": "P2",
        "horizon_years": 3,
        "expense_income_ratio": 0.95,
        "buffer_months": 1,
        "rebalance_frequency": "monthly",
        "conversion_cost": 0.0,
    }


@pytest.fixture
def fake_result():
    return {
        "model_version": "1.0.0",
        "data_as_of": "2025-12-31",
        "simulation_paths": 10000,
        "simulation_seed": 42,
        "profile": "P2_foreign_income_mismatch",
        "horizon_years": 3,
        "weights": [1.0, 0.0, 0.0],
        "expense_income_ratio": 0.95,
        "buffer_months": 1.0,
        "rebalance_frequency": "monthly",
        "conversion_cost": 0.0,
        "shortfall_probability": 0.0491,
        "var95_cumulative_shortfall": 0.0,
        "cvar95_cumulative_shortfall": 1.1871802686857733,
        "mean_cumulative_shortfall": 0.05935901343428867,
        "identification_class": "A_WELL_IDENTIFIED",
        "n_coarse": 1326,
        "n_refined": 199,
        "n_surface": 1473,
        "near_optimal_1pct_frac": 0.02,
        "near_optimal_1pct_count": 35,
        "wealth_depletion_probability": 0.0,
        "mean_terminal_wealth": 1.0,
        "median_terminal_wealth": 1.0,
        "p05_terminal_wealth": 0.5,
        "p95_terminal_wealth": 1.5,
    }


def test_health_endpoint(api_client):
    response = api_client.get("/api/v1/health/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_metadata_endpoint(api_client):
    response = api_client.get("/api/v1/model/metadata/")
    assert response.status_code == 200
    body = response.json()
    assert body["model_version"] == "1.0.0"
    assert body["data_as_of"] == "2025-12-31"
    assert body["simulation_paths"] == 10000
    assert body["simulation_seed"] == 42
    assert "shortfall_probability" in body["risk_metric_names"]
    text = json.dumps(body)
    assert "/Users/" not in text
    assert "research_engine/data" not in text


def test_options_endpoint(api_client):
    response = api_client.get("/api/v1/model/options/")
    assert response.status_code == 200
    body = response.json()
    ids = {p["id"] for p in body["profiles"]}
    assert ids == {"P1", "P2", "P3", "P4"}
    assert body["horizons_years"] == [1, 3, 5]


@override_settings(CELERY_TASK_ALWAYS_EAGER=False)
def test_valid_job_creation(
    api_client,
    sample_request,
    fake_result,
    django_capture_on_commit_callbacks,
):
    with patch("calculations.tasks.run_optimization_job.delay") as mock_delay:
        with django_capture_on_commit_callbacks(execute=True):
            response = api_client.post(
                "/api/v1/optimization-jobs/",
                sample_request,
                format="json",
            )
        assert response.status_code == 202
        body = response.json()
        assert body["cached"] is False
        assert body["status"] == "queued"
        mock_delay.assert_called_once_with(body["job_id"])

    with patch("research_engine.optimize_allocation", return_value=fake_result):
        run_optimization_job(body["job_id"])
    detail = api_client.get(body["status_url"])
    assert detail.status_code == 200
    assert detail.json()["status"] == "succeeded"
    assert detail.json()["result"]["cvar95_cumulative_shortfall"] == pytest.approx(
        1.1871802686857733
    )


def test_unknown_fields_rejected(api_client, sample_request):
    payload = dict(sample_request)
    payload["unexpected"] = True
    response = api_client.post("/api/v1/optimization-jobs/", payload, format="json")
    assert response.status_code == 400
    assert "unknown_fields" in response.json()["error"]["details"]


def test_n_paths_and_seed_rejected(api_client, sample_request):
    for field, value in (("n_paths", 1000), ("seed", 7), ("_fx_bundle", []), ("model_version", "x")):
        payload = dict(sample_request)
        payload[field] = value
        response = api_client.post("/api/v1/optimization-jobs/", payload, format="json")
        assert response.status_code == 400
        assert "forbidden_fields" in response.json()["error"]["details"]


def test_invalid_model_parameters_rejected(api_client, sample_request):
    bad = dict(sample_request)
    bad["horizon_years"] = 2
    assert api_client.post("/api/v1/optimization-jobs/", bad, format="json").status_code == 400


@override_settings(CELERY_TASK_ALWAYS_EAGER=False)
def test_duplicate_active_job_reused(
    api_client,
    sample_request,
    django_capture_on_commit_callbacks,
):
    with patch("calculations.tasks.run_optimization_job.delay") as mock_delay:
        with django_capture_on_commit_callbacks(execute=True):
            first = api_client.post("/api/v1/optimization-jobs/", sample_request, format="json")
        job_id = first.json()["job_id"]
        with django_capture_on_commit_callbacks(execute=True):
            second = api_client.post("/api/v1/optimization-jobs/", sample_request, format="json")
        assert second.status_code == 202
        assert second.json()["job_id"] == job_id
        assert mock_delay.call_count == 1


@override_settings(CELERY_TASK_ALWAYS_EAGER=False)
def test_successful_cached_job_reused(
    api_client,
    sample_request,
    fake_result,
    django_capture_on_commit_callbacks,
):
    with patch("calculations.tasks.run_optimization_job.delay") as mock_delay:
        with django_capture_on_commit_callbacks(execute=True):
            create = api_client.post("/api/v1/optimization-jobs/", sample_request, format="json")
        job = OptimizationJob.objects.get(id=create.json()["job_id"])
        job.status = OptimizationJob.Status.SUCCEEDED
        job.result_payload = fake_result
        job.save()
        with django_capture_on_commit_callbacks(execute=True):
            again = api_client.post("/api/v1/optimization-jobs/", sample_request, format="json")
        assert again.status_code == 200
        assert again.json()["cached"] is True
        assert again.json()["result"]["weights"] == [1.0, 0.0, 0.0]
        assert mock_delay.call_count == 1


def test_celery_task_success(fake_result):
    job = OptimizationJob.objects.create(
        status=OptimizationJob.Status.QUEUED,
        request_fingerprint="abc",
        request_payload={
            "profile": "P2_foreign_income_mismatch",
            "horizon_years": 3,
            "expense_income_ratio": 0.95,
            "buffer_months": 1.0,
            "rebalance_frequency": "monthly",
            "conversion_cost": 0.0,
        },
        model_version="1.0.0",
        data_as_of="2025-12-31",
    )
    with patch("research_engine.optimize_allocation", return_value=fake_result):
        result = run_optimization_job(str(job.id))
    job.refresh_from_db()
    assert result["status"] == "succeeded"
    assert job.status == OptimizationJob.Status.SUCCEEDED
    assert job.attempt_count == 1
    assert job.celery_task_id is not None
    json.dumps(job.result_payload)


def test_celery_task_failure_safe_error():
    job = OptimizationJob.objects.create(
        status=OptimizationJob.Status.QUEUED,
        request_fingerprint="def",
        request_payload={
            "profile": "P2_foreign_income_mismatch",
            "horizon_years": 3,
            "expense_income_ratio": 0.95,
            "buffer_months": 1.0,
            "rebalance_frequency": "monthly",
            "conversion_cost": 0.0,
        },
        model_version="1.0.0",
        data_as_of="2025-12-31",
    )
    with patch("research_engine.optimize_allocation", side_effect=RuntimeError("boom")):
        result = run_optimization_job(str(job.id))
    job.refresh_from_db()
    assert result["status"] == "failed"
    assert job.error_code == "optimization_failed"
    assert job.error_message == SAFE_FAILURE_MESSAGE
    assert "boom" not in (job.error_message or "")


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


def test_result_payload_remains_json_safe(fake_result):
    unsafe = dict(fake_result)
    unsafe["bad"] = np.array([1.0, 2.0])
    job = OptimizationJob.objects.create(
        status=OptimizationJob.Status.QUEUED,
        request_fingerprint="ghi",
        request_payload={
            "profile": "P2_foreign_income_mismatch",
            "horizon_years": 3,
            "expense_income_ratio": 0.95,
            "buffer_months": 1.0,
            "rebalance_frequency": "monthly",
            "conversion_cost": 0.0,
        },
        model_version="1.0.0",
        data_as_of="2025-12-31",
    )
    with patch("research_engine.optimize_allocation", return_value=unsafe):
        run_optimization_job(str(job.id))
    job.refresh_from_db()
    assert job.status == OptimizationJob.Status.FAILED


def test_request_fingerprint_unique_enforced(sample_request):
    first = create_or_reuse_job(sample_request)
    with pytest.raises(IntegrityError):
        OptimizationJob.objects.create(
            status=OptimizationJob.Status.QUEUED,
            request_fingerprint=first.job.request_fingerprint,
            request_payload=first.job.request_payload,
            model_version="1.0.0",
            data_as_of="2025-12-31",
        )


def test_concurrent_insert_race_reuses_existing(sample_request):
    """Losing insert race must load the winner row and not dispatch again."""
    from unittest.mock import MagicMock

    winner = create_or_reuse_job(sample_request)
    assert winner.created is True

    empty = MagicMock()
    empty.select_for_update.return_value.first.return_value = None

    with patch.object(OptimizationJob.objects, "filter", return_value=empty):
        with patch.object(
            OptimizationJob.objects,
            "create",
            side_effect=IntegrityError("UNIQUE constraint failed"),
        ):
            # select_for_update().get() remains real and loads the winner row.
            outcome = create_or_reuse_job(sample_request)

    assert outcome.created is False
    assert outcome.job.id == winner.job.id
    assert outcome.should_dispatch is False
    assert (
        OptimizationJob.objects.filter(
            request_fingerprint=winner.job.request_fingerprint
        ).count()
        == 1
    )


@override_settings(CELERY_TASK_ALWAYS_EAGER=False)
def test_failed_job_retry(
    api_client,
    sample_request,
    fake_result,
    django_capture_on_commit_callbacks,
):
    with patch("calculations.tasks.run_optimization_job.delay") as mock_delay:
        with django_capture_on_commit_callbacks(execute=True):
            create = api_client.post("/api/v1/optimization-jobs/", sample_request, format="json")
        job = OptimizationJob.objects.get(id=create.json()["job_id"])
        job.status = OptimizationJob.Status.FAILED
        job.error_code = "optimization_failed"
        job.error_message = SAFE_FAILURE_MESSAGE
        job.attempt_count = 1
        job.save()
        with django_capture_on_commit_callbacks(execute=True):
            retry = api_client.post("/api/v1/optimization-jobs/", sample_request, format="json")
        assert retry.status_code == 202
        assert retry.json()["job_id"] == str(job.id)
        job.refresh_from_db()
        assert job.status == OptimizationJob.Status.QUEUED
        assert job.error_code is None
        assert mock_delay.call_count == 2


@pytest.mark.django_db(transaction=True)
@override_settings(CELERY_TASK_ALWAYS_EAGER=False)
def test_broker_publication_failure_returns_503(api_client, sample_request):
    with patch(
        "calculations.tasks.run_optimization_job.delay",
        side_effect=ConnectionError("redis down"),
    ):
        response = api_client.post(
            "/api/v1/optimization-jobs/",
            sample_request,
            format="json",
        )
    assert response.status_code == 503
    body = response.json()
    assert body["error"]["code"] == "queue_unavailable"
    assert body["error"]["message"] == QUEUE_UNAVAILABLE_MESSAGE
    job = OptimizationJob.objects.get(id=body["job_id"])
    assert job.status == OptimizationJob.Status.FAILED
    assert job.error_code == "queue_unavailable"
    assert "Traceback" not in (job.error_message or "")


def test_same_task_id_redelivery_counts_attempts():
    job = OptimizationJob.objects.create(
        status=OptimizationJob.Status.QUEUED,
        request_fingerprint="redeliver",
        request_payload={"profile": "P2_foreign_income_mismatch", "horizon_years": 3,
                         "expense_income_ratio": 0.95, "buffer_months": 1.0,
                         "rebalance_frequency": "monthly", "conversion_cost": 0.0},
        model_version="1.0.0",
        data_as_of="2025-12-31",
    )
    first = claim_job_for_execution(str(job.id), "task-1", redelivered=False)
    assert first is not None
    assert first.attempt_count == 1

    duplicate = claim_job_for_execution(str(job.id), "task-1", redelivered=False)
    assert duplicate is None
    job.refresh_from_db()
    assert job.attempt_count == 1
    assert job.status == OptimizationJob.Status.RUNNING

    second = claim_job_for_execution(str(job.id), "task-1", redelivered=True)
    assert second is not None
    assert second.attempt_count == 2

    third = claim_job_for_execution(str(job.id), "task-1", redelivered=True)
    assert third is None
    job.refresh_from_db()
    assert job.status == OptimizationJob.Status.FAILED
    assert job.error_code == "max_attempts_exceeded"
    assert job.attempt_count == 2


def test_different_task_id_rejected_while_lease_valid():
    job = OptimizationJob.objects.create(
        status=OptimizationJob.Status.QUEUED,
        request_fingerprint="lease-valid",
        request_payload={"profile": "P2_foreign_income_mismatch", "horizon_years": 3,
                         "expense_income_ratio": 0.95, "buffer_months": 1.0,
                         "rebalance_frequency": "monthly", "conversion_cost": 0.0},
        model_version="1.0.0",
        data_as_of="2025-12-31",
    )
    first = claim_job_for_execution(str(job.id), "task-a")
    assert first is not None
    skipped = claim_job_for_execution(str(job.id), "task-b")
    assert skipped is None
    job.refresh_from_db()
    assert job.celery_task_id == "task-a"
    assert job.attempt_count == 1


def test_expired_running_job_recovery():
    job = OptimizationJob.objects.create(
        status=OptimizationJob.Status.RUNNING,
        request_fingerprint="lease-expired",
        request_payload={"profile": "P2_foreign_income_mismatch", "horizon_years": 3,
                         "expense_income_ratio": 0.95, "buffer_months": 1.0,
                         "rebalance_frequency": "monthly", "conversion_cost": 0.0},
        model_version="1.0.0",
        data_as_of="2025-12-31",
        celery_task_id="old-task",
        attempt_count=1,
        lease_expires_at=timezone.now() - timedelta(seconds=5),
    )
    recovered = claim_job_for_execution(str(job.id), "new-task")
    assert recovered is not None
    job.refresh_from_db()
    assert job.celery_task_id == "new-task"
    assert job.attempt_count == 2
    assert job.lease_is_valid()


def test_maximum_attempt_failure():
    job = OptimizationJob.objects.create(
        status=OptimizationJob.Status.RUNNING,
        request_fingerprint="max-attempts",
        request_payload={"profile": "P2_foreign_income_mismatch", "horizon_years": 3,
                         "expense_income_ratio": 0.95, "buffer_months": 1.0,
                         "rebalance_frequency": "monthly", "conversion_cost": 0.0},
        model_version="1.0.0",
        data_as_of="2025-12-31",
        celery_task_id="old-task",
        attempt_count=MAX_ATTEMPTS,
        lease_expires_at=timezone.now() - timedelta(seconds=5),
    )
    skipped = claim_job_for_execution(str(job.id), "another-task")
    assert skipped is None
    job.refresh_from_db()
    assert job.status == OptimizationJob.Status.FAILED
    assert job.error_code == "max_attempts_exceeded"


def test_stale_worker_success_is_discarded(fake_result):
    job = OptimizationJob.objects.create(
        status=OptimizationJob.Status.RUNNING,
        request_fingerprint="stale-success",
        request_payload={"profile": "P2_foreign_income_mismatch", "horizon_years": 3,
                         "expense_income_ratio": 0.95, "buffer_months": 1.0,
                         "rebalance_frequency": "monthly", "conversion_cost": 0.0},
        model_version="1.0.0",
        data_as_of="2025-12-31",
        celery_task_id="owner-task",
        attempt_count=2,
        lease_expires_at=timezone.now() + timedelta(seconds=60),
    )
    owner_result = {**fake_result, "status": "ok"}
    assert store_success(str(job.id), "owner-task", owner_result) is True
    job.refresh_from_db()
    assert job.status == OptimizationJob.Status.SUCCEEDED
    assert job.result_payload["status"] == "ok"

    stale = {**fake_result, "status": "stale"}
    assert store_success(str(job.id), "stale-task", stale) is False
    job.refresh_from_db()
    assert job.status == OptimizationJob.Status.SUCCEEDED
    assert job.result_payload["status"] == "ok"
    assert job.celery_task_id == "owner-task"


def test_stale_worker_failure_is_discarded(fake_result):
    job = OptimizationJob.objects.create(
        status=OptimizationJob.Status.RUNNING,
        request_fingerprint="stale-failure",
        request_payload={"profile": "P2_foreign_income_mismatch", "horizon_years": 3,
                         "expense_income_ratio": 0.95, "buffer_months": 1.0,
                         "rebalance_frequency": "monthly", "conversion_cost": 0.0},
        model_version="1.0.0",
        data_as_of="2025-12-31",
        celery_task_id="owner-task",
        attempt_count=1,
        lease_expires_at=timezone.now() + timedelta(seconds=60),
    )
    assert store_success(str(job.id), "owner-task", fake_result) is True
    discarded = store_failure(
        str(job.id),
        "stale-task",
        error_code="optimization_failed",
        exc=RuntimeError("late failure"),
    )
    assert discarded is False
    job.refresh_from_db()
    assert job.status == OptimizationJob.Status.SUCCEEDED
    assert job.error_code is None
    assert job.result_payload is not None


def test_lease_must_exceed_hard_timeout_with_margin():
    validate_lease_configuration(lease_seconds=240, task_time_limit=180)
    with pytest.raises(ImproperlyConfigured):
        validate_lease_configuration(lease_seconds=180, task_time_limit=180)
    with pytest.raises(ImproperlyConfigured):
        validate_lease_configuration(lease_seconds=150, task_time_limit=180)
    with pytest.raises(ImproperlyConfigured):
        validate_lease_configuration(lease_seconds=200, task_time_limit=180)


@override_settings(
    REST_FRAMEWORK={
        "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
        "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
        "DEFAULT_THROTTLE_RATES": {
            "optimization_submit": "2/min",
            "job_poll": "120/min",
            "model_metadata": "60/min",
            "anon": "60/min",
        },
        "EXCEPTION_HANDLER": "calculations.exceptions.api_exception_handler",
        "UNAUTHENTICATED_USER": None,
    }
)
def test_optimization_post_scoped_throttling(
    api_client,
    sample_request,
    django_capture_on_commit_callbacks,
):
    cache.clear()
    AnonRateThrottle.THROTTLE_RATES = {
        "optimization_submit": "2/min",
        "job_poll": "120/min",
        "model_metadata": "60/min",
        "anon": "60/min",
    }
    bodies = [
        {**sample_request, "profile": "P1"},
        {**sample_request, "profile": "P2"},
        {**sample_request, "profile": "P3"},
    ]
    with patch("calculations.tasks.run_optimization_job.delay"):
        statuses = []
        for body in bodies:
            with django_capture_on_commit_callbacks(execute=True):
                statuses.append(
                    api_client.post("/api/v1/optimization-jobs/", body, format="json").status_code
                )
    assert statuses[:2] == [202, 202]
    assert statuses[2] == 429


def test_redis_compose_bound_to_localhost():
    compose_path = Path(__file__).resolve().parents[2] / "compose.yaml"
    text = compose_path.read_text(encoding="utf-8")
    assert '"127.0.0.1:6379:6379"' in text or "'127.0.0.1:6379:6379'" in text
    assert "- \"6379:6379\"" not in text
    assert "- '6379:6379'" not in text
    assert "- 6379:6379" not in text


def test_production_startup_rejects_development_secret():
    with pytest.raises(ImproperlyConfigured):
        validate_secret_configuration(debug=False, secret_key=DEV_SECRET_FALLBACK)
    validate_secret_configuration(debug=True, secret_key=DEV_SECRET_FALLBACK)
    validate_secret_configuration(debug=False, secret_key="production-secret-value")
