"""Application services for optimization job lifecycle.

Views call these helpers. The optimizer is invoked only from Celery tasks.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from .manifest import (
    compute_request_fingerprint,
    data_as_of,
    model_version,
    normalize_request_payload,
)
from .models import OptimizationJob

logger = logging.getLogger(__name__)

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
LEASE_SECONDS = int(getattr(settings, "OPTIMIZATION_LEASE_SECONDS", 240))


class QueueUnavailableError(Exception):
    """Celery/Redis publication failed after the job row was persisted."""

    def __init__(self, job: OptimizationJob):
        self.job = job
        super().__init__("queue_unavailable")


@dataclass
class JobCreateResult:
    job: OptimizationJob
    created: bool
    cached: bool
    http_status: int
    should_dispatch: bool = False


def submit_optimization_job(validated_data: dict[str, Any]) -> JobCreateResult:
    """Create/reuse a job and publish to Celery only after DB commit.

    Broker failures mark the existing row failed and raise
    ``QueueUnavailableError`` so the view can return HTTP 503.
    """
    publish_errors: list[BaseException] = []
    job_id_holder: dict[str, str] = {}

    with transaction.atomic():
        outcome = create_or_reuse_job(validated_data)
        if outcome.should_dispatch:
            job_id_holder["id"] = str(outcome.job.id)

            def _publish() -> None:
                try:
                    _publish_to_broker(job_id_holder["id"])
                except Exception as exc:  # noqa: BLE001 - convert to safe API failure
                    publish_errors.append(exc)

            transaction.on_commit(_publish)

    if publish_errors:
        job = mark_queue_unavailable(job_id_holder["id"], publish_errors[0])
        raise QueueUnavailableError(job)

    return outcome


def create_or_reuse_job(validated_data: dict[str, Any]) -> JobCreateResult:
    """Create a queued job or reuse the unique row for this fingerprint."""
    normalized = normalize_request_payload(validated_data)
    fingerprint = compute_request_fingerprint(normalized)
    now = timezone.now()

    with transaction.atomic():
        existing = (
            OptimizationJob.objects.select_for_update()
            .filter(request_fingerprint=fingerprint)
            .first()
        )
        if existing is None:
            try:
                with transaction.atomic():
                    job = OptimizationJob.objects.create(
                        status=OptimizationJob.Status.QUEUED,
                        request_fingerprint=fingerprint,
                        request_payload=normalized,
                        model_version=model_version(),
                        data_as_of=data_as_of(),
                        attempt_count=0,
                    )
                return JobCreateResult(
                    job=job,
                    created=True,
                    cached=False,
                    http_status=202,
                    should_dispatch=True,
                )
            except IntegrityError:
                existing = (
                    OptimizationJob.objects.select_for_update()
                    .get(request_fingerprint=fingerprint)
                )

        return _reuse_existing_job(existing, normalized=normalized, now=now)


def _reuse_existing_job(
    job: OptimizationJob,
    *,
    normalized: dict[str, Any],
    now,
) -> JobCreateResult:
    if (
        job.status == OptimizationJob.Status.SUCCEEDED
        and job.result_payload is not None
    ):
        return JobCreateResult(
            job=job,
            created=False,
            cached=True,
            http_status=200,
            should_dispatch=False,
        )

    if job.status == OptimizationJob.Status.QUEUED:
        return JobCreateResult(
            job=job,
            created=False,
            cached=False,
            http_status=202,
            should_dispatch=False,
        )

    if job.status == OptimizationJob.Status.RUNNING:
        if job.lease_is_valid(now):
            return JobCreateResult(
                job=job,
                created=False,
                cached=False,
                http_status=202,
                should_dispatch=False,
            )
        # Expired running lease: reclaim into queued and redispatch.
        if job.attempt_count >= MAX_ATTEMPTS:
            _mark_max_attempts_locked(job)
            return JobCreateResult(
                job=job,
                created=False,
                cached=False,
                http_status=200,
                should_dispatch=False,
            )
        _reset_job_for_retry(job, normalized=normalized)
        return JobCreateResult(
            job=job,
            created=False,
            cached=False,
            http_status=202,
            should_dispatch=True,
        )

    # FAILED
    if job.attempt_count >= MAX_ATTEMPTS:
        return JobCreateResult(
            job=job,
            created=False,
            cached=False,
            http_status=200,
            should_dispatch=False,
        )
    _reset_job_for_retry(job, normalized=normalized)
    return JobCreateResult(
        job=job,
        created=False,
        cached=False,
        http_status=202,
        should_dispatch=True,
    )


def _reset_job_for_retry(job: OptimizationJob, *, normalized: dict[str, Any]) -> None:
    job.status = OptimizationJob.Status.QUEUED
    job.request_payload = normalized
    job.result_payload = None
    job.error_code = None
    job.error_message = None
    job.celery_task_id = None
    job.started_at = None
    job.completed_at = None
    job.lease_expires_at = None
    job.model_version = model_version()
    job.data_as_of = data_as_of()
    job.save(
        update_fields=[
            "status",
            "request_payload",
            "result_payload",
            "error_code",
            "error_message",
            "celery_task_id",
            "started_at",
            "completed_at",
            "lease_expires_at",
            "model_version",
            "data_as_of",
            "updated_at",
        ]
    )


def _publish_to_broker(job_id: str) -> None:
    from .tasks import run_optimization_job

    run_optimization_job.delay(str(job_id))


def mark_queue_unavailable(job_id: str, exc: BaseException) -> OptimizationJob:
    logger.exception(
        "Broker publication failed for optimization job %s",
        job_id,
        exc_info=exc,
    )
    now = timezone.now()
    OptimizationJob.objects.filter(id=job_id).update(
        status=OptimizationJob.Status.FAILED,
        result_payload=None,
        error_code="queue_unavailable",
        error_message=QUEUE_UNAVAILABLE_MESSAGE,
        completed_at=now,
        celery_task_id=None,
        lease_expires_at=None,
    )
    return OptimizationJob.objects.get(id=job_id)


def claim_job_for_execution(
    job_id: str,
    celery_task_id: str,
    *,
    redelivered: bool = False,
) -> OptimizationJob | None:
    """Atomically claim a job for this Celery task identity."""
    now = timezone.now()
    lease_until = now + timedelta(seconds=LEASE_SECONDS)

    with transaction.atomic():
        try:
            job = OptimizationJob.objects.select_for_update().get(id=job_id)
        except OptimizationJob.DoesNotExist:
            return None

        if job.status in (
            OptimizationJob.Status.SUCCEEDED,
            OptimizationJob.Status.FAILED,
        ):
            return None

        if job.status == OptimizationJob.Status.QUEUED:
            if job.attempt_count >= MAX_ATTEMPTS:
                _mark_max_attempts_locked(job)
                return None
            job.status = OptimizationJob.Status.RUNNING
            job.celery_task_id = celery_task_id
            job.attempt_count = job.attempt_count + 1
            job.started_at = now
            job.lease_expires_at = lease_until
            job.completed_at = None
            job.error_code = None
            job.error_message = None
            job.save(
                update_fields=[
                    "status",
                    "celery_task_id",
                    "attempt_count",
                    "started_at",
                    "lease_expires_at",
                    "completed_at",
                    "error_code",
                    "error_message",
                    "updated_at",
                ]
            )
            return job

        # RUNNING
        if job.celery_task_id == celery_task_id:
            if not redelivered:
                logger.info(
                    "Skipping job %s; duplicate non-redelivered delivery for task %s",
                    job_id,
                    celery_task_id,
                )
                return None
            # Broker redelivery after worker loss: count against MAX_ATTEMPTS.
            if job.attempt_count >= MAX_ATTEMPTS:
                _mark_max_attempts_locked(job)
                return None
            job.attempt_count = job.attempt_count + 1
            job.lease_expires_at = lease_until
            if job.started_at is None:
                job.started_at = now
            job.save(
                update_fields=[
                    "attempt_count",
                    "lease_expires_at",
                    "started_at",
                    "updated_at",
                ]
            )
            return job

        if job.lease_is_valid(now):
            logger.info(
                "Skipping job %s; valid lease held by task %s",
                job_id,
                job.celery_task_id,
            )
            return None

        # Expired running lease: controlled recovery by a new worker task.
        if job.attempt_count >= MAX_ATTEMPTS:
            _mark_max_attempts_locked(job)
            return None
        job.status = OptimizationJob.Status.RUNNING
        job.celery_task_id = celery_task_id
        job.attempt_count = job.attempt_count + 1
        job.started_at = now
        job.lease_expires_at = lease_until
        job.save(
            update_fields=[
                "status",
                "celery_task_id",
                "attempt_count",
                "started_at",
                "lease_expires_at",
                "updated_at",
            ]
        )
        return job


def _mark_max_attempts_locked(job: OptimizationJob) -> None:
    job.status = OptimizationJob.Status.FAILED
    job.result_payload = None
    job.error_code = "max_attempts_exceeded"
    job.error_message = MAX_ATTEMPTS_MESSAGE
    job.completed_at = timezone.now()
    job.lease_expires_at = None
    job.save(
        update_fields=[
            "status",
            "result_payload",
            "error_code",
            "error_message",
            "completed_at",
            "lease_expires_at",
            "updated_at",
        ]
    )


def store_success(
    job_id: str,
    celery_task_id: str,
    result: dict[str, Any],
) -> bool:
    """Persist success only if this Celery task still owns the running job."""
    _assert_json_safe_result(result)
    with transaction.atomic():
        try:
            job = OptimizationJob.objects.select_for_update().get(id=job_id)
        except OptimizationJob.DoesNotExist:
            logger.warning(
                "Discarding success for missing job %s (task %s)",
                job_id,
                celery_task_id,
            )
            return False
        if (
            job.status != OptimizationJob.Status.RUNNING
            or job.celery_task_id != celery_task_id
        ):
            logger.warning(
                "Discarding stale success for job %s (task %s); "
                "status=%s owner=%s",
                job_id,
                celery_task_id,
                job.status,
                job.celery_task_id,
            )
            return False
        job.status = OptimizationJob.Status.SUCCEEDED
        job.result_payload = result
        job.error_code = None
        job.error_message = None
        job.completed_at = timezone.now()
        job.lease_expires_at = None
        job.save(
            update_fields=[
                "status",
                "result_payload",
                "error_code",
                "error_message",
                "completed_at",
                "lease_expires_at",
                "updated_at",
            ]
        )
        return True


def store_failure(
    job_id: str,
    celery_task_id: str,
    *,
    error_code: str,
    exc: BaseException,
) -> bool:
    """Persist failure only if this Celery task still owns the running job."""
    logger.exception(
        "Optimization job %s failed with %s (task %s)",
        job_id,
        error_code,
        celery_task_id,
        exc_info=exc,
    )
    with transaction.atomic():
        try:
            job = OptimizationJob.objects.select_for_update().get(id=job_id)
        except OptimizationJob.DoesNotExist:
            logger.warning(
                "Discarding failure for missing job %s (task %s)",
                job_id,
                celery_task_id,
            )
            return False
        if (
            job.status != OptimizationJob.Status.RUNNING
            or job.celery_task_id != celery_task_id
        ):
            logger.warning(
                "Discarding stale failure for job %s (task %s); "
                "status=%s owner=%s",
                job_id,
                celery_task_id,
                job.status,
                job.celery_task_id,
            )
            return False
        job.status = OptimizationJob.Status.FAILED
        job.result_payload = None
        job.error_code = error_code[:64]
        job.error_message = SAFE_FAILURE_MESSAGE
        job.completed_at = timezone.now()
        job.lease_expires_at = None
        job.save(
            update_fields=[
                "status",
                "result_payload",
                "error_code",
                "error_message",
                "completed_at",
                "lease_expires_at",
                "updated_at",
            ]
        )
        return True


def _assert_json_safe_result(result: dict[str, Any]) -> None:
    import json

    import numpy as np

    for key, value in result.items():
        if isinstance(value, (np.ndarray, np.generic)):
            raise TypeError(f"Result field '{key}' is not JSON-safe")
    json.dumps(result)


# Backward-compatible alias used by older tests/docs.
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
