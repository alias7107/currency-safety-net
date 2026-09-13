import type {
  ApiError,
  BufferSensitivityImplementationOnly,
  BufferSensitivityJobAccepted,
  BufferSensitivityJobStatus,
  BufferSensitivityProvenance,
  BufferSensitivityResult,
  BufferSensitivityResultRow,
  BufferSensitivityScenario,
  BufferSensitivityUnits,
  JobStatus,
} from './models';

/** Matches backend `BUFFER_SENSITIVITY_CONTRACT_VERSION`. */
export const BUFFER_SENSITIVITY_CONTRACT_VERSION = 'buffer_sensitivity_batch_v1';

/** Matches backend `BUFFER_SENSITIVITY_PRESENTATION_VERSION`. */
export const BUFFER_SENSITIVITY_PRESENTATION_VERSION = 'presentation_v1';

/** Matches backend `DOCUMENTED_BUFFERS`. */
export const DOCUMENTED_BUFFERS = [1, 3, 6, 12] as const;

/** Matches backend `UNITS_CUMULATIVE_SHORTFALL`. */
export const UNITS_CUMULATIVE_SHORTFALL = 'months_of_initial_monthly_income_I0_equals_1';

/** Matches backend `FX_PATH_POLICY`. */
export const FX_PATH_POLICY = 'deterministic_regeneration_per_public_optimize_call';

/**
 * Matches backend production simulation invariants (`PRODUCTION_N_PATHS` /
 * `PRODUCTION_SEED`). These are public API contract constants, not model outputs.
 */
export const PRODUCTION_SIMULATION_PATHS = 10_000;
export const PRODUCTION_SIMULATION_SEED = 42;

/** Matches backend `SUPPORTED_IDENTIFICATION_CLASSES`. */
export const SUPPORTED_IDENTIFICATION_CLASSES = new Set([
  'A_WELL_IDENTIFIED',
  'B_WEAKLY_IDENTIFIED',
  'C_NOT_IDENTIFIED',
]);

/**
 * Matches backend `WEIGHT_SUM_ATOL` (`research_engine.api`).
 * Weights must sum to 1 within this absolute tolerance.
 */
export const WEIGHT_SUM_ATOL = 1e-10;

const SHA256_HEX_RE = /^[0-9a-fA-F]{64}$/;
const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const JOB_STATUSES = new Set<JobStatus>(['queued', 'running', 'succeeded', 'failed']);

const REQUIRED_TOP_LEVEL = [
  'contract_version',
  'presentation_version',
  'tested_buffers',
  'units',
  'provenance',
  'scenario',
  'results',
] as const;

const REQUIRED_PROVENANCE = [
  'model_version',
  'data_as_of',
  'dataset_sha256',
  'simulation_paths',
  'simulation_seed',
  'canonical_optimization_specification',
  'fx_path_policy',
] as const;

const REQUIRED_SCENARIO = [
  'profile',
  'horizon_years',
  'expense_income_ratio',
  'rebalance_frequency',
  'conversion_cost',
] as const;

const REQUIRED_ROW = [
  'buffer_months',
  'weights',
  'shortfall_probability',
  'cvar95_cumulative_shortfall',
  'var95_cumulative_shortfall',
  'identification_class',
  'near_optimal_1pct_frac',
  'near_optimal_1pct_count',
  'n_coarse',
  'n_refined',
  'n_surface',
  'implementation_only',
] as const;

const REQUIRED_IMPLEMENTATION_ONLY = [
  'mean_cumulative_shortfall',
  'wealth_depletion_probability',
  'mean_terminal_wealth',
  'median_terminal_wealth',
  'p05_terminal_wealth',
  'p95_terminal_wealth',
] as const;

const PROHIBITED_RESULT_FIELDS = [
  'resilience_score',
  'recommended_buffer',
  'optimal_buffer',
  'safe_buffer',
  'sufficient_buffer',
  'minimum_buffer',
  'minimum_tested_buffer',
  'near_optimal_kzt_range',
] as const;

const REQUIRED_ACCEPTED_KEYS = [
  'job_id',
  'status',
  'cached',
  'status_url',
  'contract_version',
  'tested_buffers',
] as const;

const REQUIRED_STATUS_KEYS = [
  'job_id',
  'status',
  'created_at',
  'started_at',
  'contract_version',
  'tested_buffers',
] as const;

export function malformedResponseError(
  message = 'The buffer sensitivity result was incomplete.',
): ApiError {
  return {
    status: 0,
    code: 'malformed_response',
    message,
  };
}

