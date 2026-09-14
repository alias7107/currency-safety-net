"""
Django settings for Currency Safety Net.

HTTP request handlers must never call ``optimize_allocation`` directly.
Optimization runs only in the Celery worker process.
"""

from __future__ import annotations

from pathlib import Path

import environ
from django.core.exceptions import ImproperlyConfigured

from project.runtime_config import (
    DEV_SECRET_FALLBACK,
    build_caches,
    build_databases,
    validate_allowed_hosts,
    validate_production_redis,
    validate_retention_days,
    validate_secret_configuration,
)

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, True),
    ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    CORS_ALLOWED_ORIGINS=(list, ["http://localhost:4200"]),
    CSRF_TRUSTED_ORIGINS=(list, []),
    CELERY_TASK_ALWAYS_EAGER=(bool, False),
    BUFFER_SENSITIVITY_SUBMISSIONS_ENABLED=(bool, True),
    OPTIMIZATION_SUBMISSIONS_ENABLED=(bool, True),
    ADMIN_ENABLED=(bool, True),
    SECURE_SSL_REDIRECT=(bool, False),
    SECURE_HSTS_SECONDS=(int, 0),
    SECURE_PROXY_SSL_HEADER_ENABLED=(bool, False),
    JOB_RETENTION_DAYS=(int, 7),
    DATABASE_CONN_MAX_AGE=(int, 60),
    DATA_UPLOAD_MAX_MEMORY_SIZE=(int, 65536),
)

environ.Env.read_env(BASE_DIR.parent / ".env")

# Development-only fallback. Set DJANGO_SECRET_KEY in the environment for any
# shared or production deployment.
SECRET_KEY = env("DJANGO_SECRET_KEY", default=DEV_SECRET_FALLBACK)
DEBUG = env("DEBUG")

validate_secret_configuration(debug=DEBUG, secret_key=SECRET_KEY)

ALLOWED_HOSTS = env("ALLOWED_HOSTS")
if DEBUG and "testserver" not in ALLOWED_HOSTS:
    ALLOWED_HOSTS = list(ALLOWED_HOSTS) + ["testserver", "localhost", "127.0.0.1"]
validate_allowed_hosts(debug=DEBUG, allowed_hosts=list(ALLOWED_HOSTS))

# Admin is enabled in development by default; production defaults to disabled
# unless ADMIN_ENABLED=True is explicitly set with DEBUG=False.
ADMIN_ENABLED = env("ADMIN_ENABLED") if DEBUG else env.bool("ADMIN_ENABLED", default=False)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "calculations",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "project.admin_gate.AdminGateMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "project.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "project.wsgi.application"

DATABASE_URL = env("DATABASE_URL", default="")
DATABASES = build_databases(
    debug=DEBUG,
    sqlite_path=env("SQLITE_PATH", default=str(BASE_DIR / "db.sqlite3")),
    database_url=DATABASE_URL or None,
    conn_max_age=env("DATABASE_CONN_MAX_AGE"),
)

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS")
CSRF_TRUSTED_ORIGINS = env("CSRF_TRUSTED_ORIGINS")

# Same-origin production typically leaves CORS empty or unused. Development
# keeps localhost:4200. DRF throttling is abuse reduction, not a complete
# security boundary (see DRF throttling documentation).
REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": env("DRF_ANON_THROTTLE", default="60/min"),
        "optimization_submit": env("DRF_OPTIMIZATION_SUBMIT_THROTTLE", default="3/hour"),
        "buffer_sensitivity_submit": env(
            "DRF_BUFFER_SENSITIVITY_SUBMIT_THROTTLE", default="2/hour"
        ),
        "job_poll": env("DRF_JOB_POLL_THROTTLE", default="120/min"),
        "model_metadata": env("DRF_MODEL_METADATA_THROTTLE", default="60/min"),
    },
    "EXCEPTION_HANDLER": "calculations.exceptions.api_exception_handler",
    "UNAUTHENTICATED_USER": None,
}

CELERY_BROKER_URL = env("CELERY_BROKER_URL", default="redis://127.0.0.1:6379/0")
CELERY_RESULT_BACKEND = env("CELERY_RESULT_BACKEND", default="redis://127.0.0.1:6379/1")
REDIS_CACHE_URL = env("REDIS_CACHE_URL", default="")

