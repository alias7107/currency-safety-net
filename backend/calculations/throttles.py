"""Request throttles for the calculations API.

In-memory DRF throttling is development-only. Shared production throttling
should use a Redis cache backend once deployment architecture is finalized.
"""

from __future__ import annotations

from rest_framework.throttling import AnonRateThrottle


class OptimizationSubmitThrottle(AnonRateThrottle):
    scope = "optimization_submit"


class BufferSensitivitySubmitThrottle(AnonRateThrottle):
    scope = "buffer_sensitivity_submit"


class JobPollThrottle(AnonRateThrottle):
    scope = "job_poll"


class ModelMetadataThrottle(AnonRateThrottle):
    scope = "model_metadata"