export function isValidOriginJobId(value: string | null | undefined): value is string {
  return typeof value === 'string' && JOB_ID_RE.test(value.trim());
}

/**
 * Runtime-validate a succeeded batch payload at the API boundary.
 * Returns a typed result or a safe malformed_response ApiError — never partial data.
 */
export function validateBufferSensitivityResult(
  value: unknown,
): { ok: true; result: BufferSensitivityResult } | { ok: false; error: ApiError } {
  try {
    const result = assertBufferSensitivityResult(value);
    return { ok: true, result };
  } catch {
    return { ok: false, error: malformedResponseError() };
  }
}

export function validateBufferSensitivityJobAccepted(
  value: unknown,
): { ok: true; body: BufferSensitivityJobAccepted } | { ok: false; error: ApiError } {
  try {
    return { ok: true, body: assertJobAccepted(value) };
  } catch {
    return { ok: false, error: malformedResponseError() };
  }
}

export function validateBufferSensitivityJobStatus(
  value: unknown,
): { ok: true; body: BufferSensitivityJobStatus } | { ok: false; error: ApiError } {
  try {
    return { ok: true, body: assertJobStatus(value) };
  } catch {
    return { ok: false, error: malformedResponseError() };
  }
}

function assertJobAccepted(value: unknown): BufferSensitivityJobAccepted {
  if (!isPlainObject(value)) {
    throw new Error('accepted');
  }
  for (const key of REQUIRED_ACCEPTED_KEYS) {
    if (!(key in value)) {
      throw new Error(`accepted.${key}`);
    }
  }
  const jobId = requireNonEmptyString(value['job_id']);
  if (!JOB_ID_RE.test(jobId)) {
    throw new Error('job_id');
  }
  const status = requireJobStatus(value['status']);
  if (typeof value['cached'] !== 'boolean') {
    throw new Error('cached');
  }
  requireNonEmptyString(value['status_url']);
  const contractVersion = requireNonEmptyString(value['contract_version']);
  if (contractVersion !== BUFFER_SENSITIVITY_CONTRACT_VERSION) {
    throw new Error('contract_version');
  }
  const testedBuffers = requireDocumentedBuffers(value['tested_buffers']);

  const body: BufferSensitivityJobAccepted = {
    job_id: jobId,
    status,
    cached: value['cached'],
    status_url: String(value['status_url']),
    contract_version: contractVersion,
    tested_buffers: testedBuffers,
  };

  if ('result' in value && value['result'] !== undefined && value['result'] !== null) {
    if (status !== 'succeeded') {
      throw new Error('result_without_succeeded');
    }
    body.result = assertBufferSensitivityResult(value['result']);
  } else if (status === 'succeeded' && value['cached'] === true) {
    throw new Error('cached_succeeded_without_result');
  }

  if ('error_code' in value) {
    body.error_code =
      value['error_code'] === null ? null : requireNonEmptyString(value['error_code']);
  }
  if ('error_message' in value) {
    body.error_message =
      value['error_message'] === null ? null : requireNonEmptyString(value['error_message']);
  }
  return body;
}

function assertJobStatus(value: unknown): BufferSensitivityJobStatus {
  if (!isPlainObject(value)) {
    throw new Error('status');
  }
  for (const key of REQUIRED_STATUS_KEYS) {
    if (!(key in value)) {
      throw new Error(`status.${key}`);
    }
  }
  const jobId = requireNonEmptyString(value['job_id']);
  if (!JOB_ID_RE.test(jobId)) {
    throw new Error('job_id');
  }
  const status = requireJobStatus(value['status']);
  requireNonEmptyString(value['created_at']);
  if (value['started_at'] !== null) {
    requireNonEmptyString(value['started_at']);
  }
  const contractVersion = requireNonEmptyString(value['contract_version']);
  if (contractVersion !== BUFFER_SENSITIVITY_CONTRACT_VERSION) {
    throw new Error('contract_version');
  }
  const testedBuffers = requireDocumentedBuffers(value['tested_buffers']);

  const body: BufferSensitivityJobStatus = {
    job_id: jobId,
    status,
    created_at: String(value['created_at']),
    started_at: value['started_at'] === null ? null : String(value['started_at']),
    contract_version: contractVersion,
    tested_buffers: testedBuffers,
  };

  if ('completed_at' in value && value['completed_at'] != null) {
    body.completed_at = requireNonEmptyString(value['completed_at']);
  }

  if (status === 'succeeded') {
    if (!('result' in value) || value['result'] == null) {
      throw new Error('succeeded_without_result');
    }
    body.result = assertBufferSensitivityResult(value['result']);
  } else if ('result' in value && value['result'] != null) {
    throw new Error('result_without_succeeded');
  }

  if (status === 'failed') {
    if ('error_code' in value) {
      body.error_code =
        value['error_code'] === null ? null : requireNonEmptyString(value['error_code']);
    }
    if ('error_message' in value) {
      body.error_message =
        value['error_message'] === null ? null : requireNonEmptyString(value['error_message']);
    }
  }
  return body;
}