validate_production_redis(
    debug=DEBUG,
    broker_url=CELERY_BROKER_URL,
    result_backend=CELERY_RESULT_BACKEND,
    cache_url=REDIS_CACHE_URL,
)

CACHES = build_caches(debug=DEBUG, cache_url=REDIS_CACHE_URL)

CELERY_TASK_ALWAYS_EAGER = env("CELERY_TASK_ALWAYS_EAGER")
CELERY_TASK_EAGER_PROPAGATES = True
CELERY_TASK_ACKS_LATE = True
CELERY_TASK_REJECT_ON_WORKER_LOST = True
CELERY_TASK_PUBLISH_RETRY = False
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_WORKER_CONCURRENCY = 1
CELERY_WORKER_MAX_TASKS_PER_CHILD = 1
# Global defaults for unrelated Celery tasks. Optimization/batch tasks use
# explicit task-specific soft/hard limits via annotations and decorators.
CELERY_TASK_SOFT_TIME_LIMIT = 120
CELERY_TASK_TIME_LIMIT = 180
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TASK_TRACK_STARTED = True
# Short broker timeouts so the HTTP process does not hang on publish.
CELERY_BROKER_CONNECTION_TIMEOUT = float(env("CELERY_BROKER_CONNECTION_TIMEOUT", default=2.0))
CELERY_BROKER_CONNECTION_MAX_RETRIES = int(env("CELERY_BROKER_CONNECTION_MAX_RETRIES", default=0))
CELERY_BROKER_TRANSPORT_OPTIONS = {
    "socket_timeout": CELERY_BROKER_CONNECTION_TIMEOUT,
    "socket_connect_timeout": CELERY_BROKER_CONNECTION_TIMEOUT,
    "retry_on_timeout": False,
}

# Single optimization task limits (Phase 3C defaults from Phase 3B measurements).
OPTIMIZATION_TASK_SOFT_TIME_LIMIT = int(
    env("OPTIMIZATION_TASK_SOFT_TIME_LIMIT", default=180)
)
OPTIMIZATION_TASK_TIME_LIMIT = int(env("OPTIMIZATION_TASK_TIME_LIMIT", default=240))
OPTIMIZATION_MAX_ATTEMPTS = int(env("OPTIMIZATION_MAX_ATTEMPTS", default=2))
OPTIMIZATION_LEASE_SECONDS = int(env("OPTIMIZATION_LEASE_SECONDS", default=300))
OPTIMIZATION_LEASE_SAFETY_MARGIN_SECONDS = 60
OPTIMIZATION_SUBMISSIONS_ENABLED = env("OPTIMIZATION_SUBMISSIONS_ENABLED")

# Buffer sensitivity batch task limits.
BUFFER_SENSITIVITY_TASK_SOFT_TIME_LIMIT = int(
    env("BUFFER_SENSITIVITY_TASK_SOFT_TIME_LIMIT", default=600)
)
BUFFER_SENSITIVITY_TASK_TIME_LIMIT = int(
    env("BUFFER_SENSITIVITY_TASK_TIME_LIMIT", default=720)
)
BUFFER_SENSITIVITY_LEASE_SECONDS = int(
    env("BUFFER_SENSITIVITY_LEASE_SECONDS", default=840)
)
BUFFER_SENSITIVITY_LEASE_SAFETY_MARGIN_SECONDS = 120
BUFFER_SENSITIVITY_SUBMISSIONS_ENABLED = env("BUFFER_SENSITIVITY_SUBMISSIONS_ENABLED")
BUFFER_SENSITIVITY_QUEUE = "buffer_sensitivity"

JOB_RETENTION_DAYS = validate_retention_days(env("JOB_RETENTION_DAYS"))

CELERY_TASK_ANNOTATIONS = {
    "calculations.run_optimization_job": {
        "soft_time_limit": OPTIMIZATION_TASK_SOFT_TIME_LIMIT,
        "time_limit": OPTIMIZATION_TASK_TIME_LIMIT,
    },
    "calculations.run_buffer_sensitivity_job": {
        "soft_time_limit": BUFFER_SENSITIVITY_TASK_SOFT_TIME_LIMIT,
        "time_limit": BUFFER_SENSITIVITY_TASK_TIME_LIMIT,
    },
}
CELERY_TASK_ROUTES = {
    "calculations.run_buffer_sensitivity_job": {
        "queue": BUFFER_SENSITIVITY_QUEUE,
    },
}


