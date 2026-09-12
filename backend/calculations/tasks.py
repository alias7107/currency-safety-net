"""Celery tasks that execute the verified research optimizer."""

from __future__ import annotations

import logging

from celery import shared_task
from celery.exceptions import SoftTimeLimitExceeded
from django.conf import settings

from .batch_contract import (
    DOCUMENTED_BUFFERS,
    BatchResultValidationError,
    ProvenanceChangedError,
    assert_job_fingerprint_current,
    assert_optimize_response_matches_request,
    assert_shared_production_provenance,
    build_batch_result_payload,
    build_buffer_result_row,
)
from .batch_services import (
    claim_buffer_sensitivity_job,
    store_buffer_sensitivity_failure,
    store_buffer_sensitivity_success,
)
from .models import BufferSensitivityJob, OptimizationJob
from .services import claim_job_for_execution, store_failure, store_success

logger = logging.getLogger(__name__)


def _is_redelivered(request) -> bool:
    delivery_info = getattr(request, "delivery_info", None) or {}
    return bool(delivery_info.get("redelivered", False))


@shared_task(
    bind=True,
    name="calculations.run_optimization_job",
    soft_time_limit=int(
        getattr(settings, "OPTIMIZATION_TASK_SOFT_TIME_LIMIT", 180)
    ),
    time_limit=int(getattr(settings, "OPTIMIZATION_TASK_TIME_LIMIT", 240)),
)
def run_optimization_job(self, job_id: str) -> dict:
    """Run ``optimize_allocation`` for a claimed job.

    The HTTP process must never call this function synchronously except in
    Celery eager test mode.
    """
    request = getattr(self, "request", None)
    celery_task_id = str(getattr(request, "id", None) or "eager")
    redelivered = _is_redelivered(request)
    job = claim_job_for_execution(
        job_id,
        celery_task_id,
        redelivered=redelivered,
    )
    if job is None:
        existing = OptimizationJob.objects.filter(id=job_id).first()
        status = existing.status if existing else "missing"
        logger.info(
            "Skipping job %s; status=%s task_id=%s redelivered=%s",
            job_id,
            status,
            celery_task_id,
            redelivered,
        )
        return {"job_id": job_id, "skipped": True, "status": status}

    try:
        # Import inside the worker task so web processes do not need the
        # heavy numerical stack at request time beyond validation helpers.
        from research_engine import optimize_allocation

        payload = job.request_payload
        result = optimize_allocation(
            profile=payload["profile"],
            horizon_years=payload["horizon_years"],
            expense_income_ratio=payload["expense_income_ratio"],
            buffer_months=payload["buffer_months"],
            rebalance_frequency=payload["rebalance_frequency"],
            conversion_cost=payload["conversion_cost"],
        )
        stored = store_success(job_id, celery_task_id, result)
        if not stored:
            return {
                "job_id": job_id,
                "skipped": True,
                "status": "stale_result_rejected",
            }
        return {"job_id": job_id, "status": OptimizationJob.Status.SUCCEEDED.value}
    except SoftTimeLimitExceeded as exc:
        store_failure(
            job_id,
            celery_task_id,
            error_code="soft_time_limit",
            exc=exc,
        )
        return {"job_id": job_id, "status": OptimizationJob.Status.FAILED.value}
    except Exception as exc:  # noqa: BLE001 - convert to safe job failure
        store_failure(
            job_id,
            celery_task_id,
            error_code="optimization_failed",
            exc=exc,
        )
        return {"job_id": job_id, "status": OptimizationJob.Status.FAILED.value}


