"""Application services for buffer-sensitivity batch job lifecycle."""

from __future__ import annotations

from typing import Any

from django.conf import settings

from . import lifecycle
from .batch_contract import (
    BUFFER_SENSITIVITY_CONTRACT_VERSION,
    compute_batch_fingerprint,
    normalize_batch_request_payload,
    validate_batch_result_payload,
)
from .lifecycle import JobCreateResult, QueueUnavailableError
from .models import BufferSensitivityJob

SAFE_FAILURE_MESSAGE = (
    "The buffer sensitivity job failed. Please retry later or contact support "
    "with the job identifier."
)
QUEUE_UNAVAILABLE_MESSAGE = (
    "The buffer sensitivity queue is temporarily unavailable. Please retry shortly."
)
MAX_ATTEMPTS_MESSAGE = (
    "The buffer sensitivity job exceeded the maximum number of execution attempts."
)
SUBMISSIONS_DISABLED_MESSAGE = (
    "Buffer sensitivity submissions are temporarily disabled. "
    "Existing job results remain available."
)


def _publish_to_broker(job_id: str) -> None:
    from .tasks import run_buffer_sensitivity_job

    run_buffer_sensitivity_job.apply_async(
        args=(str(job_id),),
        queue="buffer_sensitivity",
    )


def _batch_config() -> lifecycle.JobLifecycleConfig[BufferSensitivityJob]:
    return lifecycle.JobLifecycleConfig(
        model=BufferSensitivityJob,
        lease_seconds=int(getattr(settings, "BUFFER_SENSITIVITY_LEASE_SECONDS", 840)),
        max_attempts=int(getattr(settings, "OPTIMIZATION_MAX_ATTEMPTS", 2)),
        publish=_publish_to_broker,
        safe_failure_message=SAFE_FAILURE_MESSAGE,
        queue_unavailable_message=QUEUE_UNAVAILABLE_MESSAGE,
        max_attempts_message=MAX_ATTEMPTS_MESSAGE,
        log_label="buffer_sensitivity",
        result_validator=validate_batch_result_payload,
        extra_create_fields=lambda: {
            "contract_version": BUFFER_SENSITIVITY_CONTRACT_VERSION
        },
    )


def submissions_enabled() -> bool:
    return bool(getattr(settings, "BUFFER_SENSITIVITY_SUBMISSIONS_ENABLED", True))


def submit_buffer_sensitivity_job(validated_data: dict[str, Any]) -> JobCreateResult:
    return lifecycle.submit_job(
        _batch_config(),
        validated_data,
        normalize=normalize_batch_request_payload,
        fingerprint=compute_batch_fingerprint,
    )


def create_or_reuse_buffer_sensitivity_job(
    validated_data: dict[str, Any],
) -> JobCreateResult:
    return lifecycle.create_or_reuse_job(
        _batch_config(),
        validated_data,
        normalize=normalize_batch_request_payload,
        fingerprint=compute_batch_fingerprint,
    )


def claim_buffer_sensitivity_job(
    job_id: str,
    celery_task_id: str,
    *,
    redelivered: bool = False,
) -> BufferSensitivityJob | None:
    return lifecycle.claim_job_for_execution(
        _batch_config(),
        job_id,
        celery_task_id,
        redelivered=redelivered,
    )


def store_buffer_sensitivity_success(
    job_id: str,
    celery_task_id: str,
    result: dict[str, Any],
) -> bool:
    return lifecycle.store_success(
        _batch_config(),
        job_id,
        celery_task_id,
        result,
    )


def store_buffer_sensitivity_failure(
    job_id: str,
    celery_task_id: str,
    *,
    error_code: str,
    exc: BaseException,
) -> bool:
    return lifecycle.store_failure(
        _batch_config(),
        job_id,
        celery_task_id,
        error_code=error_code,
        exc=exc,
    )


def mark_buffer_sensitivity_queue_unavailable(
    job_id: str,
    exc: BaseException,
) -> BufferSensitivityJob:
    return lifecycle.mark_queue_unavailable(_batch_config(), job_id, exc)


# Re-export for views.
__all__ = [
    "QUEUE_UNAVAILABLE_MESSAGE",
    "SAFE_FAILURE_MESSAGE",
    "SUBMISSIONS_DISABLED_MESSAGE",
    "QueueUnavailableError",
    "claim_buffer_sensitivity_job",
    "create_or_reuse_buffer_sensitivity_job",
    "mark_buffer_sensitivity_queue_unavailable",
    "store_buffer_sensitivity_failure",
    "store_buffer_sensitivity_success",
    "submit_buffer_sensitivity_job",
    "submissions_enabled",
]
