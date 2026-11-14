

from __future__ import annotations

from typing import Any, Callable

from django.conf import settings

from . import lifecycle
from .household_contract import (
    compute_household_fingerprint,
    snapshot_from_provenance,
)
from .lifecycle import JobCreateResult, QueueUnavailableError
from .models import HouseholdAnalysisJob

SAFE_FAILURE_MESSAGE = (
    "The household analysis failed. Please retry later or contact support "
    "with the job identifier."
)
QUEUE_UNAVAILABLE_MESSAGE = (
    "The household analysis queue is temporarily unavailable. Please retry shortly."
)
MAX_ATTEMPTS_MESSAGE = (
    "The household analysis exceeded the maximum number of execution attempts."
)
SUBMISSIONS_DISABLED_MESSAGE = (
    "Household analysis submissions are not enabled. Existing job results remain available."
)
PROVENANCE_UNAVAILABLE_MESSAGE = (
    "Model provenance could not be verified. Household analysis is temporarily unavailable."
)


def submissions_enabled() -> bool:
    """Disabled by default everywhere; enabled only by explicit configuration."""
    return getattr(settings, "HOUSEHOLD_ANALYSIS_SUBMISSIONS_ENABLED", False) is True


def _publish_to_broker(job_id: str) -> None:
    from .tasks import run_household_analysis_job

    # Default ``celery`` queue: consumed by worker_pilot (pilot) and worker_opt (full).
    run_household_analysis_job.apply_async(args=(str(job_id),))


def household_config(
    *,
    provenance: dict[str, Any] | None = None,
    result_validator: Callable[[dict[str, Any]], None] | None = None,
) -> lifecycle.JobLifecycleConfig[HouseholdAnalysisJob]:
    """Lifecycle configuration. ``provenance`` is the submission-time snapshot source."""
    extra = None
    if provenance is not None:
        snapshot = snapshot_from_provenance(provenance)
        # Overrides the lifecycle's default model_version/data_as_of fields so the
        # row always carries the exact snapshot used for its fingerprint.
        extra = lambda: dict(snapshot)  # noqa: E731
    return lifecycle.JobLifecycleConfig(
        model=HouseholdAnalysisJob,
        lease_seconds=int(getattr(settings, "HOUSEHOLD_ANALYSIS_LEASE_SECONDS", 300)),
        max_attempts=int(getattr(settings, "OPTIMIZATION_MAX_ATTEMPTS", 2)),
        publish=_publish_to_broker,
        safe_failure_message=SAFE_FAILURE_MESSAGE,
        queue_unavailable_message=QUEUE_UNAVAILABLE_MESSAGE,
        max_attempts_message=MAX_ATTEMPTS_MESSAGE,
        log_label="household_analysis",
        result_validator=result_validator,
        extra_create_fields=extra,
    )


def submit_household_analysis(
    normalized: dict[str, Any],
    provenance: dict[str, Any],
) -> JobCreateResult[HouseholdAnalysisJob]:
    """Create or reuse a job; publish only after commit (shared lifecycle)."""
    return lifecycle.submit_job(
        household_config(provenance=provenance),
        normalized,
        normalize=lambda value: value,
        fingerprint=lambda value: compute_household_fingerprint(value, provenance),
    )


def claim_household_analysis_job(
    job_id: str,
    celery_task_id: str,
    *,
    redelivered: bool = False,
) -> HouseholdAnalysisJob | None:
    return lifecycle.claim_job_for_execution(
        household_config(), job_id, celery_task_id, redelivered=redelivered
    )


def store_household_analysis_success(
    job_id: str,
    celery_task_id: str,
    result: dict[str, Any],
    *,
    validator: Callable[[dict[str, Any]], None],
) -> bool:
    return lifecycle.store_success(
        household_config(result_validator=validator), job_id, celery_task_id, result
    )


def store_household_analysis_failure(
    job_id: str,
    celery_task_id: str,
    *,
    error_code: str,
    exc: BaseException,
) -> bool:
    return lifecycle.store_failure(
        household_config(), job_id, celery_task_id, error_code=error_code, exc=exc
    )


__all__ = [
    "PROVENANCE_UNAVAILABLE_MESSAGE",
    "QUEUE_UNAVAILABLE_MESSAGE",
    "QueueUnavailableError",
    "SAFE_FAILURE_MESSAGE",
    "SUBMISSIONS_DISABLED_MESSAGE",
    "claim_household_analysis_job",
    "household_config",
    "store_household_analysis_failure",
    "store_household_analysis_success",
    "submissions_enabled",
    "submit_household_analysis",
]
