# Personal simulation API

The household questionnaire at `/assessment` produces an arithmetic overview
in the browser. An explicit submission can also compare the current reserve
allocation with the model-selected grid allocation. Personal jobs use their
own API and are not mapped to research profiles P1–P4.

The browser values each currency amount in KZT using the entered exchange
rates, then derives currency shares, the expense-to-income ratio and reserve
coverage. Raw amounts, rates, rate date and planned contributions are not part
of the simulation request. The server stores the normalized request and result.

The submission switch defaults to disabled. Deployment availability is a
runtime configuration choice, not a claim made by this document.

## 1. Endpoints

```http
POST /api/v1/household-analysis-jobs/
GET  /api/v1/household-analysis-jobs/<uuid>/
```

### Request (exact keys, all required)

```json
{
  "contract_version": "household_analysis_v1",
  "income_shares": [0.3, 0.6, 0.1],
  "expense_shares": [0.8, 0.0, 0.2],
  "current_reserve_weights": [0.25, 0.5, 0.25],
  "expense_income_ratio": 0.95,
  "buffer_months": 3.0,
  "horizon_years": 3,
  "rebalance_frequency": "monthly",
  "conversion_cost": 0.0025
}
```

`current_reserve_weights` is `null` only when `buffer_months` is `0`; that combination returns 422 `no_current_reserve`. The values above are an arbitrary example, not model output.

### Responses

| Case                                                    | HTTP | Body                                                                                                                |
| ------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------- |
| New job, or same fingerprint already queued/running     | 202  | `{job_id, status, cached:false, status_url, contract_version}`                                                      |
| Cached success                                          | 200  | `{..., status:"succeeded", cached:true, result}`                                                                    |
| Validation error (envelope, types, reserve consistency) | 400  | `{error:{code:"validation_error", message, details}}`                                                               |
| Unsupported scenario                                    | 422  | `{error:{code:"unsupported_scenario", message, reasons:[{code, field, supported:{min,max}}]}}`                      |
| Throttled                                               | 429  | DRF throttle response                                                                                               |
| Submissions disabled (default)                          | 503  | `{error:{code:"submissions_disabled", message}}`                                                                    |
| Provenance cannot be verified                           | 503  | `{error:{code:"provenance_unavailable", message}}` (no job)                                                         |
| Broker unavailable                                      | 503  | `{job_id, status:"failed", cached:false, status_url, contract_version, error:{code:"queue_unavailable", message}}`  |
| GET existing job                                        | 200  | `{job_id, status, created_at, started_at, contract_version[, completed_at][, result \| error_code, error_message]}` |
| GET unknown id                                          | 404  | `{error:{code:"not_found", message}}`                                                                               |

Failure codes stored on jobs: `provenance_changed`, `result_validation_failed`, `soft_time_limit`, `analysis_failed`, `max_attempts_exceeded`, `queue_unavailable`. Messages are fixed safe text.

### Result structure

The following schema describes the result fields. Numerical outputs are computed by the engine.

```text
{
  contract_version: "household_analysis_v1",
  engine_interface_version: "personal_analysis_engine_v1",
  units: {cumulative_shortfall, terminal_wealth: "months_of_initial_monthly_income_I0_equals_1"},
  scenario: <exact echo of the accepted normalized request, without contract_version>,
  provenance: {model_version, data_as_of, dataset_sha256, simulation_paths: 10000,
               simulation_seed: 42, canonical_optimization_specification,
               fx_path_policy: "single_bundle_shared_by_both_policies"},
  current_policy:   {label: "current_mix_under_selected_rebalancing", weights,
                     objective{cvar95_cumulative_shortfall},
                     diagnostics{shortfall_probability, var95_cumulative_shortfall},
                     implementation_only{mean_cumulative_shortfall, wealth_depletion_probability,
                                         mean/median/p05/p95_terminal_wealth}},
  optimized_policy: {label: "lowest_cvar95_found_on_evaluated_grid", weights, objective,
                     diagnostics, implementation_only,
                     identification{applies_to: "optimization_surface", identification_class,
                                    n_coarse, n_refined, n_surface,
                                    near_optimal_1pct_count, near_optimal_1pct_frac}},
  comparison: {objective: "cvar95_cumulative_shortfall", direction: "lower_is_better",
               cvar95_optimized_minus_current, outcome, tie_absolute_tolerance: 1e-8,
               includes_initial_switching_cost: false}
}
```

---

## 2. Validation and eligibility (as implemented)

Parsing lives in `calculations/household_contract.py::parse_household_request` and runs in contract order:

