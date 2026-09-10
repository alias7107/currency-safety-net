"""Structured API exceptions without stack traces in responses."""

from __future__ import annotations

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        return Response(
            {
                "error": {
                    "code": "internal_error",
                    "message": "An unexpected server error occurred.",
                }
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    detail = response.data
    if isinstance(detail, dict) and "error" in detail:
        return response

    return Response(
        {
            "error": {
                "code": "validation_error"
                if response.status_code == status.HTTP_400_BAD_REQUEST
                else "request_error",
                "message": "The request could not be processed.",
                "details": detail,
            }
        },
        status=response.status_code,
    )
