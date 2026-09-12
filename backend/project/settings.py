"""
Django settings for Currency Safety Net.

HTTP request handlers must never call ``optimize_allocation`` directly.
Optimization runs only in the Celery worker process.
"""

from __future__ import annotations

from pathlib import Path

import environ
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

DEV_SECRET_FALLBACK = "dev-only-not-for-production-change-me"

env = environ.Env(
    DEBUG=(bool, True),
    ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    CORS_ALLOWED_ORIGINS=(list, ["http://localhost:4200"]),
    CELERY_TASK_ALWAYS_EAGER=(bool, False),
    BUFFER_SENSITIVITY_SUBMISSIONS_ENABLED=(bool, True),
)

environ.Env.read_env(BASE_DIR.parent / ".env")

# Development-only fallback. Set DJANGO_SECRET_KEY in the environment for any
# shared or production deployment.
SECRET_KEY = env("DJANGO_SECRET_KEY", default=DEV_SECRET_FALLBACK)
DEBUG = env("DEBUG")


def validate_secret_configuration(*, debug: bool, secret_key: str) -> None:
    if not debug and secret_key == DEV_SECRET_FALLBACK:
        raise ImproperlyConfigured(
            "DJANGO_SECRET_KEY must be set to a non-development value when DEBUG=False."
        )


validate_secret_configuration(debug=DEBUG, secret_key=SECRET_KEY)

ALLOWED_HOSTS = env("ALLOWED_HOSTS")
if DEBUG and "testserver" not in ALLOWED_HOSTS:
    ALLOWED_HOSTS = list(ALLOWED_HOSTS) + ["testserver", "localhost", "127.0.0.1"]

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

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": env("SQLITE_PATH", default=str(BASE_DIR / "db.sqlite3")),
    }
}

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
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS")

# In-memory DRF throttling is development-only. Production should use Redis.
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

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
        },
    },
    "loggers": {
        "calculations": {
            "handlers": ["console"],
            "level": "INFO",
        },
        "celery": {
            "handlers": ["console"],
            "level": "INFO",
        },
    },
}
