"""Phase 4B production configuration and operational helper tests."""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import patch

import pytest
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.core.management import call_command
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from calculations.models import BufferSensitivityJob, OptimizationJob
from calculations.retention import cleanup_expired_jobs, retention_cutoff
from project.runtime_config import (
    DEV_SECRET_FALLBACK,
    build_caches,
    build_databases,
    is_locmem_cache,
    validate_allowed_hosts,
    validate_production_redis,
    validate_retention_days,
    validate_secret_configuration,
)

pytestmark = pytest.mark.django_db


def test_validate_secret_configuration():
    with pytest.raises(ImproperlyConfigured):
        validate_secret_configuration(debug=False, secret_key=DEV_SECRET_FALLBACK)
    validate_secret_configuration(debug=True, secret_key=DEV_SECRET_FALLBACK)
    validate_secret_configuration(debug=False, secret_key="production-secret-value")


def test_validate_allowed_hosts_rejects_wildcard_in_production():
    validate_allowed_hosts(debug=True, allowed_hosts=["*"])
    with pytest.raises(ImproperlyConfigured):
        validate_allowed_hosts(debug=False, allowed_hosts=["*"])
    with pytest.raises(ImproperlyConfigured):
        validate_allowed_hosts(debug=False, allowed_hosts=[])
    validate_allowed_hosts(debug=False, allowed_hosts=["example.invalid"])


def test_build_databases_sqlite_in_debug_without_url():
    databases = build_databases(
        debug=True,
        sqlite_path="/tmp/csn-test.sqlite3",
        database_url=None,
        conn_max_age=60,
    )
    assert databases["default"]["ENGINE"] == "django.db.backends.sqlite3"


def test_build_databases_requires_postgres_when_not_debug():
    with pytest.raises(ImproperlyConfigured):
        build_databases(
            debug=False,
            sqlite_path="/tmp/x.sqlite3",
            database_url=None,
            conn_max_age=60,
        )
    databases = build_databases(
        debug=False,
        sqlite_path="/tmp/x.sqlite3",
        database_url="postgres://csn:secret@db:5432/csn",
        conn_max_age=60,
    )
    assert databases["default"]["ENGINE"] == "django.db.backends.postgresql"
    assert databases["default"]["NAME"] == "csn"
    assert databases["default"]["CONN_HEALTH_CHECKS"] is True
    assert databases["default"]["PASSWORD"] == "secret"


def test_build_caches_locmem_in_debug_redis_in_production():
    dev = build_caches(debug=True, cache_url="")
    assert is_locmem_cache(dev)
    prod = build_caches(debug=False, cache_url="redis://127.0.0.1:6379/2")
    assert not is_locmem_cache(prod)
    assert prod["default"]["BACKEND"].endswith("RedisCache")
    assert prod["default"]["LOCATION"] == "redis://127.0.0.1:6379/2"


def test_validate_production_redis_requires_distinct_cache():
    validate_production_redis(
        debug=True,
        broker_url="redis://127.0.0.1:6379/0",
        result_backend="redis://127.0.0.1:6379/1",
        cache_url="",
    )
    with pytest.raises(ImproperlyConfigured):
        validate_production_redis(
            debug=False,
            broker_url="redis://127.0.0.1:6379/0",
            result_backend="redis://127.0.0.1:6379/1",
            cache_url="",
        )
    with pytest.raises(ImproperlyConfigured):
        validate_production_redis(
            debug=False,
            broker_url="redis://127.0.0.1:6379/0",
            result_backend="redis://127.0.0.1:6379/1",
            cache_url="redis://127.0.0.1:6379/0",
        )
    validate_production_redis(
        debug=False,
        broker_url="redis://127.0.0.1:6379/0",
        result_backend="redis://127.0.0.1:6379/1",
        cache_url="redis://127.0.0.1:6379/2",
    )


def test_retention_days_bounds():
    assert validate_retention_days(7) == 7
    with pytest.raises(ImproperlyConfigured):
        validate_retention_days(0)
    with pytest.raises(ImproperlyConfigured):
        validate_retention_days(366)