def validate_lease_configuration(
    *,
    lease_seconds: int,
    task_time_limit: int,
    safety_margin_seconds: int = 30,
) -> None:
    """Require lease longer than the hard kill with a safety margin.

    Default safety margin remains 30s for backward-compatible unit tests.
    Startup validation for production job types uses the larger margins below.
    """
    if lease_seconds <= task_time_limit:
        raise ImproperlyConfigured(
            "Lease seconds must be greater than the hard time limit "
            f"(got lease={lease_seconds}, time_limit={task_time_limit})."
        )
    minimum_with_margin = task_time_limit + safety_margin_seconds
    if lease_seconds < minimum_with_margin:
        raise ImproperlyConfigured(
            "Lease seconds must be at least hard time limit "
            f"+ {safety_margin_seconds}s safety margin "
            f"(got lease={lease_seconds}, required>={minimum_with_margin})."
        )


def validate_task_time_limits(
    *,
    soft_time_limit: int,
    hard_time_limit: int,
    lease_seconds: int,
    safety_margin_seconds: int,
    label: str,
) -> None:
    """Validate soft < hard and lease > hard with the configured margin."""
    if soft_time_limit >= hard_time_limit:
        raise ImproperlyConfigured(
            f"{label}: soft time limit must be less than hard time limit "
            f"(got soft={soft_time_limit}, hard={hard_time_limit})."
        )
    validate_lease_configuration(
        lease_seconds=lease_seconds,
        task_time_limit=hard_time_limit,
        safety_margin_seconds=safety_margin_seconds,
    )


validate_task_time_limits(
    soft_time_limit=OPTIMIZATION_TASK_SOFT_TIME_LIMIT,
    hard_time_limit=OPTIMIZATION_TASK_TIME_LIMIT,
    lease_seconds=OPTIMIZATION_LEASE_SECONDS,
    safety_margin_seconds=OPTIMIZATION_LEASE_SAFETY_MARGIN_SECONDS,
    label="optimization job",
)
validate_task_time_limits(
    soft_time_limit=BUFFER_SENSITIVITY_TASK_SOFT_TIME_LIMIT,
    hard_time_limit=BUFFER_SENSITIVITY_TASK_TIME_LIMIT,
    lease_seconds=BUFFER_SENSITIVITY_LEASE_SECONDS,
    safety_margin_seconds=BUFFER_SENSITIVITY_LEASE_SAFETY_MARGIN_SECONDS,
    label="buffer sensitivity job",
)

# --- HTTP security (environment-driven; development remains usable) ---
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = False
SECURE_SSL_REDIRECT = env("SECURE_SSL_REDIRECT") if not DEBUG else False
SECURE_HSTS_SECONDS = 0 if DEBUG else env("SECURE_HSTS_SECONDS")
SECURE_HSTS_INCLUDE_SUBDOMAINS = bool(SECURE_HSTS_SECONDS)
SECURE_HSTS_PRELOAD = False
if env("SECURE_PROXY_SSL_HEADER_ENABLED") and not DEBUG:
    # Only enable when the reverse proxy strips client-supplied values and sets
    # X-Forwarded-Proto correctly (Django deployment checklist).
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
else:
    SECURE_PROXY_SSL_HEADER = None

DATA_UPLOAD_MAX_MEMORY_SIZE = env("DATA_UPLOAD_MAX_MEMORY_SIZE")
DATA_UPLOAD_MAX_NUMBER_FIELDS = 100
FILE_UPLOAD_MAX_MEMORY_SIZE = DATA_UPLOAD_MAX_MEMORY_SIZE

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "structured": {
            "format": (
                "%(asctime)s level=%(levelname)s service=%(name)s "
                "%(message)s"
            ),
            "datefmt": "%Y-%m-%dT%H:%M:%S%z",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "structured",
        },
    },
    "loggers": {
        "calculations": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,
        },
        "celery": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": False,
        },
        "django.request": {
            "handlers": ["console"],
            "level": "WARNING",
            "propagate": False,
        },
    },
}

# Re-export for existing tests that import from project.settings.
__all__ = [
    "DEV_SECRET_FALLBACK",
    "validate_lease_configuration",
    "validate_secret_configuration",
    "validate_task_time_limits",
]
