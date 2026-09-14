"""HTTP views for the asynchronous optimization API.

These views never import or call the research optimizer.
"""

from __future__ import annotations

from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .batch_contract import (
    BUFFER_SENSITIVITY_CONTRACT_VERSION,
    DOCUMENTED_BUFFERS,
)
from .batch_services import (
    QUEUE_UNAVAILABLE_MESSAGE as BATCH_QUEUE_UNAVAILABLE_MESSAGE,
    SUBMISSIONS_DISABLED_MESSAGE,
    QueueUnavailableError as BatchQueueUnavailableError,
    submit_buffer_sensitivity_job,
    submissions_enabled,
)
from .manifest import public_metadata, public_options
from .models import BufferSensitivityJob, OptimizationJob
from .serializers import (
    BufferSensitivityJobCreateSerializer,
    OptimizationJobCreateSerializer,
)
from .services import (
    QUEUE_UNAVAILABLE_MESSAGE,
    SUBMISSIONS_DISABLED_MESSAGE as OPTIMIZATION_SUBMISSIONS_DISABLED_MESSAGE,
    QueueUnavailableError,
    submit_optimization_job,
    submissions_enabled as optimization_submissions_enabled,
)
from .throttles import (
    BufferSensitivitySubmitThrottle,
    JobPollThrottle,
    ModelMetadataThrottle,
    OptimizationSubmitThrottle,
)


def _iso(dt) -> str | None:
    if dt is None:
        return None
    return dt.isoformat().replace("+00:00", "Z")


class HealthView(APIView):
    """Liveness only — does not check database or Redis."""

    authentication_classes: list = []
    permission_classes: list = []

    def get(self, request: Request) -> Response:
        return Response({"status": "ok"})


