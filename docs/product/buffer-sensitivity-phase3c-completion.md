# Buffer Sensitivity Batch — Phase 3C Completion Memo

Status: **Implemented and regression-tested.** This memo records what shipped in
Phase 3C relative to the Phase 3B design
(`docs/product/buffer-sensitivity-batch-design.md`) and the scientific
methodology (`docs/product/resilience-and-buffer-methodology.md`).

Contract / presentation versions:

- `contract_version`: `buffer_sensitivity_batch_v1`
- `presentation_version`: `presentation_v1`
- Fixed tested buffers: `[1, 3, 6, 12]` (server-owned; never client-controlled)

---

## 1. Architecture

### Endpoints

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/api/v1/buffer-sensitivity-jobs/` | Create or reuse a batch job; HTTP `202` when newly queued, `200` when a durable job is reused |
| `GET` | `/api/v1/buffer-sensitivity-jobs/<uuid>/` | Poll status / result / safe failure fields |

Single-job optimization remains on `/api/v1/optimization-jobs/` and is unchanged
in scientific behavior.

### Separate durable model

`calculations.BufferSensitivityJob` is a first-class model (migration
`0003_buffer_sensitivity_job`), parallel to `OptimizationJob` but not shared
with it. Shared fields include status, fingerprint, request/result payloads,
error fields, `model_version`, `data_as_of`, lease / Celery task id / attempt
count. Batch-only: `contract_version` (default `buffer_sensitivity_batch_v1`).

Lifecycle (create-or-reuse, claim, lease, redelivery, max attempts, stale-result
rejection, safe failure storage) lives in `calculations.lifecycle` and is
configured for batch via `calculations.batch_services`.

### Compute path

The Celery task `calculations.run_buffer_sensitivity_job`:

1. Claims the job under lease.
2. Asserts job snapshot provenance is still current (**before** any optimizer
   call).
3. Runs **four sequential** public `optimize_allocation(...)` calls for
   `buffer_months ∈ {1, 3, 6, 12}`.
4. Never passes `_fx_bundle` (production regenerates FX per public call).
5. Validates scenario echo, shared authoritative provenance, and full result
   contract.
6. Stores a single atomic result payload, or fails the whole job with
   `result_payload=null`.

HTTP views never call the optimizer directly.

### Fingerprint material

`compute_batch_fingerprint()` hashes (sorted JSON → SHA-256):

| Material | Role |
|---|---|
| `kind` = `buffer_sensitivity_batch` | Separates batch cache from single-job fingerprints |
| `contract_version` | Invalidates cache when the batch contract changes |
| `presentation_version` | Invalidates cache when the presentation contract changes |
| Normalized request (no buffers) | Scenario identity |
| `tested_buffers` = `[1,3,6,12]` | Fixed server grid |
| `model_version()`, `data_as_of()`, `dataset_sha256()` | Authoritative data/model snapshot |
| `PRODUCTION_N_PATHS`, `PRODUCTION_SEED` | Simulation constants |
| Manifest `canonical_optimization_specification` | Spec identity |

---

## 2. Provenance integrity

Phase 3C rejects both **cross-response drift** and **consistently false but
internally agreeing** provenance.

### Before optimization (zero optimizer calls on mismatch)

`assert_job_fingerprint_current` requires:

- `job.model_version == model_version()`
- `job.data_as_of == data_as_of()`
- `job.contract_version == BUFFER_SENSITIVITY_CONTRACT_VERSION`
- recomputed fingerprint == `job.request_fingerprint`

Failure → `error_code=provenance_changed`, no partial result.

### After the four responses

`assert_shared_production_provenance` requires:

- all four responses agree with each other;
- `model_version` equals the authoritative job/current model version;
- `data_as_of` equals the authoritative job/current data date;
- `simulation_paths` / `simulation_seed` exactly equal production constants;
- booleans and wrong types are rejected (no Python equality/coercion shortcuts).

### Result assembly

`build_batch_result_payload` and `validate_batch_result_payload` do **not**
repair missing or invalid optimizer provenance. `None` is not stringified;
production values are not silently substituted. Incomplete provenance fails with
`result_validation_failed`.

User-facing failure text remains the fixed safe message from
`batch_services.SAFE_FAILURE_MESSAGE` (no internal exception text, no wrong
version/date leakage).

---

## 3. Security / abuse controls

| Control | Default / behavior |
|---|---|
| Strict create serializer | Accepts only `profile`, `horizon_years`, optional `expense_income_ratio`, `rebalance_frequency`, `conversion_cost` |
| Forbidden client fields | Includes `buffer_months`, `n_paths`, `seed`, `_fx_bundle`, model/dataset provenance fields, and related controls |
| Feature switch | `BUFFER_SENSITIVITY_SUBMISSIONS_ENABLED` (default `True` in development); when `False`, POST returns disabled message; GET still works |
| Submit throttle | Separate DRF scope `buffer_sensitivity_submit`, default `2/hour` (`DRF_BUFFER_SENSITIVITY_SUBMIT_THROTTLE`) |
| Poll throttle | Shared job-poll throttle with single-job detail |
| Broker publish failure | Marked `queue_unavailable`; POST returns HTTP `503` |
| Atomic failure | Any buffer failure / timeout / validation / provenance error fails the whole job; no partial `result_payload` |
| Stale worker protection | Success/failure store requires matching `celery_task_id`; mismatch → `stale_result_rejected` (not reported as succeeded) |
| Prohibited product fields | Result contract rejects resilience-score / recommended-buffer style fields |

---

## 4. Worker / queue configuration

| Setting | Default |
|---|---|
| Batch queue | `buffer_sensitivity` (`CELERY_TASK_ROUTES` + task `queue=`) |
| Batch soft / hard / lease | `600` / `720` / `840` s (lease ≥ hard + 120 s margin; validated at settings import) |
| Single-job soft / hard / lease | `180` / `240` / `300` s (lease ≥ hard + 60 s margin) — revised from Phase 3B measurements |
| Worker concurrency / prefetch / max-tasks-per-child | `1` / `1` / `1` (process settings) |
| `acks_late` / `reject_on_worker_lost` | `True` / `True` |
| Max attempts | Shared `OPTIMIZATION_MAX_ATTEMPTS` default `2` |

Production design: dedicated concurrency-1 worker on `buffer_sensitivity`
(see README). Local dual-queue workers are an explicit convenience only.
Batch workers should allow **≥ 2 GiB RAM**; running both workers on one host
needs roughly **4 GiB+** free at peak.

---

## 5. Validation

Stored success payloads must pass `validate_batch_result_payload`, including:

- Exact top-level key set; required provenance / scenario / row keys.
- Contract and presentation versions match current constants.
- Provenance matches authoritative model version, data date, dataset hash,
  paths, seed, canonical optimization specification, and FX path policy.
- Scenario echo matches the job request.
- Exactly four rows for buffers `[1, 3, 6, 12]` in order; no duplicates/swaps.
- Finite non-boolean numerics; probabilities in `[0, 1]`; weight sum tolerance;
  identification class membership; no implementation-only leakage at top level;
  no prohibited product fields.

Worker-side scenario echo checks run per response before batch assembly.

---

## 6. Test coverage

Focused suite: `backend/tests/test_api_buffer_sensitivity_jobs.py`
(**51** tests). Notable coverage:

- Defaults, accepted inputs, unknown/forbidden fields
- Fingerprint stability; separation from single-job fingerprint; sensitivity to
  contract, model version, `data_as_of`, and presentation version
- Dedup / IntegrityError reuse; cached success HTTP `200`
- Four ordered public optimize calls; source-level proof of no `_fx_bundle`
- Atomic failure; soft-timeout whole-job failure; no partial store
- Claim / redelivery / expired-lease recovery / stale-store rejection
- Broker `503`; feature switch; 404 / poll detail
- Separate submit throttle from optimization
- Views never invoke optimizer; task routing and documented limits
- Result builder rejects numpy / non-finite values
- Failed-job in-place retry
- Full contract validation (buffers, row fields, weights, probabilities, counts,
  provenance, versions)
- Scenario echo mismatch; cross-response provenance drift
- Consistently wrong model version / data date rejected
- Job snapshot mismatch fails before optimize
- Missing provenance not repaired by fallback
- Safe user message only on failure surfaces

Full backend suite at completion: **87** passed (includes the 51 focused tests).

Also verified: Django system check (0 issues); `makemigrations --check --dry-run`
(no changes).

---

## 7. Known limits

- Batch wall time is dominated by **four full public** `optimize_allocation`
  calls (each regenerates FX). Limits `600/720/840` were sized from Phase 3B
  public-path probes on the design host; **re-measure on deployment hardware**
  before tightening or declaring headroom.
- Single-job limits were raised to `180/240/300` because Phase 3B showed
  advertised 5y cases exceeding the prior `120` soft limit on that host.
- Cache reuse is intentional for identical fingerprint material; changing model
  version, data date, dataset hash, contract, or presentation version correctly
  forces a new job.
- Feature switch and throttles are operational controls, not scientific gates.
- This phase does **not** add a frontend Buffer Sensitivity Explorer UI; it
  ships the durable API/worker contract the UI can consume later.

---

## 8. Explicit non-claims

Phase 3C does **not**:

- Change the research engine, scientific outputs, manuscript, or canonical
  fixtures.
- Introduce a scalar Resilience Score, recommended/optimal/safe/sufficient
  buffer, or any advice/forecast/guarantee framing.
- Let clients choose buffers, paths, seed, FX injection, or provenance fields.
- Store or return partial four-buffer tables on failure.
- Treat mutual agreement of four responses as sufficient provenance without
  matching authoritative current/job values.
- Claim deployment-hardware timing proof beyond the Phase 3B host measurements
  and the limit defaults derived from them.
- Replace the need for a dedicated production `buffer_sensitivity` worker in
  operational runbooks.

Product sequencing remains:

1. Resilience Profile — from a single successful optimization job.
2. Buffer Sensitivity Explorer — from a completed batch under this contract.
3. Minimum tested buffer meeting a user-selected diagnostic target — derived
   only from a **completed** batch; not a separate optimization fan-out.
