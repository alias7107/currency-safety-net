# Operations

Use the Compose configuration described in [deployment](../../deploy/README.md).
PostgreSQL is the source of truth for jobs and results. Redis holds queued work,
task backend data and the shared throttle cache.

## Release and health checks

Build images, back up the database, apply migrations and restart the relevant
services. Preserve persistent volumes and the previous release's images.
Check TLS, `/api/v1/health/`, `/api/v1/ready/`, model options and a cached result.
Test a fresh job deliberately when the deployment change affects execution.

Workers need a Celery health check. Their containers do not serve HTTP on port 8000. Inspect actual task completion as well as worker ping responses.

## Monitoring

Watch API errors and latency, queue lengths, computation and waiting times,
worker memory, restarts and OOM events. Also track PostgreSQL/Redis disk use,
backup age and certificate renewal. Choose alert thresholds from measurements
on the deployment host rather than copying laptop timings.

A worker crash before the database claim can cause repeated message redelivery
without increasing the job's attempt counter. Detect repeated worker-child
failures and stop the affected worker while investigating; a claim-level
attempt limit alone does not bound that case.

## Submission controls

| Setting set to `False`                   | New work paused              |
| ---------------------------------------- | ---------------------------- |
| `OPTIMIZATION_SUBMISSIONS_ENABLED`       | Research allocation jobs     |
| `BUFFER_SENSITIVITY_SUBMISSIONS_ENABLED` | Four-buffer research batches |
| `HOUSEHOLD_ANALYSIS_SUBMISSIONS_ENABLED` | Personal simulations         |

Restart/recreate the API with updated environment settings for a switch change
to take effect. Existing job GET requests remain available. Changing a switch
does not itself cancel tasks already queued or running.

## Retention

`JOB_RETENTION_DAYS` defaults to seven. The management command
`cleanup_expired_jobs` deletes only expired terminal jobs across all three job
types, leaving queued and running jobs alone. First use `--dry-run` to inspect
the counts, then schedule the command daily and monitor its completion.

The command output includes optimization, buffer sensitivity and household
analysis counts. The repository does not install a scheduler, so a retention
setting is not a guaranteed deletion deadline. Browser draft deletion does not
delete server-side results.

## Backups

Take a PostgreSQL `pg_dump` daily and before schema changes. Store encrypted
copies off-host with a retention policy. Keep deployment configuration and
secrets in appropriate separate backups. Redis persistence does not replace
a PostgreSQL backup.

Restore a backup into an isolated database, apply the matching application
version, and verify row counts and representative result reads. Do not test
restoration by overwriting the live database. Retest this procedure periodically.

## Incidents and recovery

Pause new submissions when the queue is growing without completion, workers
repeatedly crash, or database integrity is uncertain. Preserve relevant logs
without exporting payloads or secrets. Check task and lease ownership before
recovery; do not manually change result payloads or delete broker data as a
routine troubleshooting step.

Restart workers with concurrency one and watch claim/redelivery behavior.
Validate recovery using the real PostgreSQL and Redis setup. For an application
rollback, use the previous images with a compatible schema and verify cached
reads before enabling submissions. Prefer a forward migration fix; test any
database restoration in a separate environment first.

## Personal simulations

The personal submission switch defaults to disabled. Before enabling it,
benchmark difficult custom cases on the host, including five-year horizons
and broad near-optimal surfaces. Review the configured 180/240/300-second
soft/hard/lease defaults against those measurements. Verify concurrent duplicate
submissions, worker loss/recovery and cleanup before relying on the service.

Job URLs provide access to stored results without an account. Noindex headers
are not access control. Keep production admin disabled unless it is explicitly
needed and protected. Do not expose PostgreSQL or Redis ports to the internet.
