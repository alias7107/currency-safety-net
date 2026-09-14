# Phase 4A — Production and Pilot Readiness

**Phase:** 4A (design and audit only) — **updated after Phase 4B packaging**  
**Date:** 2026-09-14 (Phase 4B update: 2026-09-14)

## Phase 4B status addendum

Phase 4B implemented repository hardening and packaging for the decisions below. Staging/public deployment was **not** performed.

| Decision | Status in repository after Phase 4B |
|---|---|
| Research pilot positioning | Implemented (`/research/calculator`, CTA copy) |
| 7-day terminal job retention | Implemented (`cleanup_expired_jobs`, `JOB_RETENTION_DAYS=7`) |
| Analytics disabled | Documented; no analytics added |
| Single VPS + same-origin `/api/` | Packaged in `deploy/compose.production.yaml` + Caddy |
| PostgreSQL in production | Settings + `psycopg`; migration not executed |
| Redis-backed shared throttling | `REDIS_CACHE_URL` + RedisCache when `DEBUG=False` |
| Separate workers concurrency 1 | Compose worker_opt / worker_buffer |
| Optimization submission freeze | `OPTIMIZATION_SUBMISSIONS_ENABLED` |
| Readiness endpoint | `GET /api/v1/ready/` |
| Admin protection | `ADMIN_ENABLED` gate (default off in production) |

**Remaining before Phase 4C staging:** fill real secrets on a host, run migrate against PostgreSQL, deployment-host benchmark, TLS DNS for a real domain, backup restore drill, and operator sign-off.

**Phase 4C readiness decision from Phase 4B work:** `GO WITH REQUIRED CHANGES` (packaging ready; live staging still requires host secrets, DNS/TLS, migrate, and benchmark).

---

**Authoritative workload artifacts:**

| Artifact | Role |
|---|---|
| `docs/product/benchmarks/buffer-sensitivity-phase3b.json` | Measured public-path batch/single timings and peak RSS |
| `docs/product/buffer-sensitivity-batch-design.md` | Phase 3B capacity and queue design narrative |
| `backend/tests/_optimize_benchmark.json` | Additional local single-optimize wall times (P2/P4 3Y) |
| Root `README.md` | Documented worker flags, ≥2 GiB / ≥4 GiB guidance, throttle notes |

---

## 1. Executive conclusion

The repository is **not ready for a safe public domain launch today**, but it is a credible candidate for a **limited research pilot after required production hardening**.

**Decision: `GO WITH REQUIRED CHANGES`.**

Reasons this is not a plain `GO`:

1. Production still uses **SQLite** in settings; README states SQLite is local-only.
2. DRF throttling is **process-local / in-memory** (explicit README + `throttles.py` warning).
3. No production packaging (no application `Dockerfile`, no full-stack production compose beyond Redis).
4. No production HTTPS / `SECURE_*` / proxy-header configuration in Django settings.
5. Public-facing product language (“Check my resilience”, “Assessment”) can overstate a research scenario tool.
6. No documented retention/deletion for stored scenario payloads.
7. Worker time limits and memory guidance were derived on a specific measurement host; **deployment hardware must be re-measured** before claiming production capacity.

Reasons this is not a plain `NO-GO`:

1. Async job lifecycle, leases, fingerprint caching, queue isolation, and task-specific soft/hard limits are already implemented.
2. Buffer-sensitivity freeze switch (`BUFFER_SENSITIVITY_SUBMISSIONS_ENABLED`) exists.
3. API exception handler avoids returning unexpected stack traces.
4. Frontend uses relative `/api/v1` URLs suitable for same-origin reverse proxy.
5. Measured workloads and concurrency=1 worker design are documented with concrete numbers.

---

## 2. Current-state audit (read-only)

### 2.1 Stack and pinned versions

