# Pilot Operations Runbook

**Phase:** 4A (design only)  
**Date:** 2026-09-14  
**Companions:** [`phase4a-production-pilot-readiness.md`](./phase4a-production-pilot-readiness.md), [`pilot-deployment-architecture.md`](./pilot-deployment-architecture.md), [`pilot-go-live-checklist.md`](./pilot-go-live-checklist.md)

This runbook describes how a limited research pilot **should** be released, monitored, frozen, and rolled back. It does not execute those steps.

---

## 1. Principles

1. Artifacts are built from **committed** sources in CI or a clean checkout — not from uncommitted local trees.
2. Long optimization work runs only in Celery workers (concurrency **1**, prefetch **1**, max-tasks-per-child **1**).
3. PostgreSQL is system of record; Redis is broker/cache; SQLite is local-dev only.
4. Prefer same-origin `https://<domain>/api/` reverse proxy.
5. Freeze submissions before risky migrations or incident containment.
6. Never paste secrets into tickets or chat logs.

---

## 2. Release sequence

### 2.1 Build artifacts

| Artifact | Command intent (Node 24 / Python 3.9.6) | Output |
|---|---|---|
| Frontend | In `frontend/`: install deps; `npm test -- --watch=false`; `npm run build` | Static files under `frontend/dist/...` |
| Backend/worker image or package | Install `backend/requirements.txt` (+ future `psycopg`); copy app code; **do not** alter `research_engine` science | Runnable API + worker environments |
| Config | Inject production env from secret store | No `.env` committed secrets |

Pin Node via root `.node-version` (`24.21.0`).

### 2.2 Pre-deploy freezes (recommended)

1. Set `BUFFER_SENSITIVITY_SUBMISSIONS_ENABLED=False`.
2. When implemented, set `OPTIMIZATION_SUBMISSIONS_ENABLED=False` (**proposed**).
3. Drain or wait for running tasks (monitor queue + `running` rows).

### 2.3 Database migrations

1. Take PostgreSQL backup (`pg_dump`) **before** migrate.
2. Apply `python manage.py migrate`.
3. Record migration state.
4. If migrate fails: restore backup; do not partial-start workers against a broken schema.

### 2.4 Startup order

**Low-resource pilot** (see `low-resource-pilot-profile.md`):

1. Fill `deploy/.env.pilot` from `.env.pilot.example`.
2. PostgreSQL healthy → Redis healthy.
3. Migrate (`--profile ops run --rm migrate` with both compose files + `--env-file .env.pilot`).
4. Start `--profile pilot` (api + `worker_pilot` + proxy).
5. Confirm `/api/v1/health/` and `/api/v1/ready/`.

**Full profile:**

1. Fill `deploy/.env.production`.
2. Migrate with `--profile ops`.
3. Start `--profile full` (`worker_opt` + `worker_buffer`, not `worker_pilot`).
4. Confirm health/ready.

Never combine `--profile full` and `--profile pilot`.

### 2.5 Enable submissions

1. Confirm smoke tests (section 4) on production-like URL.
2. Re-enable optimization submissions.
3. Re-enable `BUFFER_SENSITIVITY_SUBMISSIONS_ENABLED` only if batch worker is online and measured limits are acceptable.
4. Announce pilot window internally.

---

## 3. Health checks

| Name | Probe | Pass | Fail action |
|---|---|---|---|
| Frontend liveness | `GET https://<domain>/` | HTTP 200 + HTML shell | Page proxy/static |
| API liveness | `GET /api/v1/health/` | `{"status":"ok"}` | Restart API |
| API readiness | `GET /api/v1/ready/` | DB + cache `ok` | Stop taking traffic at proxy |
| Worker process | Supervisor/compose shows workers online | Both consumers registered | Restart worker; investigate OOM |
| Metadata | `GET /api/v1/model/metadata/` | JSON with model_version/data_as_of | Investigate engine packaging |

**Phase 4B:** readiness is implemented. Worker health remains an operational check and is not folded into every readiness probe beyond DB/cache.

### Retention cleanup (daily)

```bash
python manage.py cleanup_expired_jobs
python manage.py cleanup_expired_jobs --dry-run
```

Default `JOB_RETENTION_DAYS=7`. Never deletes `queued`/`running` jobs. Compose ops profile: `cleanup`.

### Submission freeze

| Switch | Effect |
|---|---|
| `BUFFER_SENSITIVITY_SUBMISSIONS_ENABLED=False` | POST batch → 503 `submissions_disabled`; GET remains |
| `OPTIMIZATION_SUBMISSIONS_ENABLED=False` | POST optimization → 503 `submissions_disabled`; GET remains |

---

## 4. Smoke testing plan (do not run expensive jobs in Phase 4A)

Use a **staging** host first. On production, prefer cached/repeated fingerprints after one warm-up window.

| # | Test | Expect |
|---|---|---|
| 1 | Landing + research pages | Render; research framing visible |
| 2 | `GET /api/v1/model/metadata/` + `options/` | 200; documented P1–P4 |
| 3 | One ordinary optimization job | 202→poll→succeeded **or** 200 cached |
| 4 | Identical repeat POST | `cached=true` when succeeded fingerprint exists |
| 5 | One buffer-sensitivity job | 202→poll→succeeded **or** cached; contract buffers `[1,3,6,12]` |
| 6 | Terminal states | succeeded payload validates; failed shows safe codes |
| 7 | Report page | Loads from job id; no stack traces |
| 8 | Comparison | sessionStorage round-trip on device |
| 9 | Safe error rendering | Force 503/HTML upstream in staging; UI shows safe copy |
| 10 | Mobile viewport | No critical overflow on assessment/results |
| 11 | Restart worker mid-queue | Lease expiry allows reclaim; no stuck permanent `running` without lease expiry |
| 12 | Broker unavailable | POST returns `queue_unavailable` / 503 |
| 13 | Backup/restore drill | Restore dump to scratch DB; read known job |
| 14 | Submission freeze | Buffer POST 503 `submissions_disabled`; GET still works |
| 15 | Domain/HTTPS | Redirect HTTP→HTTPS; canonical host; valid cert |

