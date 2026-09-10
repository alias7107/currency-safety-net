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
- `frontend/` — placeholder for a future Angular client

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

Run the Celery worker (required for real optimizations):

```bash
celery -A project worker --loglevel=INFO --concurrency=1 --prefetch-multiplier=1 --max-tasks-per-child=1
```

API endpoints
-------------

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/health/` | Liveness (does not load FX data) |
| GET | `/api/v1/model/metadata/` | Safe model metadata |
| GET | `/api/v1/model/options/` | Documented request choices |
| POST | `/api/v1/optimization-jobs/` | Queue or reuse an optimization job |
| GET | `/api/v1/optimization-jobs/<uuid>/` | Poll job status / result |

Example:

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/optimization-jobs/ \
  -H 'Content-Type: application/json' \
  -d '{"profile":"P2","horizon_years":3,"expense_income_ratio":0.95,"buffer_months":1,"rebalance_frequency":"monthly","conversion_cost":0.0}'
```

Clients must not send `n_paths`, `seed`, `_fx_bundle`, `model_version`, or
dataset paths. Those values are fixed by the verified model.

Tests
-----

```bash
cd backend
source .venv/bin/activate

# Fast API + unit suite (no full 10k-path optimization)
CELERY_TASK_ALWAYS_EAGER=True pytest -m "not slow"

# Including verified P2/P4 engine regression gates (~30+ seconds)
CELERY_TASK_ALWAYS_EAGER=True pytest
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
- `DRF_JOB_POLL_THROTTLE` — default `120/min`
- `DRF_MODEL_METADATA_THROTTLE` — default `60/min`
- `OPTIMIZATION_MAX_ATTEMPTS` — default `2`
- `OPTIMIZATION_LEASE_SECONDS` — default `240` (must exceed `CELERY_TASK_TIME_LIMIT`
  of `180` by at least a 30-second safety margin)

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
- The Angular frontend is not built in this phase.
- Scientific formulas, seeds, path counts, and optimization constraints in
  `research_engine` must not be altered to make products “easier”.