def test_health_is_liveness_only(api_client=None):
    client = APIClient()
    response = client.get("/api/v1/health/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ready_succeeds_with_db_and_cache():
    client = APIClient()
    response = client.get("/api/v1/ready/")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["checks"]["database"] == "ok"
    assert body["checks"]["cache"] == "ok"


def test_ready_fails_when_cache_unavailable():
    client = APIClient()
    with patch("django.core.cache.cache.set", side_effect=RuntimeError("down")):
        response = client.get("/api/v1/ready/")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "not_ready"
    assert "cache" in body["checks"]
    assert "RuntimeError" not in str(body)


def test_ready_fails_when_database_unavailable():
    client = APIClient()
    with patch(
        "django.db.connection.ensure_connection",
        side_effect=RuntimeError("db-down"),
    ):
        response = client.get("/api/v1/ready/")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "not_ready"
    assert "database" in body["checks"]
    assert "db-down" not in str(body)


@override_settings(OPTIMIZATION_SUBMISSIONS_ENABLED=False)
def test_optimization_submissions_disabled_blocks_post_not_get():
    client = APIClient()
    job = OptimizationJob.objects.create(
        status=OptimizationJob.Status.SUCCEEDED,
        request_fingerprint="fp-freeze-opt",
        request_payload={"profile": "P2_foreign_income_mismatch"},
        result_payload={"ok": True},
        model_version="1.0.0",
        data_as_of="2025-12-31",
    )
    with patch("calculations.services._publish_to_broker") as publish:
        response = client.post(
            "/api/v1/optimization-jobs/",
            {
                "profile": "P2",
                "horizon_years": 3,
                "expense_income_ratio": 0.95,
                "buffer_months": 1,
                "rebalance_frequency": "monthly",
                "conversion_cost": 0.0,
            },
            format="json",
        )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "submissions_disabled"
    publish.assert_not_called()

    detail = client.get(f"/api/v1/optimization-jobs/{job.id}/")
    assert detail.status_code == 200
    assert detail.json()["status"] == "succeeded"


@override_settings(OPTIMIZATION_SUBMISSIONS_ENABLED=True)
def test_optimization_submissions_enabled_still_accepts_post(
    django_capture_on_commit_callbacks,
):
    client = APIClient()
    with patch("calculations.services._publish_to_broker") as publish:
        with django_capture_on_commit_callbacks(execute=True):
            response = client.post(
                "/api/v1/optimization-jobs/",
                {
                    "profile": "P3",
                    "horizon_years": 1,
                    "expense_income_ratio": 0.95,
                    "buffer_months": 3,
                    "rebalance_frequency": "monthly",
                    "conversion_cost": 0.0,
                },
                format="json",
            )
    assert response.status_code == 202
    assert "job_id" in response.json()
    assert response.json().get("cached") is False
    publish.assert_called_once()
    assert response.json().get("error", {}).get("code") != "submissions_disabled"


@override_settings(ADMIN_ENABLED=False)
def test_admin_disabled_returns_404():
    client = APIClient()
    response = client.get("/admin/")
    assert response.status_code == 404


@override_settings(ADMIN_ENABLED=True)
def test_admin_enabled_is_reachable_in_development():
    client = APIClient()
    response = client.get("/admin/login/")
    assert response.status_code in {200, 302}

@override_settings(JOB_RETENTION_DAYS=7)
def test_cleanup_expired_jobs_respects_status_and_boundary():
    now = timezone.now()
    old = now - timedelta(days=8)
    edge = now - timedelta(days=7) + timedelta(seconds=1)
    fresh_running = now - timedelta(days=30)

    OptimizationJob.objects.create(
        status=OptimizationJob.Status.SUCCEEDED,
        request_fingerprint="old-opt",
        request_payload={"profile": "P2"},
        result_payload={"x": 1},
        model_version="1.0.0",
        data_as_of="2025-12-31",
        completed_at=old,
        updated_at=old,
    )
    OptimizationJob.objects.create(
        status=OptimizationJob.Status.SUCCEEDED,
        request_fingerprint="edge-opt",
        request_payload={"profile": "P2"},
        result_payload={"x": 1},
        model_version="1.0.0",
        data_as_of="2025-12-31",
        completed_at=edge,
        updated_at=edge,
    )
    OptimizationJob.objects.create(
        status=OptimizationJob.Status.RUNNING,
        request_fingerprint="running-opt",
        request_payload={"profile": "P2"},
        model_version="1.0.0",
        data_as_of="2025-12-31",
        updated_at=fresh_running,
    )
    BufferSensitivityJob.objects.create(
        status=BufferSensitivityJob.Status.FAILED,
        request_fingerprint="old-buf",
        request_payload={"profile": "P2"},
        model_version="1.0.0",
        data_as_of="2025-12-31",
        completed_at=old,
        updated_at=old,
    )
    BufferSensitivityJob.objects.create(
        status=BufferSensitivityJob.Status.QUEUED,
        request_fingerprint="queued-buf",
        request_payload={"profile": "P2"},
        model_version="1.0.0",
        data_as_of="2025-12-31",
        updated_at=old,
    )

    dry = cleanup_expired_jobs(cutoff=retention_cutoff(now=now), dry_run=True)
    assert dry.optimization_count == 1
    assert dry.buffer_sensitivity_count == 1
    assert OptimizationJob.objects.count() == 3
    assert BufferSensitivityJob.objects.count() == 2

    deleted = cleanup_expired_jobs(cutoff=retention_cutoff(now=now), dry_run=False)
    assert deleted.total == 2
    assert OptimizationJob.objects.filter(request_fingerprint="old-opt").count() == 0
    assert OptimizationJob.objects.filter(request_fingerprint="edge-opt").count() == 1
    assert OptimizationJob.objects.filter(request_fingerprint="running-opt").count() == 1
    assert BufferSensitivityJob.objects.filter(request_fingerprint="queued-buf").count() == 1


@override_settings(JOB_RETENTION_DAYS=7)
def test_cleanup_management_command_dry_run(capsys):
    now = timezone.now()
    OptimizationJob.objects.create(
        status=OptimizationJob.Status.FAILED,
        request_fingerprint="cmd-old",
        request_payload={"profile": "P2", "secret_ratio": 0.95},
        model_version="1.0.0",
        data_as_of="2025-12-31",
        completed_at=now - timedelta(days=10),
    )
    call_command("cleanup_expired_jobs", "--dry-run")
    out = capsys.readouterr().out
    assert "dry-run" in out
    assert "optimization=1" in out
    assert "secret_ratio" not in out
    assert OptimizationJob.objects.filter(request_fingerprint="cmd-old").exists()


def test_default_cache_in_test_settings_is_locmem():
    """Development/test settings use LocMem; production builders use Redis."""
    from django.conf import settings

    assert is_locmem_cache(settings.CACHES) or settings.DEBUG