function assertBufferSensitivityResult(value: unknown): BufferSensitivityResult {
  if (!isPlainObject(value)) {
    throw new Error('not an object');
  }
  assertExactKeys(value, REQUIRED_TOP_LEVEL);
  for (const key of PROHIBITED_RESULT_FIELDS) {
    if (key in value) {
      throw new Error(`prohibited field ${key}`);
    }
  }

  const contractVersion = requireNonEmptyString(value['contract_version']);
  const presentationVersion = requireNonEmptyString(value['presentation_version']);
  if (contractVersion !== BUFFER_SENSITIVITY_CONTRACT_VERSION) {
    throw new Error('contract_version');
  }
  if (presentationVersion !== BUFFER_SENSITIVITY_PRESENTATION_VERSION) {
    throw new Error('presentation_version');
  }

  const testedBuffers = requireDocumentedBuffers(value['tested_buffers']);
  const units = assertUnits(value['units']);
  const provenance = assertProvenance(value['provenance']);
  const scenario = assertScenario(value['scenario']);
  const rowsRaw = value['results'];
  if (!Array.isArray(rowsRaw) || rowsRaw.length !== DOCUMENTED_BUFFERS.length) {
    throw new Error('results length');
  }

  const results = rowsRaw.map((row, index) => assertRow(row, testedBuffers[index]!));

  return {
    contract_version: contractVersion,
    presentation_version: presentationVersion,
    tested_buffers: testedBuffers,
    units,
    provenance,
    scenario,
    results,
  };
}

function assertUnits(value: unknown): BufferSensitivityUnits {
  if (!isPlainObject(value)) {
    throw new Error('units');
  }
  assertExactKeys(value, ['cumulative_shortfall']);
  const units = requireNonEmptyString(value['cumulative_shortfall']);
  if (units !== UNITS_CUMULATIVE_SHORTFALL) {
    throw new Error('units.cumulative_shortfall');
  }
  return { cumulative_shortfall: units };
}

function assertProvenance(value: unknown): BufferSensitivityProvenance {
  if (!isPlainObject(value)) {
    throw new Error('provenance');
  }
  assertExactKeys(value, REQUIRED_PROVENANCE);
  const sha = requireNonEmptyString(value['dataset_sha256']);
  if (!SHA256_HEX_RE.test(sha)) {
    throw new Error('dataset_sha256');
  }
  const paths = requirePositiveInt(value['simulation_paths']);
  if (paths !== PRODUCTION_SIMULATION_PATHS) {
    throw new Error('simulation_paths');
  }
  const seed = requireNonNegativeInt(value['simulation_seed']);
  if (seed !== PRODUCTION_SIMULATION_SEED) {
    throw new Error('simulation_seed');
  }
  const fxPolicy = requireNonEmptyString(value['fx_path_policy']);
  if (fxPolicy !== FX_PATH_POLICY) {
    throw new Error('fx_path_policy');
  }
  return {
    model_version: requireNonEmptyString(value['model_version']),
    data_as_of: requireNonEmptyString(value['data_as_of']),
    dataset_sha256: sha,
    simulation_paths: paths,
    simulation_seed: seed,
    canonical_optimization_specification: requireNonEmptyString(
      value['canonical_optimization_specification'],
    ),
    fx_path_policy: fxPolicy,
  };
}

function assertScenario(value: unknown): BufferSensitivityScenario {
  if (!isPlainObject(value)) {
    throw new Error('scenario');
  }
  assertExactKeys(value, REQUIRED_SCENARIO);
  if ('buffer_months' in value) {
    throw new Error('scenario.buffer_months');
  }
  return {
    profile: requireNonEmptyString(value['profile']),
    horizon_years: requirePositiveInt(value['horizon_years']),
    expense_income_ratio: requireFiniteNumber(value['expense_income_ratio']),
    rebalance_frequency: requireNonEmptyString(value['rebalance_frequency']),
    conversion_cost: requireFiniteNumber(value['conversion_cost']),
  };
}