| Layer | Observed |
|---|---|
| Frontend | Angular 22 standalone (`frontend/package.json`); Node pin `.node-version` = `24.21.0` |
| Backend | Django **4.2.25**, DRF **3.15.2**, Celery **5.4.0**, redis-py **5.3.1** (`backend/requirements.txt`) |
| Numerical stack | numpy 2.0.2, pandas 2.3.3, scipy 1.13.1, statsmodels 0.14.6; README requires Python **3.9.6** |
| Broker (local) | Redis 7.2 Alpine via `compose.yaml` (AOF enabled; bound `127.0.0.1:6379`) |
| Database (current) | SQLite via `django.db.backends.sqlite3` (`backend/project/settings.py`) |
| Auth | Not implemented (README); job APIs use empty `authentication_classes` / `permission_classes` |

### 2.2 Runtime topology today

```text
Angular (dev :4200 + proxy.conf.json → :8000)
  → Django WSGI (`project.wsgi`) /api/v1/*
  → Redis broker db0 + result backend db1
  → Celery workers (documented concurrency=1, prefetch=1, max-tasks-per-child=1)
  → research_engine.optimize_allocation (worker only)
  → SQLite job rows
```

HTTP processes must not run the optimizer (`settings.py` and view module docs).

### 2.3 Job systems

| Job | Queue | Create | Poll | Freeze switch |
|---|---|---|---|---|
| `OptimizationJob` | default Celery queue (`celery`) | `POST /api/v1/optimization-jobs/` | `GET .../<uuid>/` | **None** in repository |
| `BufferSensitivityJob` | `buffer_sensitivity` | `POST /api/v1/buffer-sensitivity-jobs/` | `GET .../<uuid>/` | `BUFFER_SENSITIVITY_SUBMISSIONS_ENABLED` |

Both store `request_payload` and `result_payload` JSON, unique `request_fingerprint`, lease fields, and Celery task identity (`backend/calculations/models.py`).

### 2.4 Health and metadata

| Endpoint | Behavior |
|---|---|
| `GET /api/v1/health/` | Returns `{"status":"ok"}` only — **no** DB/Redis checks (`HealthView`) |
| `GET /api/v1/model/metadata/` | Safe model metadata |
| `GET /api/v1/model/options/` | Documented request choices |

### 2.5 Security-relevant configuration gaps

Present:

- `DEBUG` env-driven; refuses development secret when `DEBUG=False`.
- `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS` env-driven.
- Custom API exception handler maps unexpected errors to `internal_error` without stack traces.
- Redis compose bound to localhost for local use.

Absent / incomplete for public pilot:

- No `CACHES` Redis backend for shared throttles.
- No PostgreSQL engine/settings or `psycopg` dependency.
- No `SECURE_SSL_REDIRECT`, HSTS, secure cookie flags, or `SECURE_PROXY_SSL_HEADER` in settings.
- Django admin mounted at `/admin/` with no pilot lockdown documented in code.
- No robots/noindex or Cache-Control policy for capability job URLs in repository.
- No application container build definition.

### 2.6 Logging

`LOGGING` sends `calculations` and `celery` loggers to console at INFO. Task code logs job ids / status / task ids. Workers read full `request_payload` for execution; whether payloads are ever logged depends on exception paths — treat full financial scenario payloads as **must-not-log** in production policy (see privacy section). Current logging is not structured JSON.

### 2.7 Frontend integration

- Dev proxy: `frontend/proxy.conf.json` forwards `/api` → `http://127.0.0.1:8000`.
- Production client always uses relative `/api/v1` (`API_BASE_URL`).
- Comparison and form draft data use **sessionStorage** (browser-local), not the API.
- Product CTAs use “Check my resilience” / “Assessment” (`frontend/src/app/core/i18n/en.ts`); disclaimers also state results are not advice.

---

## 3. Pilot scope

### 3.1 Included in the first hosted research pilot

- Research profiles **P1–P4** only (documented options).
- Single asynchronous optimization jobs with fixed paths/seed.
- Buffer Sensitivity Explorer (four buffers `[1,3,6,12]`), Target Finder (client-side over returned points).
- Resilience Profile, printable report, scenario comparison (sessionStorage).
- Research / methodology pages already in the Angular app.
- Public metadata/options endpoints.

### 3.2 Explicitly excluded

