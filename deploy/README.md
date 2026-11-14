# Deployment

Run the application on a single host with Docker Compose. Caddy serves the
Angular build and proxies `/api/` to Gunicorn. PostgreSQL stores jobs and
results; Redis provides the broker, result backend and shared throttle cache.

| File                        | Purpose                                                      |
| --------------------------- | ------------------------------------------------------------ |
| `Dockerfile.api`            | Python 3.11 image for Django, Celery and management commands |
| `Dockerfile.frontend`       | Angular build and Caddy runtime                              |
| `Caddyfile`                 | HTTPS, static files, API proxy and indexing headers          |
| `compose.production.yaml`   | Shared services and worker profiles                          |
| `compose.low-resource.yaml` | Combined-worker pilot overrides                              |
| `.env.production.example`   | Full deployment environment template                         |
| `.env.pilot.example`        | Pilot environment template                                   |

## Profiles

| Profile | Workers                                          | API                         | Host starting point |
| ------- | ------------------------------------------------ | --------------------------- | ------------------- |
| `pilot` | One worker consuming `celery,buffer_sensitivity` | 1 process, 2 threads        | 4 GB RAM            |
| `full`  | Separate `worker_opt` and `worker_buffer`        | 2 processes, 2 threads each | 8 GB RAM            |
| `ops`   | One-off migration and cleanup commands           | —                           | Same host           |

Use either `pilot` or `full`, never both. Worker concurrency and prefetch are
one, with a fresh child process after each task. Measure runtime and memory
on the intended host, especially for five-year or flat-surface custom cases.

## Pilot setup

Run commands from the repository root. Create `deploy/.env.pilot` from its
example and fill in the domain, ACME email, database password and Django secret.
The helper below sets `CSN_ENV_FILE=.env.pilot` so the base Compose file and
the override use the same environment file.

```bash
cp deploy/.env.pilot.example deploy/.env.pilot
```

Use this shell helper after editing the environment:

```bash
csn() {
  CSN_ENV_FILE=.env.pilot docker compose --env-file deploy/.env.pilot \
    -f deploy/compose.production.yaml \
    -f deploy/compose.low-resource.yaml "$@"
}

csn --profile pilot config --quiet
csn --profile pilot build
csn --profile ops run --rm migrate
csn --profile pilot up -d
csn --profile pilot ps
```

Configure DNS for the public domain and allow inbound HTTP/HTTPS. Database
and Redis ports remain internal. Preserve the PostgreSQL and Caddy data volumes.

## Full deployment

Create and fill in `deploy/.env.production` from its example, then use the
base Compose file without the low-resource override:

```bash
docker compose --env-file deploy/.env.production \
  -f deploy/compose.production.yaml --profile full build
docker compose --env-file deploy/.env.production \
  -f deploy/compose.production.yaml --profile ops run --rm migrate
docker compose --env-file deploy/.env.production \
  -f deploy/compose.production.yaml --profile full up -d
```

## Configuration

Production requires `DEBUG=False`, a non-development `DJANGO_SECRET_KEY`,
explicit `ALLOWED_HOSTS`, a PostgreSQL `DATABASE_URL`, and a distinct
`REDIS_CACHE_URL`. Typical Redis database numbers are broker `/0`, results
`/1` and cache `/2`. Enable trusted proxy headers only behind the configured
reverse proxy. Admin access defaults to disabled in production.

| Submission switch                        | Default |
| ---------------------------------------- | ------- |
| `OPTIMIZATION_SUBMISSIONS_ENABLED`       | `True`  |
| `BUFFER_SENSITIVITY_SUBMISSIONS_ENABLED` | `True`  |
| `HOUSEHOLD_ANALYSIS_SUBMISSIONS_ENABLED` | `False` |

Disabled submissions do not remove access to existing job results. Personal
simulations use the ordinary `celery` queue. Before enabling them, verify
the actual host's runtime limits and recovery behavior.

## Health and maintenance

- `/api/v1/health/`: process liveness.
- `/api/v1/ready/`: configured dependency readiness; this does not prove worker
  capacity or completion of a long calculation.
- Use a Celery worker check for workers, not an HTTP check against port 8000.
- `cleanup_expired_jobs` removes expired terminal jobs only. A daily scheduler
  must invoke it; Compose does not install a schedule automatically.
- Back up PostgreSQL off-host and test restoration before relying on the backup.

Using the pilot helper:

```bash
csn --profile pilot logs --tail=100 api worker_pilot proxy
csn --profile ops run --rm cleanup python manage.py cleanup_expired_jobs --dry-run
```

See the [operations runbook](../docs/deployment/pilot-operations-runbook.md)
and [low-resource profile](../docs/deployment/low-resource-pilot-profile.md).
