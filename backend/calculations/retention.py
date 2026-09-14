"""Idempotent retention cleanup for terminal research-pilot jobs."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from project.runtime_config import validate_retention_days

from .models import BufferSensitivityJob, OptimizationJob

TERMINAL_STATUSES = (
    OptimizationJob.Status.SUCCEEDED,
    OptimizationJob.Status.FAILED,
)


@dataclass(frozen=True)
class CleanupResult:
    optimization_count: int
    buffer_sensitivity_count: int

    @property
    def total(self) -> int:
        return self.optimization_count + self.buffer_sensitivity_count


def retention_cutoff(*, now=None):
    days = validate_retention_days(int(getattr(settings, "JOB_RETENTION_DAYS", 7)))
    now = now or timezone.now()
    return now - timedelta(days=days)


def _terminal_queryset(model, cutoff):
    return model.objects.filter(status__in=TERMINAL_STATUSES).filter(
        Q(completed_at__isnull=False, completed_at__lt=cutoff)
        | Q(completed_at__isnull=True, updated_at__lt=cutoff)
    )


def cleanup_expired_jobs(*, cutoff=None, dry_run: bool = False) -> CleanupResult:
    """Delete terminal jobs older than the retention cutoff.

    Never deletes queued or running jobs. Does not log payloads or results.
    """
    cutoff = cutoff or retention_cutoff()
    opt_qs = _terminal_queryset(OptimizationJob, cutoff)
    buf_qs = _terminal_queryset(BufferSensitivityJob, cutoff)
    opt_count = opt_qs.count()
    buf_count = buf_qs.count()
    if not dry_run:
        opt_qs.delete()
        buf_qs.delete()
    return CleanupResult(
        optimization_count=opt_count,
        buffer_sensitivity_count=buf_count,
    )