- Personalized household onboarding, accounts, bank connections, or KYC.
- Real-time FX forecasts or trading recommendations.
- “Recommended buffer” / resilience scores as product outputs (methodology forbids these as production API fields).
- Multi-worker concurrency > 1 without new deployment measurements.
- Serverless execution of optimization jobs.
- Guaranteed SLA or concurrent-user capacity claims beyond throttle + queue math below.

### 3.3 Positioning risks (do not edit UI in Phase 4A)

| Surface | Risk | Classification |
|---|---|---|
| Nav / CTA “Check my resilience” | Sounds like a personal diagnostic | **REQUIRED BEFORE PUBLIC PILOT** (copy change) or accepted limitation only if research framing is strengthened elsewhere |
| Nav label “Assessment” | Implies individualized assessment | Same |
| Trust line “No account · No bank connection…” | Helpful, but does not alone prevent overclaim | **RECOMMENDED DURING PILOT** to keep + strengthen research pilot banner |
| README / research pages stating modelled, not advice | Correct scientific framing | Keep |

**Accepted pilot limitation if launch proceeds without full rebrand:** the product remains a **research scenario explorer** for published profiles; public materials and an interstitial banner must say so. Leaving “Check my resilience” unchanged without compensating disclosure is a launch risk.

---

## 4. Findings by severity

### BLOCKER

| ID | Finding |
|---|---|
| B1 | Database engine is SQLite; no production PostgreSQL configuration/dependency. |
| B2 | Throttling is in-memory / process-local; multi-process API would not share submit caps. |
| B3 | No production HTTPS/TLS and Django secure-proxy settings designed into the codebase. |
| B4 | No reproducible production artifact build (application images/compose for API+workers+frontend). |
| B5 | Deployment-host re-benchmark of wall time and peak RSS not yet recorded (Phase 3B host ≠ unknown production host). |

### REQUIRED BEFORE PUBLIC PILOT

| ID | Finding |
|---|---|
| R1 | `DEBUG=False`, unique `DJANGO_SECRET_KEY`, exact `ALLOWED_HOSTS` and CORS/same-origin policy. |
| R2 | Shared Redis-backed Django cache for DRF throttles (separate logical DB from broker preferred). |
| R3 | Admin exposure control (disable, VPN/IP allowlist, or strong auth + HTTPS-only). |
| R4 | Privacy retention decision + automated deletion/disclosure for `request_payload` / results. |
| R5 | Public research-pilot positioning (banner/copy) so “resilience check” is not misread as personal advice. |
| R6 | Ordinary optimization submission freeze switch (parity with buffer freeze) for incidents. |
| R7 | Reverse-proxy same-origin `/api/` (preferred) or locked-down CORS if subdomain API. |
| R8 | `robots`/indexing policy for `/results/` and `/buffer-sensitivity/` capability URLs. |
| R9 | Backup/restore runbooks for PostgreSQL; Redis AOF/RDB policy for broker durability expectations. |
| R10 | Structured logging with job/task ids and **no full financial payloads**. |
| R11 | Readiness checks that include DB (and preferably Redis) separate from shallow liveness. |

### RECOMMENDED DURING PILOT

| ID | Finding |
|---|---|
| P1 | Queue-depth and worker RSS monitoring with thresholds set after deployment measurements. |
| P2 | Dependency/container vulnerability scanning in CI. |
| P3 | HSTS only after HTTPS is stable (Django checklist guidance). |
| P4 | Partial-outage UX copy for queue_unavailable / submissions_disabled already partially present — extend operations drills. |
| P5 | Separate Redis instances or clear keyspace separation for broker vs cache vs results. |

### LATER PRODUCT WORK

| ID | Finding |
|---|---|
| L1 | Personalized assessment product. |
| L2 | User accounts, authenticated quotas, abuse accounts. |
| L3 | Multi-region HA, autoscaling workers, serverless APIs. |
| L4 | Full observability stack SLOs and paid uptime products (choose later). |
| L5 | Localization beyond English source strings. |

---

## 5. Architecture comparison

### Option A — Single appropriately sized VPS

One host runs: reverse proxy + static frontend + Django API + PostgreSQL + Redis + two Celery workers (`celery` and `buffer_sensitivity`), concurrency 1 each.

