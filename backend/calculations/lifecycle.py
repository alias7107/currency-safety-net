"""Shared durable job lifecycle for optimization and buffer-sensitivity jobs.

Keep job-type configuration explicit. Avoid duplicating claim/store/race rules.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Callable, Generic, TypeVar

from django.db import IntegrityError, transaction
from django.utils import timezone

from .manifest import data_as_of, model_version

logger = logging.getLogger(__name__)

JobModel = TypeVar("JobModel")


@dataclass(frozen=True)
class JobLifecycleConfig(Generic[JobModel]):
    """Explicit per-job-type lifecycle configuration."""

    model: type
    lease_seconds: int
    max_attempts: int
    publish: Callable[[str], None]
    safe_failure_message: str
    queue_unavailable_message: str
    max_attempts_message: str
    log_label: str
    result_validator: Callable[[dict[str, Any]], None] | None = None
    extra_create_fields: Callable[[], dict[str, Any]] | None = None


@dataclass
class JobCreateResult(Generic[JobModel]):
    job: JobModel
    created: bool
    cached: bool
    http_status: int
    should_dispatch: bool = False


class QueueUnavailableError(Exception):
    """Celery/Redis publication failed after the job row was persisted."""

    def __init__(self, job: Any):
        self.job = job
        super().__init__("queue_unavailable")


def assert_json_safe_result(result: dict[str, Any]) -> None:
    import numpy as np

    def _walk(value: Any, path: str) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                _walk(child, f"{path}.{key}" if path else str(key))
            return
        if isinstance(value, (list, tuple)):
            for idx, child in enumerate(value):
                _walk(child, f"{path}[{idx}]")
            return
        if isinstance(value, (np.ndarray, np.generic)):
            raise TypeError(f"Result field '{path}' is not JSON-safe")
        if isinstance(value, float) and (
            value != value or value in (float("inf"), float("-inf"))
        ):
            raise ValueError(f"Result field '{path}' is not finite")

    _walk(result, "")
    json.dumps(result)


def submit_job(
    config: JobLifecycleConfig[JobModel],
    validated_data: dict[str, Any],
    *,
    normalize: Callable[[dict[str, Any]], dict[str, Any]],
    fingerprint: Callable[[dict[str, Any]], str],
) -> JobCreateResult[JobModel]:
    """Create/reuse a job and publish to Celery only after DB commit."""
    publish_errors: list[BaseException] = []
    job_id_holder: dict[str, str] = {}

    with transaction.atomic():
        outcome = create_or_reuse_job(
            config,
            validated_data,
            normalize=normalize,
            fingerprint=fingerprint,
        )
        if outcome.should_dispatch:
            job_id_holder["id"] = str(outcome.job.id)

            def _publish() -> None:
                try:
                    config.publish(job_id_holder["id"])
                except Exception as exc:  # noqa: BLE001 - convert to safe API failure
                    publish_errors.append(exc)

            transaction.on_commit(_publish)

    if publish_errors:
        job = mark_queue_unavailable(config, job_id_holder["id"], publish_errors[0])
        raise QueueUnavailableError(job)

    return outcome


def create_or_reuse_job(
    config: JobLifecycleConfig[JobModel],
    validated_data: dict[str, Any],
    *,
    normalize: Callable[[dict[str, Any]], dict[str, Any]],
    fingerprint: Callable[[dict[str, Any]], str],
) -> JobCreateResult[JobModel]:
    """Create a queued job or reuse the unique row for this fingerprint."""
    normalized = normalize(validated_data)
    fp = fingerprint(normalized)
    now = timezone.now()
    model = config.model

    with transaction.atomic():
        existing = (
            model.objects.select_for_update().filter(request_fingerprint=fp).first()
        )
        if existing is None:
            try:
                with transaction.atomic():
                    create_kwargs: dict[str, Any] = {
                        "status": model.Status.QUEUED,
                        "request_fingerprint": fp,
                        "request_payload": normalized,
                        "model_version": model_version(),
                        "data_as_of": data_as_of(),
                        "attempt_count": 0,
                    }
                    if config.extra_create_fields is not None:
                        create_kwargs.update(config.extra_create_fields())
                    job = model.objects.create(**create_kwargs)
                return JobCreateResult(
                    job=job,
                    created=True,
                    cached=False,
                    http_status=202,
                    should_dispatch=True,
                )
            except IntegrityError:
                existing = model.objects.select_for_update().get(request_fingerprint=fp)

        return _reuse_existing_job(
            config, existing, normalized=normalized, now=now
        )


def _reuse_existing_job(
    config: JobLifecycleConfig[JobModel],
    job: JobModel,
    *,
    normalized: dict[str, Any],
    now,
) -> JobCreateResult[JobModel]:
    model = config.model
    if job.status == model.Status.SUCCEEDED and job.result_payload is not None:
        return JobCreateResult(
            job=job,
            created=False,
            cached=True,
            http_status=200,
            should_dispatch=False,
        )

    if job.status == model.Status.QUEUED:
        return JobCreateResult(
            job=job,
            created=False,
            cached=False,
            http_status=202,
            should_dispatch=False,
        )

    if job.status == model.Status.RUNNING:
        if job.lease_is_valid(now):
            return JobCreateResult(
                job=job,
                created=False,
                cached=False,
                http_status=202,
                should_dispatch=False,
            )
        if job.attempt_count >= config.max_attempts:
            _mark_max_attempts_locked(config, job)
            return JobCreateResult(
                job=job,
                created=False,
                cached=False,
                http_status=200,
                should_dispatch=False,
            )
        _reset_job_for_retry(config, job, normalized=normalized)
        return JobCreateResult(
            job=job,
            created=False,
            cached=False,
            http_status=202,
            should_dispatch=True,
        )

    # FAILED
    if job.attempt_count >= config.max_attempts:
        return JobCreateResult(
            job=job,
            created=False,
            cached=False,
            http_status=200,
            should_dispatch=False,
        )
    _reset_job_for_retry(config, job, normalized=normalized)
    return JobCreateResult(
        job=job,
        created=False,
        cached=False,
        http_status=202,
        should_dispatch=True,
    )


def _reset_job_for_retry(
    config: JobLifecycleConfig[JobModel],
    job: JobModel,
    *,
    normalized: dict[str, Any],
) -> None:
    update_fields = [
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
    job.status = config.model.Status.QUEUED
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
    if config.extra_create_fields is not None:
        extras = config.extra_create_fields()
        for key, value in extras.items():
            setattr(job, key, value)
            if key not in update_fields:
                update_fields.append(key)
    job.save(update_fields=update_fields)


def mark_queue_unavailable(
    config: JobLifecycleConfig[JobModel],
    job_id: str,
    exc: BaseException,
) -> JobModel:
    logger.exception(
        "Broker publication failed for %s job %s",
        config.log_label,
        job_id,
        exc_info=exc,
    )
    now = timezone.now()
    config.model.objects.filter(id=job_id).update(
        status=config.model.Status.FAILED,
        result_payload=None,
        error_code="queue_unavailable",
        error_message=config.queue_unavailable_message,
        completed_at=now,
        celery_task_id=None,
        lease_expires_at=None,
    )
    return config.model.objects.get(id=job_id)


def claim_job_for_execution(
    config: JobLifecycleConfig[JobModel],
    job_id: str,
    celery_task_id: str,
    *,
    redelivered: bool = False,
) -> JobModel | None:
    """Atomically claim a job for this Celery task identity."""
    now = timezone.now()
    lease_until = now + timedelta(seconds=config.lease_seconds)
    model = config.model

    with transaction.atomic():
        try:
            job = model.objects.select_for_update().get(id=job_id)
        except model.DoesNotExist:
            return None

        if job.status in (model.Status.SUCCEEDED, model.Status.FAILED):
            return None

        if job.status == model.Status.QUEUED:
            if job.attempt_count >= config.max_attempts:
                _mark_max_attempts_locked(config, job)
                return None
            job.status = model.Status.RUNNING
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
                    "Skipping %s job %s; duplicate non-redelivered delivery for task %s",
                    config.log_label,
                    job_id,
                    celery_task_id,
                )
                return None
            if job.attempt_count >= config.max_attempts:
                _mark_max_attempts_locked(config, job)
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
                "Skipping %s job %s; valid lease held by task %s",
                config.log_label,
                job_id,
                job.celery_task_id,
            )
            return None

        if job.attempt_count >= config.max_attempts:
            _mark_max_attempts_locked(config, job)
            return None
        job.status = model.Status.RUNNING
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


def _mark_max_attempts_locked(
    config: JobLifecycleConfig[JobModel],
    job: JobModel,
) -> None:
    job.status = config.model.Status.FAILED
    job.result_payload = None
    job.error_code = "max_attempts_exceeded"
    job.error_message = config.max_attempts_message
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
    config: JobLifecycleConfig[JobModel],
    job_id: str,
    celery_task_id: str,
    result: dict[str, Any],
) -> bool:
    """Persist success only if this Celery task still owns the running job."""
    validator = config.result_validator or assert_json_safe_result
    validator(result)
    model = config.model
    with transaction.atomic():
        try:
            job = model.objects.select_for_update().get(id=job_id)
        except model.DoesNotExist:
            logger.warning(
                "Discarding success for missing %s job %s (task %s)",
                config.log_label,
                job_id,
                celery_task_id,
            )
            return False
        if job.status != model.Status.RUNNING or job.celery_task_id != celery_task_id:
            logger.warning(
                "Discarding stale success for %s job %s (task %s); "
                "status=%s owner=%s",
                config.log_label,
                job_id,
                celery_task_id,
                job.status,
                job.celery_task_id,
            )
            return False
        job.status = model.Status.SUCCEEDED
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
    config: JobLifecycleConfig[JobModel],
    job_id: str,
    celery_task_id: str,
    *,
    error_code: str,
    exc: BaseException,
) -> bool:
    """Persist failure only if this Celery task still owns the running job."""
    logger.exception(
        "%s job %s failed with %s (task %s)",
        config.log_label,
        job_id,
        error_code,
        celery_task_id,
        exc_info=exc,
    )
    model = config.model
    with transaction.atomic():
        try:
            job = model.objects.select_for_update().get(id=job_id)
        except model.DoesNotExist:
            logger.warning(
                "Discarding failure for missing %s job %s (task %s)",
                config.log_label,
                job_id,
                celery_task_id,
            )
            return False
        if job.status != model.Status.RUNNING or job.celery_task_id != celery_task_id:
            logger.warning(
                "Discarding stale failure for %s job %s (task %s); "
                "status=%s owner=%s",
                config.log_label,
                job_id,
                celery_task_id,
                job.status,
                job.celery_task_id,
            )
            return False
        job.status = model.Status.FAILED
        job.result_payload = None
        job.error_code = error_code[:64]
        job.error_message = config.safe_failure_message
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
