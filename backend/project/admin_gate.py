"""Disable Django admin when ADMIN_ENABLED is false."""

from __future__ import annotations

from django.conf import settings
from django.http import HttpResponseNotFound


class AdminGateMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path
        if path.startswith("/admin") and not getattr(settings, "ADMIN_ENABLED", False):
            return HttpResponseNotFound("Not found.")
        return self.get_response(request)
