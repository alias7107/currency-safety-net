from django.urls import path

from .views import (
    BufferSensitivityJobCreateView,
    BufferSensitivityJobDetailView,
    HealthView,
    HouseholdAnalysisJobCreateView,
    HouseholdAnalysisJobDetailView,
    ModelMetadataView,
    ModelOptionsView,
    OptimizationJobCreateView,
    OptimizationJobDetailView,
    ReadyView,
)

urlpatterns = [
    path("health/", HealthView.as_view(), name="health"),
    path("ready/", ReadyView.as_view(), name="ready"),
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
    path(
        "household-analysis-jobs/",
        HouseholdAnalysisJobCreateView.as_view(),
        name="household-analysis-job-create",
    ),
    path(
        "household-analysis-jobs/<uuid:job_id>/",
        HouseholdAnalysisJobDetailView.as_view(),
        name="household-analysis-job-detail",
    ),
]
