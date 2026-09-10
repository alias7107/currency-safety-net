from __future__ import annotations

import uuid

from django.db import models
from django.utils import timezone


class OptimizationJob(models.Model):
    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        RUNNING = "running", "Running"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.QUEUED,
        db_index=True,
    )
    request_fingerprint = models.CharField(max_length=64, unique=True)
    request_payload = models.JSONField()
    result_payload = models.JSONField(null=True, blank=True)
    error_code = models.CharField(max_length=64, null=True, blank=True)
    error_message = models.CharField(max_length=512, null=True, blank=True)
    model_version = models.CharField(max_length=32)
    data_as_of = models.CharField(max_length=32)
    celery_task_id = models.CharField(max_length=255, null=True, blank=True, db_index=True)
    attempt_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    lease_expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.id} ({self.status})"

    def lease_is_valid(self, now=None) -> bool:
        now = now or timezone.now()
        return bool(
            self.status == self.Status.RUNNING
            and self.lease_expires_at is not None
            and self.lease_expires_at > now
        )
