# Buffer sensitivity API

The research explorer compares initial reserves covering 1, 3, 6 and 12 months
of essential expenses. Each row optimizes currency allocation under the same
research scenario and deterministic simulation specification.

## Requests

```http
POST /api/v1/buffer-sensitivity-jobs/
GET /api/v1/buffer-sensitivity-jobs/<uuid>/
```

POST accepts `profile`, `horizon_years`, `expense_income_ratio`,
`rebalance_frequency` and `conversion_cost`. The server fixes the tested
buffers. Clients do not supply buffer lists, target thresholds, path counts,
seeds or provenance. Validation is defined in `calculations/serializers.py`.

New or active jobs return 202; an existing successful result returns 200 with
`cached: true`. Validation failures return 400, throttling returns 429 and
disabled submissions or queue publication failures return 503. A broker failure
retains a failed job row for the retry lifecycle.

## Results

`buffer_sensitivity_batch_v1` contains:

- `contract_version` and `presentation_version`;
- `tested_buffers`, exactly `[1, 3, 6, 12]`;
- one echoed `scenario` and shared `provenance`;
- normalized `units`;
- four ascending `results` rows with weights, CVaR95, VaR95, shortfall
  probability, identification and grid/near-optimal counts.

Additional reserve and mean-shortfall diagnostics are nested under
`implementation_only`. Shortfall amounts use units of initial monthly income.
The precise schema and validation rules are in `calculations/batch_contract.py`;
the frontend mirrors them in `core/api/buffer-sensitivity.validation.ts`.

## Execution and integrity

`BufferSensitivityJob` uses the shared claim/lease lifecycle. Publication
occurs after the transaction commits. The task makes four sequential public
`optimize_allocation` calls, with deterministic regeneration for each call.
Production does not inject a private shared FX bundle.

The fingerprint includes scenario and authoritative provenance. The worker
checks the stored snapshot against live model/data configuration, verifies
each response and stores all four rows atomically. Invalid, incomplete or
inconsistent results are rejected; stale workers cannot overwrite a newer claim.

The `buffer_sensitivity` queue is consumed by the dedicated full-profile worker
or the combined pilot worker. Defaults are soft/hard limits of 600/720 seconds,
an 840-second lease and a separate `2/hour` submission throttle. These values
require measurement on deployment hardware. Setting
`BUFFER_SENSITIVITY_SUBMISSIONS_ENABLED=False` blocks new POSTs while retaining GET.

## Target finder

The frontend chooses the first ascending tested buffer whose selected metric
is less than or equal to the user's threshold. It can use shortfall probability
or CVaR95. It does not interpolate, alter the batch request or recommend a
financially optimal buffer. The target is not part of the calculation fingerprint.

## Verification

`backend/tests/test_api_buffer_sensitivity_jobs.py` covers the contract and
job lifecycle. The reusable capacity tool is
`scripts/benchmarks/buffer_sensitivity_batch_probe.py`; it writes generated
measurements to `artifacts/` by default. Run expensive benchmarks deliberately
on the intended host rather than treating local measurements as deployment limits.

See [model methodology](resilience-and-buffer-methodology.md) and
[deployment](../../deploy/README.md).