function assertRow(value: unknown, expectedBuffer: number): BufferSensitivityResultRow {
  if (!isPlainObject(value)) {
    throw new Error('row');
  }
  assertExactKeys(value, REQUIRED_ROW);
  for (const key of PROHIBITED_RESULT_FIELDS) {
    if (key in value) {
      throw new Error(`row prohibited ${key}`);
    }
  }

  const bufferMonths = requireFiniteNumber(value['buffer_months']);
  if (bufferMonths !== expectedBuffer) {
    throw new Error('buffer mismatch');
  }

  const weights = requireWeights(value['weights']);
  const identification = requireNonEmptyString(value['identification_class']);
  if (!SUPPORTED_IDENTIFICATION_CLASSES.has(identification)) {
    throw new Error('identification_class');
  }

  const nearCount = requireNonNegativeInt(value['near_optimal_1pct_count']);
  const nSurface = requirePositiveInt(value['n_surface']);
  if (nearCount > nSurface) {
    throw new Error('near_optimal_1pct_count');
  }

  const implementationOnly = assertImplementationOnly(value['implementation_only']);

  return {
    buffer_months: bufferMonths,
    weights,
    shortfall_probability: requireProbability(value['shortfall_probability']),
    cvar95_cumulative_shortfall: requireNonNegativeNumber(value['cvar95_cumulative_shortfall']),
    var95_cumulative_shortfall: requireNonNegativeNumber(value['var95_cumulative_shortfall']),
    identification_class: identification,
    near_optimal_1pct_frac: requireProbability(value['near_optimal_1pct_frac']),
    near_optimal_1pct_count: nearCount,
    n_coarse: requirePositiveInt(value['n_coarse']),
    n_refined: requirePositiveInt(value['n_refined']),
    n_surface: nSurface,
    implementation_only: implementationOnly,
  };
}

function assertImplementationOnly(value: unknown): BufferSensitivityImplementationOnly {
  if (!isPlainObject(value)) {
    throw new Error('implementation_only');
  }
  assertExactKeys(value, REQUIRED_IMPLEMENTATION_ONLY);
  return {
    mean_cumulative_shortfall: requireNonNegativeNumber(value['mean_cumulative_shortfall']),
    wealth_depletion_probability: requireProbability(value['wealth_depletion_probability']),
    mean_terminal_wealth: requireNonNegativeNumber(value['mean_terminal_wealth']),
    median_terminal_wealth: requireNonNegativeNumber(value['median_terminal_wealth']),
    p05_terminal_wealth: requireNonNegativeNumber(value['p05_terminal_wealth']),
    p95_terminal_wealth: requireNonNegativeNumber(value['p95_terminal_wealth']),
  };
}

function requireDocumentedBuffers(value: unknown): number[] {
  const testedBuffers = requireNumberArray(value);
  if (
    testedBuffers.length !== DOCUMENTED_BUFFERS.length ||
    DOCUMENTED_BUFFERS.some((buffer, index) => testedBuffers[index] !== buffer)
  ) {
    throw new Error('tested_buffers');
  }
  return [...DOCUMENTED_BUFFERS];
}

function requireJobStatus(value: unknown): JobStatus {
  if (typeof value !== 'string' || !JOB_STATUSES.has(value as JobStatus)) {
    throw new Error('status');
  }
  return value as JobStatus;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, required: readonly string[]): void {
  const keys = Object.keys(value).sort();
  const expected = [...required].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('key set');
  }
}

function requireNonEmptyString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('string');
  }
  return value;
}

function requireFiniteNumber(value: unknown): number {
  if (typeof value === 'boolean' || typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('number');
  }
  return value;
}

function requireNonNegativeNumber(value: unknown): number {
  const number = requireFiniteNumber(value);
  if (number < 0) {
    throw new Error('non-negative');
  }
  return number;
}

function requireProbability(value: unknown): number {
  const number = requireFiniteNumber(value);
  if (number < 0 || number > 1) {
    throw new Error('probability');
  }
  return number;
}

function requireNonNegativeInt(value: unknown): number {
  if (
    typeof value === 'boolean' ||
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error('int');
  }
  return value;
}

function requirePositiveInt(value: unknown): number {
  const number = requireNonNegativeInt(value);
  if (number <= 0) {
    throw new Error('positive int');
  }
  return number;
}

function requireNumberArray(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('number array');
  }
  return value.map((entry) => requireFiniteNumber(entry));
}

function requireWeights(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error('weights length');
  }
  const weights = value.map((entry) => requireNonNegativeNumber(entry));
  const sum = weights[0]! + weights[1]! + weights[2]!;
  if (Math.abs(sum - 1) > WEIGHT_SUM_ATOL) {
    throw new Error('weights sum');
  }
  return weights;
}
