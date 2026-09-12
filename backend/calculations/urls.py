from django.urls import path

from .views import (
    BufferSensitivityJobCreateView,
    BufferSensitivityJobDetailView,
    HealthView,
    ModelMetadataView,
    ModelOptionsView,
    OptimizationJobCreateView,
    OptimizationJobDetailView,
)

urlpatterns = [
    path("health/", HealthView.as_view(), name="health"),
    path("model/metadata/", ModelMetadataView.as_view(), name="model-metadata"),
    path("model/options/", ModelOptionsView.as_view(), name="model-options"),
    path(
        "optimization-jobs/",
        OptimizationJobCreateView.as_view(),
        name="optimization-job-create",
    ),
    path(
        "optimization-jobs/<uuid:job_id>/",
        OptimizationJobDetailView.as_view(),
        name="optimization-job-detail",
    ),
    path(
        "buffer-sensitivity-jobs/",
        BufferSensitivityJobCreateView.as_view(),
        name="buffer-sensitivity-job-create",
    ),
    path(
        "buffer-sensitivity-jobs/<uuid:job_id>/",
        BufferSensitivityJobDetailView.as_view(),
        name="buffer-sensitivity-job-detail",
    ),
]