@shared_task(
    bind=True,
    name="calculations.run_buffer_sensitivity_job",
    queue="buffer_sensitivity",
    soft_time_limit=int(
        getattr(settings, "BUFFER_SENSITIVITY_TASK_SOFT_TIME_LIMIT", 600)
    ),
    time_limit=int(getattr(settings, "BUFFER_SENSITIVITY_TASK_TIME_LIMIT", 720)),
)
def run_buffer_sensitivity_job(self, job_id: str) -> dict:
    """Run four sequential public ``optimize_allocation`` calls for fixed buffers.

    Production must never pass ``_fx_bundle``. Partial results are never stored.
    """
    request = getattr(self, "request", None)
    celery_task_id = str(getattr(request, "id", None) or "eager")
    redelivered = _is_redelivered(request)
    job = claim_buffer_sensitivity_job(
        job_id,
        celery_task_id,
        redelivered=redelivered,
    )
    if job is None:
        existing = BufferSensitivityJob.objects.filter(id=job_id).first()
        status = existing.status if existing else "missing"
        logger.info(
            "Skipping buffer sensitivity job %s; status=%s task_id=%s redelivered=%s",
            job_id,
            status,
            celery_task_id,
            redelivered,
        )
        return {"job_id": job_id, "skipped": True, "status": status}

    try:
        assert_job_fingerprint_current(
            request_payload=job.request_payload,
            request_fingerprint=job.request_fingerprint,
            model_version_value=job.model_version,
            data_as_of_value=job.data_as_of,
            contract_version_value=job.contract_version,
        )

        from research_engine import optimize_allocation

        scenario = job.request_payload
        optimize_payloads: list[dict] = []
        for buffer_months in DOCUMENTED_BUFFERS:
            payload = optimize_allocation(
                profile=scenario["profile"],
                horizon_years=scenario["horizon_years"],
                expense_income_ratio=scenario["expense_income_ratio"],
                buffer_months=float(buffer_months),
                rebalance_frequency=scenario["rebalance_frequency"],
                conversion_cost=scenario["conversion_cost"],
            )
            assert_optimize_response_matches_request(
                payload,
                scenario=scenario,
                buffer_months=float(buffer_months),
            )
            optimize_payloads.append(payload)

        assert_shared_production_provenance(
            optimize_payloads,
            expected_model_version=job.model_version,
            expected_data_as_of=job.data_as_of,
        )
        buffer_rows = [build_buffer_result_row(payload) for payload in optimize_payloads]
        result = build_batch_result_payload(
            scenario=scenario,
            buffer_rows=buffer_rows,
            provenance_source=optimize_payloads[0],
        )
        stored = store_buffer_sensitivity_success(job_id, celery_task_id, result)
        if not stored:
            logger.warning(
                "Discarded stale buffer sensitivity success for job %s (task %s)",
                job_id,
                celery_task_id,
            )
            return {
                "job_id": job_id,
                "skipped": True,
                "status": "stale_result_rejected",
            }
        return {
            "job_id": job_id,
            "status": BufferSensitivityJob.Status.SUCCEEDED.value,
        }
    except ProvenanceChangedError as exc:
        store_buffer_sensitivity_failure(
            job_id,
            celery_task_id,
            error_code="provenance_changed",
            exc=exc,
        )
        return {"job_id": job_id, "status": BufferSensitivityJob.Status.FAILED.value}
    except BatchResultValidationError as exc:
        store_buffer_sensitivity_failure(
            job_id,
            celery_task_id,
            error_code="result_validation_failed",
            exc=exc,
        )
        return {"job_id": job_id, "status": BufferSensitivityJob.Status.FAILED.value}
    except SoftTimeLimitExceeded as exc:
        store_buffer_sensitivity_failure(
            job_id,
            celery_task_id,
            error_code="soft_time_limit",
            exc=exc,
        )
        return {"job_id": job_id, "status": BufferSensitivityJob.Status.FAILED.value}
    except Exception as exc:  # noqa: BLE001 - convert to safe job failure
        store_buffer_sensitivity_failure(
            job_id,
            celery_task_id,
            error_code="optimization_failed",
            exc=exc,
        )
        return {"job_id": job_id, "status": BufferSensitivityJob.Status.FAILED.value}
