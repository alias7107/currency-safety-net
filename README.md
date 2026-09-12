"""
Currency Safety Net
===================

Research-based currency allocation scenario engine exposed through an
asynchronous Django API. Household FX shortfall risk is evaluated with the
verified Monte Carlo / CVaR optimizer copied from the academic research
project into `backend/research_engine`.

This repository currently ships:

- `backend/research_engine` — verified calculation package
- `backend/calculations` — Django REST API + Celery job orchestration
- `frontend/` — Angular 22 client (scenario calculator MVP)
- `.node-version` — Node.js 24 pin for the frontend toolchain

Outputs are **research-based scenario results**. They are **not** real-time
exchange-rate forecasts and **not** individualized financial advice.

Architecture
------------

```
Angular (localhost:4200)  →  Django API  →  Redis broker  →  Celery worker
                                      ↘ SQLite (local only)
Celery worker calls: from research_engine import optimize_allocation
```

The HTTP process never runs the optimizer. Jobs are queued, executed by a
single memory-aware worker, and polled by job id.

Model assumptions (verified)
----------------------------

| Item | Value |
|---|---|
| Data as-of | 2025-12-31 |
| Baseline FX window | 2015-08-20 → 2025-12-31 |
| Simulation paths | 10,000 |
| Random seed | 42 |
| Primary DGP | Joint stationary bootstrap SB20 |
| Peak worker memory (approx.) | ~900 MB for path generation + optimize |

Local setup
-----------

Python 3.9.6 is required to match the verified research stack.

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example ../.env
```

Start Redis (compose file contains Redis only; bound to `127.0.0.1`):

```bash
# from repository root
docker compose up -d redis
```

If Docker is unavailable on macOS:

```bash
brew install redis
brew services start redis
```

Local multi-process verification
--------------------------------

The local async path has been verified end-to-end with:

- Django HTTP process
- Redis broker (`PONG`)
- Separate Celery worker (one node online)
- `CELERY_TASK_ALWAYS_EAGER=False`

Observed behavior: initial POST returned `202` with `queued` and
`cached=false`; the worker completed the job; a repeated identical POST
returned `succeeded` with `cached=true`. The completed P2 / 3-year result
matched the canonical regression values (`weights = [1.0, 0.0, 0.0]`,
`CVaR95 = 1.1871802686857733`, `P(shortfall) = 0.0491`, surface
`1326 / 199 / 1473`).

Unit tests still mock the broker; they are not a substitute for this check.
If Redis is unavailable locally, install it before repeating the flow.

Apply migrations:

```bash
cd backend
source .venv/bin/activate
python manage.py migrate
```

Run the API:

```bash
python manage.py runserver
```

Run Celery workers (required for real optimizations):

Ordinary optimization queue (default):

```bash
celery -A project worker --loglevel=INFO --hostname=opt@%h \
  --queues=celery --concurrency=1 --prefetch-multiplier=1 --max-tasks-per-child=1
```

Dedicated buffer-sensitivity queue (production design):

```bash
celery -A project worker --loglevel=INFO --hostname=buffer@%h \
  --queues=buffer_sensitivity --concurrency=1 --prefetch-multiplier=1 --max-tasks-per-child=1
```

Allow **≥ 2 GiB RAM** for the batch worker. Running both workers on one host
needs roughly **4 GiB or more** free for simultaneous peaks plus system
overhead. Local development may temporarily consume both queues on one worker
only as an explicit convenience:

```bash
celery -A project worker --loglevel=INFO --concurrency=1 \
  --prefetch-multiplier=1 --max-tasks-per-child=1 \
  --queues=celery,buffer_sensitivity
```

Production documentation and operations must keep queue separation.

API endpoints
-------------

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/health/` | Liveness (does not load FX data) |
| GET | `/api/v1/model/metadata/` | Safe model metadata |
| GET | `/api/v1/model/options/` | Documented request choices |
| POST | `/api/v1/optimization-jobs/` | Queue or reuse an optimization job |
| GET | `/api/v1/optimization-jobs/<uuid>/` | Poll job status / result |
| POST | `/api/v1/buffer-sensitivity-jobs/` | Queue or reuse a four-buffer batch job |
| GET | `/api/v1/buffer-sensitivity-jobs/<uuid>/` | Poll batch status / result |

Example (single optimization):

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/optimization-jobs/ \
  -H 'Content-Type: application/json' \
  -d '{"profile":"P2","horizon_years":3,"expense_income_ratio":0.95,"buffer_months":1,"rebalance_frequency":"monthly","conversion_cost":0.0}'
```

Example (buffer sensitivity batch — server always evaluates `[1,3,6,12]`):

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/buffer-sensitivity-jobs/ \
  -H 'Content-Type: application/json' \
  -d '{"profile":"P2","horizon_years":3,"expense_income_ratio":0.95,"rebalance_frequency":"monthly","conversion_cost":0.0}'
```

Clients must not send `n_paths`, `seed`, `_fx_bundle`, `model_version`, or
dataset paths. Those values are fixed by the verified model. Batch POSTs must
not send `buffer_months`, buffer lists, or diagnostic targets.
`BUFFER_SENSITIVITY_SUBMISSIONS_ENABLED=False` disables new batch POSTs while
keeping GET of existing jobs available.

Frontend (Angular MVP)
----------------------

Requirements:

- Node.js **24** (see root `.node-version`; Angular 22 supports
  `^22.22.3 || ^24.15.0 || ^26.0.0`)
- npm (bundled with Node)
- Angular 22 standalone application in `frontend/`

Install and start the development server (API calls are proxied):

```bash
cd frontend
npm install
npm start
# equivalent: npx ng serve --proxy-config proxy.conf.json
```

`frontend/proxy.conf.json` forwards `/api` to `http://127.0.0.1:8000`.
The UI always calls relative URLs under `/api/v1` — never hard-code a
production hostname in components.

| Command | Purpose |
|---|---|
| `npm start` | Dev server on `http://localhost:4200` with API proxy |
| `npm test -- --watch=false` | Unit tests (Vitest; HTTP mocked) |
| `npm run build` | Production build to `frontend/dist/` |

Routes:

| Path | Page |
|---|---|
| `/` | Landing |
| `/calculator` | Guided scenario calculator |
| `/results/:jobId` | Processing / completed scenario result |
| `/methodology` | Methodology and limitations |

Local full-stack startup order:

1. Start Redis (`docker compose up -d redis` or `brew services start redis`)
2. Apply migrations and run Django (`python manage.py runserver`)
3. Start the Celery worker (`celery -A project worker ...`)
4. Start Angular (`cd frontend && npm start`)
5. Open `http://localhost:4200`

Design and accessibility notes:

- Calm consumer-finance visual system using CSS custom properties in
  `frontend/src/styles/_tokens.scss` (no remote fonts or stock images)
- English copy is centralised in `frontend/src/app/core/i18n/en.ts` for
  later RU/KK localization
- Results language describes **model allocations** and **modeled shortfall
  risk** — never forecasts, advice, or guaranteed outcomes
- Keyboard navigation, visible focus, 44 px targets, `aria-live` for
  processing/errors, and `prefers-reduced-motion` are required behaviours

Tests
-----

Backend:

```bash
cd backend
source .venv/bin/activate

# Fast API + unit suite (no full 10k-path optimization)
CELERY_TASK_ALWAYS_EAGER=True pytest -m "not slow"

# Including verified P2/P4 engine regression gates (~30+ seconds)
CELERY_TASK_ALWAYS_EAGER=True pytest
```

Frontend:

```bash
cd frontend
npm test -- --watch=false
```

Environment
-----------

See `.env.example`. Important variables:

- `DJANGO_SECRET_KEY` — development fallback is marked development-only; startup
  fails if `DEBUG=False` still uses that fallback
- `CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND` — Redis URLs on localhost
- `CORS_ALLOWED_ORIGINS` — defaults to `http://localhost:4200`
- `CELERY_TASK_ALWAYS_EAGER` — set `True` in tests only
- `DRF_OPTIMIZATION_SUBMIT_THROTTLE` — default `3/hour` (memory-heavy POSTs)
- `DRF_BUFFER_SENSITIVITY_SUBMIT_THROTTLE` — default `2/hour` (separate from optimization)
- `DRF_JOB_POLL_THROTTLE` — default `120/min` (shared poll scope; does not consume submit quotas)
- `DRF_MODEL_METADATA_THROTTLE` — default `60/min`
- `OPTIMIZATION_MAX_ATTEMPTS` — default `2`
- `OPTIMIZATION_TASK_SOFT_TIME_LIMIT` / `OPTIMIZATION_TASK_TIME_LIMIT` — defaults `180` / `240`
- `OPTIMIZATION_LEASE_SECONDS` — default `300` (≥ hard + 60s margin)
- `BUFFER_SENSITIVITY_TASK_SOFT_TIME_LIMIT` / `BUFFER_SENSITIVITY_TASK_TIME_LIMIT` — defaults `600` / `720`
- `BUFFER_SENSITIVITY_LEASE_SECONDS` — default `840` (≥ hard + 120s margin)
- `BUFFER_SENSITIVITY_SUBMISSIONS_ENABLED` — default `True` in development; set `False` in
  production to freeze new batch submissions without removing GET access
- Global `CELERY_TASK_SOFT_TIME_LIMIT` / `CELERY_TASK_TIME_LIMIT` remain `120` / `180` for
  unrelated tasks; optimization and batch tasks use task-specific annotations

Job lifecycle notes
-------------------

- Deterministic requests share one `request_fingerprint` row (unique).
- Succeeded jobs return a cached result; failed jobs may be reset and retried
  until `OPTIMIZATION_MAX_ATTEMPTS`.
- Workers claim jobs with Celery task identity + lease expiry so lost workers
  do not leave jobs permanently `running`.
- Broker redeliveries (`delivery_info.redelivered`) increment `attempt_count`
  and cannot bypass the attempt limit.
- Completion writes succeed only while the completing task still owns the
  `running` row; stale workers discard their result instead of overwriting.
- Broker publication failure returns HTTP `503` with error code
  `queue_unavailable` and leaves a failed row that can be retried later.
  HTTP publish retries are disabled (`CELERY_TASK_PUBLISH_RETRY=False`).

Scope notes
-----------

- SQLite is for local development only.
- Authentication is not implemented yet.
- DRF throttling is in-memory and **development-only**; production should use
  Redis-backed throttling after deployment architecture is finalized.
- Scientific formulas, seeds, path counts, and optimization constraints in
  `research_engine` must not be altered to make products “easier”.