| Criterion | Assessment |
|---|---|
| Worker memory | Fits if host has headroom for ~1.2 GiB peak RSS **per** active worker (measured) plus OS/DB/API |
| API memory | Light relative to workers; colocated |
| CPU contention | Real risk if API and workers share saturated CPU during long batches |
| Concurrency | Must remain 1 per queue unless new measurements |
| Long tasks | Supported (Celery workers, not request handlers) |
| Supervision | systemd/docker compose on one box |
| Persistent DB | Local PostgreSQL volume |
| Redis persistence | AOF already used in local compose pattern |
| TLS/domain | Reverse proxy (Caddy/nginx) terminates TLS |
| Logging/monitoring | Centralize on host or ship logs off-box |
| Backups | `pg_dump` + off-host copy |
| Complexity | **Lowest** for a research pilot |
| Failure modes | Single host loss takes all services down |
| Cost structure | One compute bill + backup storage; exact prices **unknown** (not quoted) |

### Option B — Managed/split architecture

Static frontend on object/CDN hosting; managed PostgreSQL; managed Redis; API service; separate worker services.

| Criterion | Assessment |
|---|---|
| Worker memory | Easier to size workers alone to ≥2 GiB class machines |
| API memory | Can stay small |
| CPU contention | Reduced between API and workers |
| Concurrency | Still 1 per worker process |
| Long tasks | Supported only if worker platform allows multi-minute tasks (not typical serverless request limits) |
| Supervision | Platform-native |
| Persistent DB | Managed backups often available (verify per vendor; **unknown** until chosen) |
| Redis | Managed broker; confirm persistence and eviction policy |
| TLS/domain | Platform TLS + possible CORS if frontend and API origins differ |
| Complexity | **Higher** (networking, CORS, multiple deploy pipelines) |
| Failure modes | Partial outages more common; need clearer readiness |
| Cost structure | Multiple metered services; exact prices **unknown** |

**Serverless request handlers are not acceptable for `optimize_allocation` jobs.** Long work stays in Celery workers.

### Recommendation

**Recommend Option A (single appropriately sized VPS) for the limited research pilot**, with:

- same-origin reverse proxy (`https://<domain>/` + `/api/`),
- two dedicated worker processes/queues,
- PostgreSQL + Redis on the same private network namespace,
- off-host encrypted backups.

Rationale: measured jobs are memory-heavy and multi-minute; pilot traffic is throttle-limited; operational simplicity and predictable networking outweigh split-host benefits until personalized-product scale arrives. Revisit Option B when multi-host isolation or managed DB SLA is required.

Minimum memory reasoning (from repo, not vendor SKUs):

- Phase 3B measured peak RSS up to **1192.5 MiB** (~1.17 GiB) on a batch case (`buffer-sensitivity-phase3b.json`, P4_3y case).
- README: allow **≥ 2 GiB RAM** for the batch worker; both workers on one host need **roughly 4 GiB or more free** for simultaneous peaks plus system overhead.
- Therefore a pilot host must provide **well above 4 GiB free** if both workers can be busy together, plus PostgreSQL/Redis/API/OS. Exact commercial instance size is a purchase decision (**unknown** here).

---

## 6. Capacity reasoning (benchmark-derived only)

### 6.1 Measured timings (public-path sequential)

From `docs/product/benchmarks/buffer-sensitivity-phase3b.json`:

| Case | Total batch seconds | Peak RSS MiB | Notable single call |
|---|---:|---:|---|
| P2_3y_ei0.95 | 78.96 | 1164.7 | — |
| P4_3y_ei0.95 | 113.38 | 1192.5 | B=12 ≈ 65.9 s |
| P2_5y_ei1.05 | 211.42 | 1181.5 | B=1 ≈ **125.17 s** |
| P1_5y_ei0.95 | **466.55** | 1138.3 | each B ≈ 116.4–116.7 s |

Single-optimize local fixture (`backend/tests/_optimize_benchmark.json`): P2_3Y ≈ 19.3 s; P4_3Y ≈ 15.0 s (different measurement context; do not overwrite Phase 3B maxima).

### 6.2 Configured worker safety (code defaults)