class ReadyView(APIView):
    """Readiness: bounded database and Redis checks. Never runs the optimizer."""

    authentication_classes: list = []
    permission_classes: list = []

    def get(self, request: Request) -> Response:
        from django.core.cache import cache
        from django.db import connection

        try:
            connection.ensure_connection()
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
        except Exception:
            return Response(
                {"status": "not_ready", "checks": {"database": "unavailable"}},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        try:
            cache.set("csn:ready:ping", "1", timeout=5)
            if cache.get("csn:ready:ping") != "1":
                raise RuntimeError("cache round-trip failed")
        except Exception:
            return Response(
                {"status": "not_ready", "checks": {"cache": "unavailable"}},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return Response(
            {"status": "ready", "checks": {"database": "ok", "cache": "ok"}},
            status=status.HTTP_200_OK,
        )

class ModelMetadataView(APIView):
    authentication_classes: list = []
    permission_classes: list = []
    throttle_classes = [ModelMetadataThrottle]

    def get(self, request: Request) -> Response:
        return Response(public_metadata())


class ModelOptionsView(APIView):
    authentication_classes: list = []
    permission_classes: list = []
    throttle_classes = [ModelMetadataThrottle]

    def get(self, request: Request) -> Response:
        return Response(public_options())


class OptimizationJobCreateView(APIView):
    authentication_classes: list = []
    permission_classes: list = []
    throttle_classes = [OptimizationSubmitThrottle]

    def post(self, request: Request) -> Response:
        if not optimization_submissions_enabled():
            return Response(
                {
                    "error": {
                        "code": "submissions_disabled",
                        "message": OPTIMIZATION_SUBMISSIONS_DISABLED_MESSAGE,
                    }
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        serializer = OptimizationJobCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            outcome = submit_optimization_job(serializer.validated_data)
        except QueueUnavailableError as exc:
            return Response(
                {
                    "job_id": str(exc.job.id),
                    "status": OptimizationJob.Status.FAILED,
                    "cached": False,
                    "status_url": f"/api/v1/optimization-jobs/{exc.job.id}/",
                    "error": {
                        "code": "queue_unavailable",
                        "message": QUEUE_UNAVAILABLE_MESSAGE,
                    },
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        body = {
            "job_id": str(outcome.job.id),
            "status": outcome.job.status,
            "cached": outcome.cached,
            "status_url": f"/api/v1/optimization-jobs/{outcome.job.id}/",
        }
        if outcome.cached and outcome.job.status == OptimizationJob.Status.SUCCEEDED:
            body["result"] = outcome.job.result_payload
        elif outcome.job.status == OptimizationJob.Status.FAILED:
            body["error_code"] = outcome.job.error_code
            body["error_message"] = outcome.job.error_message
        return Response(body, status=outcome.http_status)


class OptimizationJobDetailView(APIView):
    authentication_classes: list = []
    permission_classes: list = []
    throttle_classes = [JobPollThrottle]

    def get(self, request: Request, job_id) -> Response:
        try:
            job = OptimizationJob.objects.get(id=job_id)
        except OptimizationJob.DoesNotExist:
            return Response(
                {
                    "error": {
                        "code": "not_found",
                        "message": "Optimization job not found.",
                    }
                },
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(_optimization_detail_response(job))


class BufferSensitivityJobCreateView(APIView):
    authentication_classes: list = []
    permission_classes: list = []
    throttle_classes = [BufferSensitivitySubmitThrottle]

    def post(self, request: Request) -> Response:
        if not submissions_enabled():
            return Response(
                {
                    "error": {
                        "code": "submissions_disabled",
                        "message": SUBMISSIONS_DISABLED_MESSAGE,
                    }
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        serializer = BufferSensitivityJobCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            outcome = submit_buffer_sensitivity_job(serializer.validated_data)
        except BatchQueueUnavailableError as exc:
            return Response(
                {
                    "job_id": str(exc.job.id),
                    "status": BufferSensitivityJob.Status.FAILED,
                    "cached": False,
                    "status_url": f"/api/v1/buffer-sensitivity-jobs/{exc.job.id}/",
                    "contract_version": BUFFER_SENSITIVITY_CONTRACT_VERSION,
                    "tested_buffers": list(DOCUMENTED_BUFFERS),
                    "error": {
                        "code": "queue_unavailable",
                        "message": BATCH_QUEUE_UNAVAILABLE_MESSAGE,
                    },
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        body = {
            "job_id": str(outcome.job.id),
            "status": outcome.job.status,
            "cached": outcome.cached,
            "status_url": f"/api/v1/buffer-sensitivity-jobs/{outcome.job.id}/",
            "contract_version": getattr(
                outcome.job, "contract_version", BUFFER_SENSITIVITY_CONTRACT_VERSION
            ),
            "tested_buffers": list(DOCUMENTED_BUFFERS),
        }
        if (
            outcome.cached
            and outcome.job.status == BufferSensitivityJob.Status.SUCCEEDED
        ):
            body["result"] = outcome.job.result_payload
        elif outcome.job.status == BufferSensitivityJob.Status.FAILED:
            body["error_code"] = outcome.job.error_code
            body["error_message"] = outcome.job.error_message
        return Response(body, status=outcome.http_status)


class BufferSensitivityJobDetailView(APIView):
    authentication_classes: list = []
    permission_classes: list = []
    throttle_classes = [JobPollThrottle]

    def get(self, request: Request, job_id) -> Response:
        try:
            job = BufferSensitivityJob.objects.get(id=job_id)
        except BufferSensitivityJob.DoesNotExist:
            return Response(
                {
                    "error": {
                        "code": "not_found",
                        "message": "Buffer sensitivity job not found.",
                    }
                },
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(_batch_detail_response(job))


def _optimization_detail_response(job: OptimizationJob) -> dict:
    data = {
        "job_id": str(job.id),
        "status": job.status,
        "created_at": _iso(job.created_at),
        "started_at": _iso(job.started_at),
    }
    if job.completed_at is not None:
        data["completed_at"] = _iso(job.completed_at)
    if job.status == OptimizationJob.Status.SUCCEEDED:
        data["result"] = job.result_payload
    if job.status == OptimizationJob.Status.FAILED:
        data["error_code"] = job.error_code
        data["error_message"] = job.error_message
    return data


def _batch_detail_response(job: BufferSensitivityJob) -> dict:
    data = {
        "job_id": str(job.id),
        "status": job.status,
        "created_at": _iso(job.created_at),
        "started_at": _iso(job.started_at),
        "contract_version": job.contract_version,
        "tested_buffers": list(DOCUMENTED_BUFFERS),
    }
    if job.completed_at is not None:
        data["completed_at"] = _iso(job.completed_at)
    if job.status == BufferSensitivityJob.Status.SUCCEEDED:
        data["result"] = job.result_payload
    if job.status == BufferSensitivityJob.Status.FAILED:
        data["error_code"] = job.error_code
        data["error_message"] = job.error_message
    return data
