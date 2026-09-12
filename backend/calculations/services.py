"""Application services for optimization job lifecycle.

Views call these helpers. The optimizer is invoked only from Celery tasks.
Public function names used by existing tests are preserved as thin wrappers
around the shared lifecycle layer.
"""

from __future__ import annotations

from typing import Any

from django.conf import settings

from . import lifecycle
from .lifecycle import JobCreateResult, QueueUnavailableError, assert_json_safe_result
from .manifest import (
    compute_request_fingerprint,
    normalize_request_payload,
)
from .models import OptimizationJob

SAFE_FAILURE_MESSAGE = (
    "The optimization job failed. Please retry later or contact support "
    "with the job identifier."
)
QUEUE_UNAVAILABLE_MESSAGE = (
    "The optimization queue is temporarily unavailable. Please retry shortly."
)
MAX_ATTEMPTS_MESSAGE = (
    "The optimization job exceeded the maximum number of execution attempts."
)

MAX_ATTEMPTS = int(getattr(settings, "OPTIMIZATION_MAX_ATTEMPTS", 2))
LEASE_SECONDS = int(getattr(settings, "OPTIMIZATION_LEASE_SECONDS", 300))


def _publish_to_broker(job_id: str) -> None:
    from .tasks import run_optimization_job

    run_optimization_job.delay(str(job_id))


def _optimization_config() -> lifecycle.JobLifecycleConfig[OptimizationJob]:
    return lifecycle.JobLifecycleConfig(
        model=OptimizationJob,
        lease_seconds=int(getattr(settings, "OPTIMIZATION_LEASE_SECONDS", LEASE_SECONDS)),
        max_attempts=int(getattr(settings, "OPTIMIZATION_MAX_ATTEMPTS", MAX_ATTEMPTS)),
        publish=_publish_to_broker,
        safe_failure_message=SAFE_FAILURE_MESSAGE,
        queue_unavailable_message=QUEUE_UNAVAILABLE_MESSAGE,
        max_attempts_message=MAX_ATTEMPTS_MESSAGE,
        log_label="optimization",
        result_validator=assert_json_safe_result,
    )


def submit_optimization_job(validated_data: dict[str, Any]) -> JobCreateResult:
    """Create/reuse a job and publish to Celery only after DB commit."""
    return lifecycle.submit_job(
        _optimization_config(),
        validated_data,
        normalize=normalize_request_payload,
        fingerprint=compute_request_fingerprint,
    )


def create_or_reuse_job(validated_data: dict[str, Any]) -> JobCreateResult:
    """Create a queued job or reuse the unique row for this fingerprint."""
    return lifecycle.create_or_reuse_job(
        _optimization_config(),
        validated_data,
        normalize=normalize_request_payload,
        fingerprint=compute_request_fingerprint,
    )


def mark_queue_unavailable(job_id: str, exc: BaseException) -> OptimizationJob:
    return lifecycle.mark_queue_unavailable(_optimization_config(), job_id, exc)


def claim_job_for_execution(
    job_id: str,
    celery_task_id: str,
    *,
    redelivered: bool = False,
) -> OptimizationJob | None:
    return lifecycle.claim_job_for_execution(
        _optimization_config(),
        job_id,
        celery_task_id,
        redelivered=redelivered,
    )


def store_success(
    job_id: str,
    celery_task_id: str,
    result: dict[str, Any],
) -> bool:
    return lifecycle.store_success(
        _optimization_config(),
        job_id,
        celery_task_id,
        result,
    )


def store_failure(
    job_id: str,
    celery_task_id: str,
    *,
    error_code: str,
    exc: BaseException,
) -> bool:
    return lifecycle.store_failure(
        _optimization_config(),
        job_id,
        celery_task_id,
        error_code=error_code,
        exc=exc,
    )


def _assert_json_safe_result(result: dict[str, Any]) -> None:
    assert_json_safe_result(result)


def dispatch_optimization_job(job_id) -> None:
    _publish_to_broker(str(job_id))


def mark_job_running(
    job_id: str,
    celery_task_id: str = "legacy",
    *,
    redelivered: bool = False,
) -> OptimizationJob | None:
    return claim_job_for_execution(
        job_id,
        celery_task_id,
        redelivered=redelivered,
    )
