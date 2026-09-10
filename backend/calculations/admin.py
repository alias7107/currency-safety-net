from django.contrib import admin

from .models import OptimizationJob


@admin.register(OptimizationJob)
class OptimizationJobAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "status",
        "attempt_count",
        "model_version",
        "data_as_of",
        "created_at",
        "completed_at",
    )
    list_filter = ("status", "model_version")
    search_fields = ("id", "request_fingerprint", "error_code", "celery_task_id")
    readonly_fields = (
        "id",
        "request_fingerprint",
        "request_payload",
        "result_payload",
        "error_code",
        "error_message",
        "model_version",
        "data_as_of",
        "celery_task_id",
        "attempt_count",
        "created_at",
        "updated_at",
        "started_at",
        "completed_at",
        "lease_expires_at",
    )
