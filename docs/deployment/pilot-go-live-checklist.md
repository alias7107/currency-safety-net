# Pilot Go-Live Checklist

**Phases:** 4A design + 4B packaging  
**Decision context:** [`phase4a-production-pilot-readiness.md`](./phase4a-production-pilot-readiness.md)

Use this list before connecting a real domain to a public research pilot. Check items only when evidence exists. Do not invent completions.

**Phase 4B note:** Code/packaging items marked *(repo)* are implemented in the repository; host/DNS items remain open.

---

## A. Blockers (must be closed)

- [x] PostgreSQL configured as production database (SQLite not used) *(repo settings; host migrate pending)*
- [x] Database dependency (`psycopg`) packaged *(repo)* — migrations applied on PostgreSQL *(host pending)*
- [x] Shared Redis-backed Django cache used by DRF throttles *(repo when DEBUG=False)*
- [x] Reproducible production artifacts *(repo `deploy/`)*
- [x] TLS reverse proxy design implemented *(repo Caddyfile)* — live cert/DNS *(host pending)*
- [ ] Deployment-host benchmark recorded for wall time + peak RSS
- [x] Worker concurrency remains **1** / prefetch **1** / max-tasks-per-child **1** *(compose)*
- [x] Separate production workers for `celery` and `buffer_sensitivity` queues *(compose)*

---

## B. Infrastructure

- [ ] Single pilot VPS (or approved alternate) sized with **≥ ~4 GiB free** for simultaneous worker peaks plus OS/DB/API headroom (per README guidance + measured ~1.2 GiB RSS)
- [ ] If using **low-resource 4 GB profile**: host swap 2–4 GB as emergency only; Phase 4C benchmark must show no sustained swap
- [ ] If using **full ≥8 GB profile**: dedicated `worker_opt` + `worker_buffer` (never with `worker_pilot`)
- [ ] PostgreSQL data volume persistent; backup schedule configured
- [ ] Redis bound to private/localhost; AOF or approved persistence policy
- [ ] Startup order documented and rehearsed (DB → Redis → API → workers → proxy)
- [ ] Off-host backup destination configured and restore drill scheduled
- [ ] External uptime check on frontend and `/api/v1/health/`
- [ ] Disk monitoring for PostgreSQL and Redis

---

## C. Security

- [ ] `DEBUG=False`
- [ ] Production `DJANGO_SECRET_KEY` (not development fallback)
- [ ] Exact `ALLOWED_HOSTS` for canonical host(s) only
- [ ] Same-origin `/api/` **or** exact `CORS_ALLOWED_ORIGINS` if API subdomain
- [ ] `CELERY_TASK_ALWAYS_EAGER=False`
- [ ] HTTPS redirect + secure proxy headers only if proxy is correctly configured
- [ ] `SESSION_COOKIE_SECURE` / `CSRF_COOKIE_SECURE` when sessions/admin used
- [ ] Django admin disabled or strongly restricted (VPN/IP + HTTPS)
- [ ] PostgreSQL and Redis not reachable from the public internet
- [ ] Rate limits verified across multiple API processes (shared throttle keys)
- [ ] `robots`/noindex (or equivalent) for `/results/` and `/buffer-sensitivity/` capability URLs
- [ ] Log redaction verified (no full financial `request_payload` in INFO logs)
- [ ] Dependency/container scan performed; critical issues triaged
- [ ] `manage.py check --deploy` reviewed (Django deployment checklist)

---

## D. Privacy

- [x] Owner-approved retention period for job rows *(approved: 7 days)*
- [x] Deletion mechanism implemented *(repo: `cleanup_expired_jobs`)*
- [ ] Public disclosure text for what is stored, why, and how long
- [ ] sessionStorage comparison/report behavior understood (browser-local)
- [x] Third-party analytics disabled for initial pilot *(approved)*
- [ ] Backup retention vs job deletion interaction documented

---

## E. Application / product verification

- [x] Pilot framed as **research scenario tool** (P1–P4), not personalized financial advice
- [x] “Check my resilience” / “Assessment” wording addressed *(repo: Explore the research model / Research calculator)*
- [ ] Landing + research pages reviewed for overclaim
- [ ] Metadata + options endpoints OK
- [ ] One ordinary optimization job succeeds on deployment hardware
- [ ] Cached repeat POST returns cached success
- [ ] One buffer-sensitivity job succeeds; buffers exactly `[1,3,6,12]`
- [ ] Polling and terminal states correct
- [ ] Report + comparison paths OK
- [ ] Safe user-facing errors (no stack traces / HTML upstream leakage)
- [ ] Mobile viewport smoke OK
- [ ] `BUFFER_SENSITIVITY_SUBMISSIONS_ENABLED` freeze tested
- [x] Optimization submission freeze available *(repo: `OPTIMIZATION_SUBMISSIONS_ENABLED`)*
- [ ] Broker-down behavior returns safe `queue_unavailable`
- [ ] Worker restart / lease recovery rehearsed
- [ ] **Low-resource mode:** Phase 4C host benchmark in `low-resource-pilot-profile.md` passed (or upgraded to 8 GB full profile)
- [ ] Confirmed only one Celery worker when using `--profile pilot`

---

## F. Post-launch monitoring

- [ ] Queue depth dashboards for `celery` and `buffer_sensitivity`
- [ ] Worker RSS monitoring with headroom relative to measured peaks
- [ ] API 5xx / 429 / 503 alerts (thresholds set from deployment data)
- [ ] Backup success alerts
- [ ] Certificate expiry alerts
- [ ] On-call / owner contact path defined
- [ ] Incident freeze + rollback steps linked from this checklist (`pilot-operations-runbook.md`)

---

## G. Explicit non-goals for this pilot

- [ ] Confirmed: personalized assessment is **out of scope**
- [ ] Confirmed: no serverless execution of optimization jobs
- [ ] Confirmed: no concurrency > 1 without new measurements
- [ ] Confirmed: no scientific changes to seeds, paths, or `research_engine` to “fit” hosting

---

## Sign-off

| Role | Name | Date | Decision |
|---|---|---|---|
| Product owner | | | Approve retention + public positioning |
| Technical operator | | | Infra/security blockers closed |
| Research steward | | | Pilot remains scientifically framed |

**Final launch gate:** all section A items checked; sections B–E complete or waived in writing; section F armed before DNS cutover.
