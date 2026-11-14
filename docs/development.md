# Local development

Use Node.js from `.node-version` and the pinned Python dependencies in
`backend/requirements.txt`. The backend Dockerfile specifies the deployment
Python runtime; Python 3.11 is suitable for a matching local environment.

## Backend setup

From the repository root:

```bash
python3.11 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
cp .env.example .env
```

Review `.env` before starting services. Local development uses SQLite when
`DEBUG=True` and `DATABASE_URL` is empty. Set
`HOUSEHOLD_ANALYSIS_SUBMISSIONS_ENABLED=True` to try personal simulations
locally; it is disabled by default. Research and buffer jobs have separate
submission switches.

Start Redis:

```bash
docker compose up -d redis
```

An existing Redis instance also works. Configure `CELERY_BROKER_URL` and
`CELERY_RESULT_BACKEND` to match its address.

In a backend terminal:

```bash
cd backend
source .venv/bin/activate
python manage.py migrate
python manage.py runserver 127.0.0.1:8000
```

In another backend terminal, using the same virtual environment:

```bash
celery -A project worker --loglevel=INFO \
  --queues=celery,buffer_sensitivity --concurrency=1 \
  --prefetch-multiplier=1 --max-tasks-per-child=1
```

On macOS, an Objective-C fork-safety crash in the worker can be avoided by
prefixing that local worker command with
`OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES`. This workaround is not needed in
the Linux deployment. Keep `CELERY_TASK_ALWAYS_EAGER=False` when checking the
real asynchronous flow.

## Frontend

Using the Node version in `.node-version`:

```bash
cd frontend
npm ci
npm start
```

Open `http://localhost:4200`. The development proxy forwards `/api` to
`http://127.0.0.1:8000`. Stop the foreground services with Ctrl+C after active
calculations finish.

## Tests

Run the backend tests from `backend/` with the virtual environment active:

```bash
pytest -m "not slow"
python manage.py check
python manage.py makemigrations --check --dry-run
```

`pytest` without the marker filter also runs the expensive optimizer regression
tests. They verify the research reference cases and can take several minutes.
The fast suite includes synthetic numerical checks and mocked job execution;
it does not replace a real PostgreSQL/Redis/Celery integration check.

From `frontend/`:

```bash
npm test -- --watch=false
npm run build
```

Reusable tools live in `scripts/verification/` and `scripts/benchmarks/`.
Read each tool's `--help` or module documentation before running it: API checks
can submit real jobs and the batch benchmark performs expensive optimizations.
Save generated measurements under the ignored `artifacts/` directory, not in
the source documentation.