| Setting | Default |
|---|---|
| Worker concurrency | 1 |
| Prefetch multiplier | 1 |
| Max tasks per child | 1 |
| Optimization soft/hard/lease | 180 / 240 / 300 s |
| Buffer soft/hard/lease | 600 / 720 / 840 s |
| Submit throttles | optimization `3/hour`; buffer `2/hour` (per anon IP via DRF) |

### 6.3 What can be claimed

**Assumptions (explicit):** one optimization worker and one buffer worker; concurrency 1; no overlapping tasks inside a worker; Phase 3B durations apply until re-measured.

**Derived upper bounds (not a supported user count):**

- Longest measured batch ≈ 467 s ⇒ one buffer worker can finish **at most about 7** such worst-case batches per hour if continuously busy.
- Default buffer submit throttle `2/hour` per IP is stricter than that physical ceiling for a single client IP.
- When both queues are busy, new work waits in Redis; API still accepts POSTs until throttle/freeze/broker failure paths trigger.
- **Do not claim** “supports N concurrent users.” Concurrent browsers can still poll; compute throughput is ~1 job per queue at a time.

### 6.4 Busy-queue behavior

1. Ordinary and batch queues do not starve each other (dedicated queues).
2. Clients poll; jobs remain `queued`/`running` with leases.
3. Broker publish failure → HTTP 503 `queue_unavailable` (implemented).
4. Buffer POSTs can be frozen without removing GET (implemented).
5. Optimization POSTs currently **cannot** be frozen by an equivalent env flag (**R6**).

---

## 7. Security and privacy (summary)

Full matrices live in `pilot-deployment-architecture.md` and the operations runbook.

**Launch blockers:** DEBUG/secret/hosts, shared throttling, TLS, admin lock, PostgreSQL, packaging, re-benchmark, retention decision, research positioning.

**Privacy:** scenario inputs are stored server-side in job JSON for fingerprint reuse and result delivery. No accounts, but capability UUID URLs grant read access to anyone who has the link. Recommend retention with automatic deletion (**product decision required**). Disable third-party analytics for pilot unless a privacy-preserving choice is approved.

---

## 8. Go/no-go decision

| Option | Result |
|---|---|
| `GO` | **Rejected** — local tests and Phase 3 features do not equal production readiness |
| `NO-GO` | **Rejected** — core async research pilot is architecturally viable after hardening |
| **`GO WITH REQUIRED CHANGES`** | **Selected** |

**Gate for later `GO`:** all BLOCKER items closed, REQUIRED BEFORE PUBLIC PILOT items closed or explicitly accepted in writing by the owner, deployment-host benchmarks recorded, and pilot checklist completed (`pilot-go-live-checklist.md`).

---

## 9. Deployment vs later personalized-product work

| Belongs to deployment / research pilot | Belongs to later personalized product |
|---|---|
| PostgreSQL, Redis throttle cache, TLS, VPS compose/images | Accounts, personalization, bank links |
| Worker sizing, queue ops, freezes, backups | Elastic multi-tenant quotas |
| Research-pilot copy / disclosure | Fully personalized diagnostic UX |
| Same-origin API routing | Possibly multi-region APIs |
| Retention for anonymous scenario jobs | User-driven data export/erasure workflows at account level |

---

## 10. Related Phase 4A documents

- [`pilot-deployment-architecture.md`](./pilot-deployment-architecture.md)
- [`pilot-operations-runbook.md`](./pilot-operations-runbook.md)
- [`pilot-go-live-checklist.md`](./pilot-go-live-checklist.md)

---

## 11. Official external sources consulted

| Source | URL | Accessed |
|---|---|---|
| Django 4.2 deployment checklist | https://docs.djangoproject.com/en/4.2/howto/deployment/checklist/ (also mirrored at django.readthedocs.io) | 2026-09-14 |
| Django cache framework (RedisCache) | https://docs.djangoproject.com/en/4.2/topics/cache/ (current docs also describe Redis) | 2026-09-14 |
| Django REST framework throttling | https://www.django-rest-framework.org/api-guide/throttling/ | 2026-09-14 |

Hosting vendor instance prices and limits were **not** asserted; treat as **unknown** until a provider is chosen and its official docs are recorded.
