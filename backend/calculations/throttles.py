"""Request throttles for the calculations API.

DRF throttles use Django's cache framework. Development may use LocMemCache.
Production must configure Redis via REDIS_CACHE_URL so rates are shared across
API processes. Throttling reduces abuse; it is not a complete security boundary
(see Django REST framework throttling documentation).
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
