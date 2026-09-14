"""Production/runtime configuration helpers for Currency Safety Net.

These helpers keep ``project.settings`` readable and make production validation
testable without inventing scientific behavior.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from django.core.exceptions import ImproperlyConfigured

DEV_SECRET_FALLBACK = "dev-only-not-for-production-change-me"

_RATE_RE = re.compile(r"^\d+/(s|sec|m|min|h|hour|d|day)$", re.IGNORECASE)


def validate_secret_configuration(*, debug: bool, secret_key: str) -> None:
    if not debug and secret_key == DEV_SECRET_FALLBACK:
        raise ImproperlyConfigured(
            "DJANGO_SECRET_KEY must be set to a non-development value when DEBUG=False."
        )


def validate_allowed_hosts(*, debug: bool, allowed_hosts: list[str]) -> None:
    hosts = [h.strip() for h in allowed_hosts if str(h).strip()]
    if debug:
        return
    if not hosts:
        raise ImproperlyConfigured("ALLOWED_HOSTS must be set when DEBUG=False.")
    if any(h == "*" for h in hosts):
        raise ImproperlyConfigured(
            "ALLOWED_HOSTS must not contain '*' for the research pilot."
        )


def validate_retention_days(days: int) -> int:
    if not isinstance(days, int) or isinstance(days, bool):
        raise ImproperlyConfigured("JOB_RETENTION_DAYS must be an integer.")
    if days < 1 or days > 365:
        raise ImproperlyConfigured(
            "JOB_RETENTION_DAYS must be between 1 and 365 inclusive."
        )
    return days


def _require_redis_url(url: str, *, label: str) -> str:
    value = (url or "").strip()
    if not value:
        raise ImproperlyConfigured(f"{label} must be set.")
    parsed = urlparse(value)
    if parsed.scheme not in {"redis", "rediss"}:
        raise ImproperlyConfigured(f"{label} must be a redis:// or rediss:// URL.")
    if not parsed.hostname:
        raise ImproperlyConfigured(f"{label} must include a hostname.")
    return value


def validate_production_redis(
    *,
    debug: bool,
    broker_url: str,
    result_backend: str,
    cache_url: str,
) -> None:
    if debug:
        return
    _require_redis_url(broker_url, label="CELERY_BROKER_URL")
    _require_redis_url(result_backend, label="CELERY_RESULT_BACKEND")
    _require_redis_url(cache_url, label="REDIS_CACHE_URL")
    # Keep namespaces explicit: refuse identical URLs for broker and cache.
    if broker_url.strip() == cache_url.strip():
        raise ImproperlyConfigured(
            "REDIS_CACHE_URL must differ from CELERY_BROKER_URL "
            "(use a separate Redis logical database or instance)."
        )


def build_databases(
    *,
    debug: bool,
    sqlite_path: str,
    database_url: str | None,
    conn_max_age: int,
) -> dict[str, Any]:
    """Return Django DATABASES.

    Local/dev/tests use SQLite. Production (DEBUG=False) requires DATABASE_URL.
    """
    if debug and not (database_url or "").strip():
        return {
            "default": {
                "ENGINE": "django.db.backends.sqlite3",
                "NAME": sqlite_path,
            }
        }

    url = (database_url or "").strip()
    if not url:
        raise ImproperlyConfigured(
            "DATABASE_URL must be set when DEBUG=False (PostgreSQL required)."
        )
    parsed = urlparse(url)
    if parsed.scheme not in {"postgres", "postgresql", "pgsql"}:
        raise ImproperlyConfigured(
            "DATABASE_URL must use a PostgreSQL scheme (postgres/postgresql)."
        )
    if not parsed.hostname or not parsed.path or parsed.path == "/":
        raise ImproperlyConfigured(
            "DATABASE_URL must include host and database name."
        )
    name = parsed.path.lstrip("/")
    return {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": name,
            "USER": parsed.username or "",
            "PASSWORD": parsed.password or "",
            "HOST": parsed.hostname or "",
            "PORT": str(parsed.port or ""),
            "CONN_MAX_AGE": max(0, int(conn_max_age)),
            "CONN_HEALTH_CHECKS": True,
            "OPTIONS": {
                "connect_timeout": 5,
            },
        }
    }


def build_caches(*, debug: bool, cache_url: str) -> dict[str, Any]:
    """LocMem in development; RedisCache in production."""
    if debug and not (cache_url or "").strip():
        return {
            "default": {
                "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
                "LOCATION": "csn-dev-throttles",
            }
        }
    url = _require_redis_url(cache_url, label="REDIS_CACHE_URL")
    return {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": url,
            "KEY_PREFIX": "csn",
            "TIMEOUT": 300,
        }
    }


def is_locmem_cache(caches: dict[str, Any]) -> bool:
    backend = str(caches.get("default", {}).get("BACKEND", ""))
    return backend.endswith("LocMemCache") or backend.endswith(
        "django.core.cache.backends.locmem.LocMemCache"
    )