**Cost control:** reuse fingerprints; avoid launching many distinct 5-year P1 batches during drills. Phase 3B worst batch ≈ **466.6 s** and ≈ **1.14–1.19 GiB** RSS.

---

## 5. Monitoring

### 5.1 What to watch

- API 5xx rate, 429 rate, 503 `queue_unavailable`
- Queue depths: `celery`, `buffer_sensitivity`
- Task success/fail counts and runtime histograms
- Worker RSS vs ~1.2 GiB measured peaks
- PostgreSQL connections, disk, backup age
- Redis memory and AOF disk
- Certificate expiry

### 5.2 Alert thresholds

Numeric alert thresholds **must be set after deployment measurements**. Do not copy Phase 3B laptop timings as production SLOs without re-benchmark.

Suggested **qualitative** triggers:

- Worker RSS approaching host limit / OOM killer events
- Job `running` longer than lease
- Backup failed or older than policy
- TLS cert < 14 days (operator choice)

---

## 6. Backups

| Asset | Method | Frequency | Store |
|---|---|---|---|
| PostgreSQL | `pg_dump` | Daily (+ pre-migrate) | Off-host encrypted |
| Redis | Optional RDB/AOF snapshot | Optional | Not a substitute for DB |
| Frontend/API artifacts | Immutable image/tag or tarball | Each release | Artifact registry |
| Secrets | Secret manager backup policy | Per org | Never in DB dumps shared widely |

**Restore drill:** at least once before public pilot and periodically during pilot.

---

## 7. Incident response

### 7.1 Severity examples

| Severity | Example |
|---|---|
| SEV1 | Data leak of job payloads; admin compromise; DEBUG left on publicly |
| SEV2 | Workers down; queue backup; OOM loop; Postgres down |
| SEV3 | Elevated 429s; single job class failing soft time limit on new hardware |

### 7.2 Immediate containment

1. Freeze buffer submissions (`BUFFER_SENSITIVITY_SUBMISSIONS_ENABLED=False`).
2. Freeze optimization submissions when switch exists; otherwise remove/scale proxy route or stop API write path.
3. Preserve logs (without exporting secrets).
4. Snapshot DB if integrity uncertain.
5. Communicate research-pilot status page/banner if public.

### 7.3 Submission freeze details

| Switch | Effect |
|---|---|
| `BUFFER_SENSITIVITY_SUBMISSIONS_ENABLED=False` | POST batch → 503 `submissions_disabled`; GET remains |
| Proposed `OPTIMIZATION_SUBMISSIONS_ENABLED=False` | Same pattern for ordinary jobs |

### 7.4 Safe recovery after worker loss

1. Confirm lease expiry path reclaiming `running` jobs.
2. Restart worker with concurrency 1.
3. Watch redelivery / `attempt_count` vs `OPTIMIZATION_MAX_ATTEMPTS`.
4. Do not manually edit `result_payload` in production.

---

## 8. Rollback

### 8.1 Application rollback

1. Freeze submissions.
2. Redeploy previous immutable API/worker artifact tags.
3. Redeploy previous frontend bundle.
4. Smoke test metadata + one cached job GET.
5. Re-enable submissions.

### 8.2 Migration rollback

- Prefer forward fix.
- If incompatible migration shipped: restore pre-migrate PostgreSQL backup to a rollback environment; only promote after verification.
- Never “hand fix” rows to match new code without a reviewed script.

### 8.3 Domain / TLS rollback

- Keep prior cert automation config.
- Lower DNS TTL before cutover; revert DNS if needed.
- Avoid simultaneous DNS + schema + worker changes in one window.

---

## 9. Security operations checklist (runtime)

- [ ] `DEBUG=False`
- [ ] Non-development `DJANGO_SECRET_KEY`
- [ ] Exact `ALLOWED_HOSTS`
- [ ] Admin disabled or IP/VPN restricted
- [ ] Redis/Postgres not public
- [ ] HTTPS only
- [ ] Shared Redis throttle cache active
- [ ] Log redaction verified on sample worker failure
- [ ] `robots`/noindex for capability URLs

Official guidance: Django deployment checklist (DEBUG, ALLOWED_HOSTS, HTTPS-related settings) — https://docs.djangoproject.com/en/4.2/howto/deployment/checklist/ (accessed 2026-09-14).

---

## 10. Privacy operations

| Event | Action |
|---|---|
| Retention elapsed | Scheduled deletion job (**to be implemented**) removes old jobs |
| User requests deletion | If contact channel exists, delete by job UUID after verification policy |
| Breach suspicion | Freeze submissions; rotate secrets; assess UUID URL exposure window |
| Analytics | Keep disabled unless approved |

Owner must approve retention period before public pilot (candidate: 30 days — **decision required**).

---

## 11. Capacity operations reminder

From Phase 3B artifact (not estimates):

- Batch totals measured ≈ **79 s – 467 s**
- Peak RSS measured ≈ **1138 – 1193 MiB**
- Single call can exceed **120 s** (P2 5y B=1 ≈ **125.2 s**) — task-specific limits exist; re-measure on the pilot host

When both workers are busy, expect queue wait; do not add concurrency without new evidence.

---

## 12. What this runbook does not cover

- Personalized assessment product operations
- Purchasing domains or configuring live DNS (Phase 4A forbidden)
- Changing scientific model parameters, seeds, or path counts