1. **Envelope:** a JSON object with exact keys. Unknown keys, forbidden keys (`profile`, `weights`, `n_paths`, `seed`, `_fx_bundle`, `provenance`, …) and missing keys give 400.
2. **Types (400):**
   - non-boolean finite JSON numbers only, with `-0.0` changed to `0.0`; integers too large to convert to a float (for example `10**400`) are rejected rather than raising;
   - vectors of exactly 3 non-negative entries whose sum `(v0 + v1) + v2` is within 1e-12 of 1;
   - values preserved exactly, with no renormalization or snapping;
   - `horizon_years` must be an `int` in {1, 3, 5};
   - `rebalance_frequency` must be an exact match;
   - `expense_income_ratio` must be > 0; `buffer_months` and `conversion_cost` must be ≥ 0.
3. **Reserve consistency (400):** a positive buffer with `null` weights gives `current_reserve_weights_required`; a zero buffer with a vector gives `reserve_weights_without_reserve`.
4. **Eligibility (422, all reasons collected):**
   - `expense_income_ratio_out_of_supported_range` for values outside [0.80, 1.05];
   - `no_current_reserve` when the buffer is 0;
   - `buffer_months_out_of_supported_range` for values outside [1, 12];
   - `conversion_cost_out_of_supported_range` for values above 0.01.
5. **Job creation.**

**Side effects by response:**

- Invalid input (400) and unsupported scenarios (422) are rejected before job creation. They create no job, publish no task, and invoke no computation.
- So are the two 503 cases detected before creation: `submissions_disabled` and `provenance_unavailable`.
- Broker publication failure (503 `queue_unavailable`) happens **after** the job row has been committed. That row is kept as `failed` with `queue_unavailable`, so the existing retry lifecycle can reset and redispatch it on resubmission. No computation runs.

The vector validator is shared with the engine facade (`research_engine.personal.validate_share_vector`).

---

## 3. Engine integration

- `research_engine/personal.py` provides `analyze_household(*, income_shares, expense_shares, current_weights, expense_income_ratio, buffer_months, horizon_years, rebalance_frequency, conversion_cost, _fx_bundle=None)`, exported from `research_engine/__init__.py`.
- **Strict adapter.** It runs the strict checks first and only then the unchanged range validators, so their coercion and defaults never apply. It does not call `_validate_weights`. `HouseholdProfile("custom_household", …)` is constructed as the authoritative share check.
- **One bundle, both policies.** `_resolve_fx_bundle` is called exactly once (production: 10,000 paths, seed 42, full 5 years, then horizon slicing). The current policy is evaluated with `make_cashflows` and `evaluate_weights` on the accepted weights. The unchanged `optimize_cell` runs on the same monthly slice, and the current weights are never added to its surface.
- **Strict provenance reader.** `engine_provenance()` reads `MODEL_MANIFEST.json` without fallbacks (the existing `api._model_version` falls back to `"1.0.0"`). It verifies:
  - `data_as_of` against the engine constant;
  - the sha256 format of the dataset hash;
  - the **actual dataset file hash**;
  - the seed, path count, and generated horizon.

  It is read again after computation, and any drift is rejected.

- **No rebasing.** Production paths are never rebased to user rates. Raw amounts, rates and dates, and contributions are not engine inputs.
- **No Django inside the engine.** Django imports only `analyze_household` (in the task) and the facade's validation, provenance and constant helpers.

---

## 4. Persistence, lifecycle, provenance

- **Model and migration.** `HouseholdAnalysisJob`, added by migration `0004_household_analysis_job`. Its fields:
  - the lifecycle fields shared with the existing job models;
  - a unique `request_fingerprint`;
  - the normalized `request_payload` and the `result_payload`;
  - `contract_version` and `engine_interface_version`;
  - the snapshot `model_version`, `data_as_of`, `dataset_sha256`, `simulation_paths`, `simulation_seed`, and `canonical_optimization_specification`.
- **Lifecycle.** `household_services.py` configures the shared `lifecycle.py`, which is unchanged. That gives:
  - create or reuse, with integrity-race handling;
  - `transaction.on_commit` publish;
  - `queue_unavailable` on publish failure;
  - claim and lease ownership;
  - duplicate and redelivery handling;
  - attempt limits;
  - stale-result rejection.

  The submission-time snapshot overrides the lifecycle's default `model_version`/`data_as_of` through `extra_create_fields`.

- **Fingerprint.** sha256 of canonical JSON (sorted keys, compact, float `repr`, `allow_nan=False`) over:
  - the kind, contract version and engine-interface version;
  - the normalized request;
  - `model_version`, `data_as_of`, `dataset_sha256`, paths, seed, and the optimization specification.

  `1` and `1.0` hash identically; inputs are never rounded.

