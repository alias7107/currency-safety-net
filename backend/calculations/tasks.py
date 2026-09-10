"""Celery tasks that execute the verified research optimizer."""

from __future__ import annotations

import logging

from celery import shared_task
from celery.exceptions import SoftTimeLimitExceeded

from .models import OptimizationJob
from .services import claim_job_for_execution, store_failure, store_success

logger = logging.getLogger(__name__)


def _is_redelivered(request) -> bool:
    delivery_info = getattr(request, "delivery_info", None) or {}
    return bool(delivery_info.get("redelivered", False))


@shared_task(bind=True, name="calculations.run_optimization_job")
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
        store_success(job_id, celery_task_id, result)
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
