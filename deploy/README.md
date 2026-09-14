# Deployment packaging (Phase 4B / 4B.1)

| File | Purpose |
|---|---|
| `Dockerfile.api` | Django/Gunicorn + Celery image (Python 3.9.6) |
| `Dockerfile.frontend` | Angular 22 / Node 24 build + Caddy |
| `Caddyfile` | Same-origin TLS reverse proxy (`/` + `/api/`) |
| `compose.production.yaml` | Shared stack + worker profiles `full` / `pilot` / `ops` |
| `compose.low-resource.yaml` | Low-resource override (Gunicorn 1×2, `.env.pilot`) |
| `.env.production.example` | Full ≈8 GB profile env template |
| `.env.pilot.example` | Low-resource ≈4 GB profile env template |

Design/runbook: [`docs/deployment/low-resource-pilot-profile.md`](../docs/deployment/low-resource-pilot-profile.md)

## Modes (do not mix worker profiles)

### Low-resource research pilot (`--profile pilot`)

- Candidate host: ≈4 GB RAM, 2–4 vCPU (benchmark required; not guaranteed).
- One Celery process: queues `celery,buffer_sensitivity`, concurrency 1.
- Gunicorn: 1 worker × 2 threads.
- Placeholder domain in examples: `research-pilot.example.com`.

```bash
cp deploy/.env.pilot.example deploy/.env.pilot
# edit secrets

docker compose --env-file deploy/.env.pilot \
  -f deploy/compose.production.yaml \
  -f deploy/compose.low-resource.yaml \
  --profile pilot config

docker compose --env-file deploy/.env.pilot \
  -f deploy/compose.production.yaml \
  -f deploy/compose.low-resource.yaml \
  --profile ops run --rm migrate

docker compose --env-file deploy/.env.pilot \
  -f deploy/compose.production.yaml \
  -f deploy/compose.low-resource.yaml \
  --profile pilot up -d

docker compose --env-file deploy/.env.pilot \
  -f deploy/compose.production.yaml \
  -f deploy/compose.low-resource.yaml \
  --profile pilot ps

docker compose --env-file deploy/.env.pilot \
  -f deploy/compose.production.yaml \
  -f deploy/compose.low-resource.yaml \
  --profile pilot logs --tail=200

docker compose --env-file deploy/.env.pilot \
  -f deploy/compose.production.yaml \
  -f deploy/compose.low-resource.yaml \
  --profile ops run --rm cleanup

docker compose --env-file deploy/.env.pilot \
  -f deploy/compose.production.yaml \
  -f deploy/compose.low-resource.yaml \
  --profile pilot down
```

### Full pilot/production candidate (`--profile full`)

- Candidate host: ≥8 GB RAM (still concurrency 1 per dedicated worker).
- Services: `worker_opt` + `worker_buffer`.
- Gunicorn defaults: 2 workers × 2 threads.

```bash
cp deploy/.env.production.example deploy/.env.production
docker compose --env-file deploy/.env.production \
  -f deploy/compose.production.yaml \
  --profile ops run --rm migrate
docker compose --env-file deploy/.env.production \
  -f deploy/compose.production.yaml \
  --profile full up -d
```

**Never** pass `--profile full --profile pilot` together.

## Health

- Liveness: `GET /api/v1/health/`
- Readiness: `GET /api/v1/ready/`

Throttles remain `3/hour` (optimization) and `2/hour` (buffer). Submissions enabled by default; freeze switches are emergencies only.

Personalized assessment remains Phase 5.