- **Before computation** (`assert_household_job_current`):
  - the snapshot must equal live provenance;
  - the stored request must re-parse and be canonical;
  - the recomputed fingerprint must equal the stored one.

  Any drift fails the job with `provenance_changed` and **zero engine calls** (tested for every snapshot field, live drift, fingerprint tampering, and request tampering).

- **Before success storage** (`validate_household_result`, run both in the task and inside `store_success`):
  - exact keys at every level, both policies present, and identification only on the optimized side;
  - finite, non-negative losses and wealth values; probabilities in [0, 1];
  - valid weight vectors, with current weights exactly equal to the request;
  - consistent counts (`n_surface ≤ n_coarse + n_refined`, `1 ≤ near_count ≤ n_surface`, `near_frac = near_count / n_surface`);
  - the scenario echo exactly equal to the request;
  - provenance field types checked first, so `simulation_paths` and `simulation_seed` must be real non-boolean integers (`10000.0` is rejected), and the text fields must be non-empty strings; only then must provenance equal both the snapshot and the live values. The same type check applies when live provenance is read;
  - the delta equal to optimized minus current CVaR, and the outcome consistent with the 1e-8 tie tolerance;
  - `includes_initial_switching_cost` is `false`.
- **Stale writes.** A stale write returns `stale_result_rejected` and is never reported as success.

---

## 5. Settings, routing, retention

| Setting                                   | Default  | Notes                                                                                            |
| ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `HOUSEHOLD_ANALYSIS_SUBMISSIONS_ENABLED`  | `False`  | All environments. Enable only explicitly (local `.env`, tests). GET polling is always available. |
| `DRF_HOUSEHOLD_ANALYSIS_SUBMIT_THROTTLE`  | `3/hour` | Scope `household_analysis_submit`. Polling uses `job_poll`.                                      |
| `HOUSEHOLD_ANALYSIS_TASK_SOFT_TIME_LIMIT` | `180`    | Soft task limit in seconds; benchmark difficult custom cases on the deployment host.             |
| `HOUSEHOLD_ANALYSIS_TASK_TIME_LIMIT`      | `240`    | Hard task limit in seconds.                                                                      |
| `HOUSEHOLD_ANALYSIS_LEASE_SECONDS`        | `300`    | Claim lease in seconds, validated against the hard limit with a 60 s safety margin.              |

- **Routing:** the default `celery` queue (no route entry). It is consumed by `worker_pilot` and `worker_opt`, so no new worker is needed.
- **Retention:** `cleanup_expired_jobs` now includes household jobs. Output: `retention_cleanup mode=… cutoff=… optimization=N buffer_sensitivity=N household_analysis=N total=N`. It deletes terminal jobs only; queued and running jobs are protected, and `--dry-run` deletes nothing.
- **Deletion depends on the command being run.** A scheduler must invoke the command; the retention setting alone does not delete data.

Application job logging uses identifiers, statuses and error codes rather than request or result payloads.

---

## Frontend behavior

Eligibility feedback appears beside the relevant answers and on the overview.
Valid answers outside the simulation domain still produce an arithmetic
overview. The run button stays visible and is disabled when requirements are
not met; no acknowledgement checkbox is required.

Personal results use `/assessment/results/:jobId`. The client validates the
result contract and polls at four-second intervals without overlapping
requests. Polling stops on completion, navigation or component destruction.
Same-tab results must match the submitted normalized request; direct result
links use the server's echoed scenario rather than an unrelated draft.

The comparison explicitly supports `optimized_lower`, `current_lower` and
`equal_within_tolerance`. A submitted allocation may outperform the finite
search grid. Identification belongs only to the optimized surface. Display
rounding must not change the comparison or turn a nonzero probability into zero.

Anyone with a result link can view its stored scenario and results. Search
indexing restrictions are not authentication. Clearing a browser draft does
not remove an already submitted job.

## Verification and deployment

Contract and lifecycle tests are in `backend/tests/test_household_analysis_api.py`;
engine checks are in `backend/tests/test_household_analysis_engine.py`.
`scripts/verification/household_api_check.py` provides real API checks.

Before enabling personal submissions on a host, measure runtime and peak memory
for difficult custom cases, including broad near-optimal surfaces. Verify
PostgreSQL/Redis execution, duplicate submissions and recovery after worker
loss. Configure cleanup separately. Local test success does not establish
that a particular host meets the task limits.

See [operations](../deployment/pilot-operations-runbook.md) and
[model methodology](resilience-and-buffer-methodology.md).
