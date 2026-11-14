# Low-resource deployment

The `pilot` profile runs one Celery worker on both the `celery` and
`buffer_sensitivity` queues. Tasks run sequentially, so a long batch can delay
an ordinary or personal calculation. Gunicorn runs one process with two threads.

This configuration targets a lightly used host with about 4 GB RAM and two
vCPUs. It does not reduce simulation paths, change the allocation grid or
relax result validation. The `full` profile instead uses two separate workers
and starts from an 8 GB host. Actual capacity depends on the workload and CPU.

Use the commands in [deployment](../../deploy/README.md) with both Compose
files and `--profile pilot`. Never also enable `--profile full`.

## Capacity checks

Measure these on the intended deployment host before enabling the relevant
submission type:

1. Idle memory, service readiness and ordinary page/API latency.
2. A single uncached research calculation, then its cached repeat.
3. A four-buffer batch, including total wall time and peak worker memory.
4. Personal cases with long horizons, high expense ratios and broad or flat
   optimization surfaces, if personal submissions will be enabled.
5. API responsiveness while the worker is busy, queue delay, worker restarts,
   swap use and OOM events.

Separate queue waiting time from computation time. Compare measurements with
each task's actual soft limit, hard limit and lease. A responsive liveness
endpoint is not evidence that the worker has enough time or memory.

The benchmark script in `scripts/benchmarks/` records reproducible research
cases. Its output is host-specific and belongs under ignored `artifacts/`.
It does not substitute for a real personal-API or browser integration test.

## Operating the pilot

Keep worker concurrency and prefetch at one. Avoid building images or running
other expensive tasks alongside measurements. Swap can reduce abrupt memory
failure but is not a substitute for sufficient RAM or CPU capacity.

If task limits are exceeded, investigate the workload and adjust capacity or
review the task-specific limits together with their leases. Do not reduce
scientific precision to make a benchmark pass. Submission switches can pause
new work while existing results remain available.

Precomputing a demonstration scenario can make a later identical request
return from cache, but does not establish uncached performance or capacity.
Keep normal throttles and record whether a measurement was cached.

Before switching to the full profile, let active work finish, stop the pilot
worker, and start the separate workers. Keep the same persistent database,
Redis and Caddy volumes. See the [operations runbook](pilot-operations-runbook.md)
for retention, monitoring and recovery.
