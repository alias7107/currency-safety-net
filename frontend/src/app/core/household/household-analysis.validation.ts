import type { ApiError, JobStatus } from '../api/models';
import { isValidOriginJobId } from '../api/buffer-sensitivity.validation';
import {
  CURRENT_POLICY_LABEL,
  DELTA_CONSISTENCY_TOLERANCE,
  HOUSEHOLD_CONTRACT_VERSION,
  HOUSEHOLD_ENGINE_INTERFACE_VERSION,
  HOUSEHOLD_FX_PATH_POLICY,
  HOUSEHOLD_IDENTIFICATION_CLASSES,
  HOUSEHOLD_UNITS,
  OPTIMIZED_POLICY_LABEL,
  PRODUCTION_SIMULATION_PATHS,
  PRODUCTION_SIMULATION_SEED,
  SHARE_SUM_TOLERANCE,
  SUPPORTED_BUFFER_MONTHS,
  SUPPORTED_CONVERSION_COST,
  SUPPORTED_EXPENSE_INCOME_RATIO,
  SUPPORTED_HORIZON_YEARS,
  SUPPORTED_REBALANCE_FREQUENCIES,
  TIE_ABSOLUTE_TOLERANCE,
  type HouseholdAnalysisRequest,
  type HouseholdAnalysisResult,
  type HouseholdAnalysisScenario,
  type HouseholdComparisonOutcome,
  type HouseholdJobAccepted,
  type HouseholdJobStatus,
  type HouseholdPolicyEvaluation,
  type HouseholdUnsupportedReason,
  type HouseholdVector,
} from './household-analysis.models';

const JOB_STATUSES: readonly JobStatus[] = ['queued', 'running', 'succeeded', 'failed'];
const SHA256_RE = /^[0-9a-f]{64}$/;

export type ValidationOutcome<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export function householdMalformedError(
  message = 'The personal simulation response could not be verified.',
): ApiError {
  return { status: 0, code: 'malformed_response', message };
}

export function householdStatusUrl(jobId: string): string {
  return `/api/v1/household-analysis-jobs/${jobId}/`;
}

class ContractViolation extends Error {}

function fail(where: string): never {
  throw new ContractViolation(where);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function requireObject(value: unknown, where: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    fail(where);
  }
  return value;
}

function assertExactKeys(
  obj: Record<string, unknown>,
  required: readonly string[],
  where: string,
  optional: readonly string[] = [],
): void {
  const keys = Object.keys(obj);
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      fail(`${where}.${key}`);
    }
  }
  for (const key of keys) {
    if (!required.includes(key) && !optional.includes(key)) {
      fail(`${where}.${key}`);
    }
  }
}

function requireFinite(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(where);
  }
  return value;
}

function requireNonNegative(value: unknown, where: string): number {
  const n = requireFinite(value, where);
  if (n < 0) {
    fail(where);
  }
  return n;
}

function requireProbability(value: unknown, where: string): number {
  const n = requireFinite(value, where);
  if (n < 0 || n > 1) {
    fail(where);
  }
  return n;
}

function requireCount(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail(where);
  }
  return value;
}

function requireString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(where);
  }
  return value;
}

function requireLiteral<T extends string | number | boolean>(
  value: unknown,
  expected: T,
  where: string,
): T {
  if (value !== expected) {
    fail(where);
  }
  return expected;
}

function requireInRange(n: number, range: { min: number; max: number }, where: string): void {
  if (n < range.min || n > range.max) {
    fail(where);
  }
}

/** Valid share vector: three finite, non-negative numbers summing to 1 within 1e-12. */
export function isValidShareVector(value: unknown): value is HouseholdVector {
  if (!Array.isArray(value) || value.length !== 3) {
    return false;
  }
  for (const v of value) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      return false;
    }
  }
  const sum = value[0] + value[1] + value[2];
  return Math.abs(sum - 1) <= SHARE_SUM_TOLERANCE;
}

function requireVector(value: unknown, where: string): HouseholdVector {
  if (!isValidShareVector(value)) {
    fail(where);
  }
  return [value[0], value[1], value[2]];
}

function vectorsEqual(a: HouseholdVector, b: HouseholdVector): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function requireJobId(value: unknown, where: string): string {
  if (typeof value !== 'string' || !isValidOriginJobId(value) || value !== value.trim()) {
    fail(where);
  }
  return value;
}

function requireStatus(value: unknown, where: string): JobStatus {
  if (typeof value !== 'string' || !JOB_STATUSES.includes(value as JobStatus)) {
    fail(where);
  }
  return value as JobStatus;
}

function requireNullableString(value: unknown, where: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    fail(where);
  }
  return value;
}

const SCENARIO_KEYS = [
  'income_shares',
  'expense_shares',
  'current_reserve_weights',
  'expense_income_ratio',
  'buffer_months',
  'horizon_years',
  'rebalance_frequency',
  'conversion_cost',
] as const;

function assertScenario(value: unknown): HouseholdAnalysisScenario {
  const obj = requireObject(value, 'scenario');
  assertExactKeys(obj, SCENARIO_KEYS, 'scenario');
  const ratio = requireFinite(obj['expense_income_ratio'], 'scenario.expense_income_ratio');
  requireInRange(ratio, SUPPORTED_EXPENSE_INCOME_RATIO, 'scenario.expense_income_ratio');
  const buffer = requireFinite(obj['buffer_months'], 'scenario.buffer_months');
  requireInRange(buffer, SUPPORTED_BUFFER_MONTHS, 'scenario.buffer_months');
  const horizon = obj['horizon_years'];
  if (
    typeof horizon !== 'number' ||
    !Number.isSafeInteger(horizon) ||
    !SUPPORTED_HORIZON_YEARS.includes(horizon)
  ) {
    fail('scenario.horizon_years');
  }
  const rebalance = obj['rebalance_frequency'];
  if (typeof rebalance !== 'string' || !SUPPORTED_REBALANCE_FREQUENCIES.includes(rebalance)) {
    fail('scenario.rebalance_frequency');
  }
  const cost = requireFinite(obj['conversion_cost'], 'scenario.conversion_cost');
  requireInRange(cost, SUPPORTED_CONVERSION_COST, 'scenario.conversion_cost');
  return {
    income_shares: requireVector(obj['income_shares'], 'scenario.income_shares'),
    expense_shares: requireVector(obj['expense_shares'], 'scenario.expense_shares'),
    current_reserve_weights: requireVector(
      obj['current_reserve_weights'],
      'scenario.current_reserve_weights',
    ),
    expense_income_ratio: ratio,
    buffer_months: buffer,
    horizon_years: horizon,
    rebalance_frequency: rebalance,
    conversion_cost: cost,
  };
}

const PROVENANCE_KEYS = [
  'model_version',
  'data_as_of',
  'dataset_sha256',
  'simulation_paths',
  'simulation_seed',
  'canonical_optimization_specification',
  'fx_path_policy',
] as const;

function assertProvenance(value: unknown): HouseholdAnalysisResult['provenance'] {
  const obj = requireObject(value, 'provenance');
  assertExactKeys(obj, PROVENANCE_KEYS, 'provenance');
  const sha = requireString(obj['dataset_sha256'], 'provenance.dataset_sha256');
  if (!SHA256_RE.test(sha)) {
    fail('provenance.dataset_sha256');
  }
  const paths = requireCount(obj['simulation_paths'], 'provenance.simulation_paths');
  requireLiteral(paths, PRODUCTION_SIMULATION_PATHS, 'provenance.simulation_paths');
  const seed = requireCount(obj['simulation_seed'], 'provenance.simulation_seed');
  requireLiteral(seed, PRODUCTION_SIMULATION_SEED, 'provenance.simulation_seed');
  return {
    model_version: requireString(obj['model_version'], 'provenance.model_version'),
    data_as_of: requireString(obj['data_as_of'], 'provenance.data_as_of'),
    dataset_sha256: sha,
    simulation_paths: paths,
    simulation_seed: seed,
    canonical_optimization_specification: requireString(
      obj['canonical_optimization_specification'],
      'provenance.canonical_optimization_specification',
    ),
    fx_path_policy: requireLiteral(
      obj['fx_path_policy'],
      HOUSEHOLD_FX_PATH_POLICY,
      'provenance.fx_path_policy',
    ),
  };
}

const POLICY_KEYS = [
  'label',
  'weights',
  'objective',
  'diagnostics',
  'implementation_only',
] as const;
const IMPLEMENTATION_KEYS = [
  'mean_cumulative_shortfall',
  'wealth_depletion_probability',
  'mean_terminal_wealth',
  'median_terminal_wealth',
  'p05_terminal_wealth',
  'p95_terminal_wealth',
] as const;

function assertPolicy(
  value: unknown,
  where: string,
  label: string,
  withIdentification: boolean,
): { policy: HouseholdPolicyEvaluation; raw: Record<string, unknown> } {
  const obj = requireObject(value, where);
  assertExactKeys(
    obj,
    withIdentification ? [...POLICY_KEYS, 'identification'] : POLICY_KEYS,
    where,
  );
  requireLiteral(obj['label'], label, `${where}.label`);
  const objective = requireObject(obj['objective'], `${where}.objective`);
  assertExactKeys(objective, ['cvar95_cumulative_shortfall'], `${where}.objective`);
  const diagnostics = requireObject(obj['diagnostics'], `${where}.diagnostics`);
  assertExactKeys(
    diagnostics,
    ['shortfall_probability', 'var95_cumulative_shortfall'],
    `${where}.diagnostics`,
  );
  const impl = requireObject(obj['implementation_only'], `${where}.implementation_only`);
  assertExactKeys(impl, IMPLEMENTATION_KEYS, `${where}.implementation_only`);
  const policy: HouseholdPolicyEvaluation = {
    label,
    weights: requireVector(obj['weights'], `${where}.weights`),
    objective: {
      cvar95_cumulative_shortfall: requireNonNegative(
        objective['cvar95_cumulative_shortfall'],
        `${where}.objective.cvar95`,
      ),
    },
    diagnostics: {
      shortfall_probability: requireProbability(
        diagnostics['shortfall_probability'],
        `${where}.diagnostics.shortfall_probability`,
      ),
      var95_cumulative_shortfall: requireNonNegative(
        diagnostics['var95_cumulative_shortfall'],
        `${where}.diagnostics.var95`,
      ),
    },
    implementation_only: {
      mean_cumulative_shortfall: requireNonNegative(
        impl['mean_cumulative_shortfall'],
        `${where}.implementation_only.mean_cumulative_shortfall`,
      ),
      wealth_depletion_probability: requireProbability(
        impl['wealth_depletion_probability'],
        `${where}.implementation_only.wealth_depletion_probability`,
      ),
      mean_terminal_wealth: requireNonNegative(
        impl['mean_terminal_wealth'],
        `${where}.implementation_only.mean_terminal_wealth`,
      ),
      median_terminal_wealth: requireNonNegative(
        impl['median_terminal_wealth'],
        `${where}.implementation_only.median_terminal_wealth`,
      ),
      p05_terminal_wealth: requireNonNegative(
        impl['p05_terminal_wealth'],
        `${where}.implementation_only.p05_terminal_wealth`,
      ),
      p95_terminal_wealth: requireNonNegative(
        impl['p95_terminal_wealth'],
        `${where}.implementation_only.p95_terminal_wealth`,
      ),
    },
  };
  return { policy, raw: obj };
}

const IDENTIFICATION_KEYS = [
  'applies_to',
  'identification_class',
  'n_coarse',
  'n_refined',
  'n_surface',
  'near_optimal_1pct_count',
  'near_optimal_1pct_frac',
] as const;

function assertIdentification(
  value: unknown,
): HouseholdAnalysisResult['optimized_policy']['identification'] {
  const obj = requireObject(value, 'identification');
  assertExactKeys(obj, IDENTIFICATION_KEYS, 'identification');
  requireLiteral(obj['applies_to'], 'optimization_surface', 'identification.applies_to');
  const cls = obj['identification_class'];
  if (typeof cls !== 'string' || !HOUSEHOLD_IDENTIFICATION_CLASSES.includes(cls)) {
    fail('identification.identification_class');
  }
  const nCoarse = requireCount(obj['n_coarse'], 'identification.n_coarse');
  const nRefined = requireCount(obj['n_refined'], 'identification.n_refined');
  const nSurface = requireCount(obj['n_surface'], 'identification.n_surface');
  const nearCount = requireCount(
    obj['near_optimal_1pct_count'],
    'identification.near_optimal_1pct_count',
  );
  const nearFrac = requireProbability(
    obj['near_optimal_1pct_frac'],
    'identification.near_optimal_1pct_frac',
  );
  if (nCoarse <= 0 || nSurface <= 0 || nSurface > nCoarse + nRefined) {
    fail('identification.surface_counts');
  }
  if (nearCount < 1 || nearCount > nSurface) {
    fail('identification.near_optimal_1pct_count');
  }
  if (Math.abs(nearFrac - nearCount / nSurface) > 1e-12) {
    fail('identification.near_optimal_1pct_frac');
  }
  return {
    applies_to: 'optimization_surface',
    identification_class: cls,
    n_coarse: nCoarse,
    n_refined: nRefined,
    n_surface: nSurface,
    near_optimal_1pct_count: nearCount,
    near_optimal_1pct_frac: nearFrac,
  };
}

const COMPARISON_KEYS = [
  'objective',
  'direction',
  'cvar95_optimized_minus_current',
  'outcome',
  'tie_absolute_tolerance',
  'includes_initial_switching_cost',
] as const;

export function expectedOutcome(delta: number): HouseholdComparisonOutcome {
  if (Math.abs(delta) <= TIE_ABSOLUTE_TOLERANCE) {
    return 'equal_within_tolerance';
  }
  return delta < 0 ? 'optimized_lower' : 'current_lower';
}

function assertComparison(
  value: unknown,
  currentCvar: number,
  optimizedCvar: number,
): HouseholdAnalysisResult['comparison'] {
  const obj = requireObject(value, 'comparison');
  assertExactKeys(obj, COMPARISON_KEYS, 'comparison');
  requireLiteral(obj['objective'], 'cvar95_cumulative_shortfall', 'comparison.objective');
  requireLiteral(obj['direction'], 'lower_is_better', 'comparison.direction');
  requireLiteral(obj['tie_absolute_tolerance'], TIE_ABSOLUTE_TOLERANCE, 'comparison.tie');
  requireLiteral(
    obj['includes_initial_switching_cost'],
    false,
    'comparison.includes_initial_switching_cost',
  );
  const delta = requireFinite(
    obj['cvar95_optimized_minus_current'],
    'comparison.cvar95_optimized_minus_current',
  );
  if (Math.abs(delta - (optimizedCvar - currentCvar)) > DELTA_CONSISTENCY_TOLERANCE) {
    fail('comparison.delta_consistency');
  }
  const outcome = obj['outcome'];
  if (outcome !== expectedOutcome(delta)) {
    fail('comparison.outcome');
  }
  return {
    objective: 'cvar95_cumulative_shortfall',
    direction: 'lower_is_better',
    cvar95_optimized_minus_current: delta,
    outcome: outcome as HouseholdComparisonOutcome,
    tie_absolute_tolerance: TIE_ABSOLUTE_TOLERANCE,
    includes_initial_switching_cost: false,
  };
}

const RESULT_KEYS = [
  'contract_version',
  'engine_interface_version',
  'units',
  'scenario',
  'provenance',
  'current_policy',
  'optimized_policy',
  'comparison',
] as const;

function assertResult(value: unknown): HouseholdAnalysisResult {
  const obj = requireObject(value, 'result');
  assertExactKeys(obj, RESULT_KEYS, 'result');
  requireLiteral(obj['contract_version'], HOUSEHOLD_CONTRACT_VERSION, 'result.contract_version');
  requireLiteral(
    obj['engine_interface_version'],
    HOUSEHOLD_ENGINE_INTERFACE_VERSION,
    'result.engine_interface_version',
  );
  const units = requireObject(obj['units'], 'units');
  assertExactKeys(units, ['cumulative_shortfall', 'terminal_wealth'], 'units');
  requireLiteral(units['cumulative_shortfall'], HOUSEHOLD_UNITS, 'units.cumulative_shortfall');
  requireLiteral(units['terminal_wealth'], HOUSEHOLD_UNITS, 'units.terminal_wealth');

  const scenario = assertScenario(obj['scenario']);
  const provenance = assertProvenance(obj['provenance']);
  const current = assertPolicy(
    obj['current_policy'],
    'current_policy',
    CURRENT_POLICY_LABEL,
    false,
  );
  const optimized = assertPolicy(
    obj['optimized_policy'],
    'optimized_policy',
    OPTIMIZED_POLICY_LABEL,
    true,
  );
  if (!vectorsEqual(current.policy.weights, scenario.current_reserve_weights)) {
    fail('current_policy.weights');
  }
  const identification = assertIdentification(optimized.raw['identification']);
  const comparison = assertComparison(
    obj['comparison'],
    current.policy.objective.cvar95_cumulative_shortfall,
    optimized.policy.objective.cvar95_cumulative_shortfall,
  );
  return {
    contract_version: HOUSEHOLD_CONTRACT_VERSION,
    engine_interface_version: HOUSEHOLD_ENGINE_INTERFACE_VERSION,
    units: { cumulative_shortfall: HOUSEHOLD_UNITS, terminal_wealth: HOUSEHOLD_UNITS },
    scenario,
    provenance,
    current_policy: current.policy,
    optimized_policy: { ...optimized.policy, identification },
    comparison,
  };
}

/** True when the echoed scenario matches the submitted request field for field. */
export function scenarioMatchesRequest(
  scenario: HouseholdAnalysisScenario,
  request: HouseholdAnalysisRequest,
): boolean {
  return (
    request.current_reserve_weights !== null &&
    vectorsEqual(scenario.income_shares, request.income_shares) &&
    vectorsEqual(scenario.expense_shares, request.expense_shares) &&
    vectorsEqual(scenario.current_reserve_weights, request.current_reserve_weights) &&
    scenario.expense_income_ratio === request.expense_income_ratio &&
    scenario.buffer_months === request.buffer_months &&
    scenario.horizon_years === request.horizon_years &&
    scenario.rebalance_frequency === request.rebalance_frequency &&
    scenario.conversion_cost === request.conversion_cost
  );
}

/**
 * Validate a household result. When the submitted request is known (same-tab
 * submission), the echoed scenario must match it exactly.
 */
export function validateHouseholdResult(
  value: unknown,
  request: HouseholdAnalysisRequest | null = null,
): ValidationOutcome<HouseholdAnalysisResult> {
  try {
    const result = assertResult(value);
    if (request !== null && !scenarioMatchesRequest(result.scenario, request)) {
      fail('scenario.echo');
    }
    return { ok: true, value: result };
  } catch {
    return { ok: false, error: householdMalformedError() };
  }
}

const ACCEPTED_KEYS = ['job_id', 'status', 'cached', 'status_url', 'contract_version'] as const;

/**
 * Validate a POST envelope. 202: new or reused queued/running job. 200: cached
 * success (with result) or a reused failed job that exhausted its attempts.
 */
export function validateHouseholdJobAccepted(
  httpStatus: number,
  value: unknown,
): ValidationOutcome<HouseholdJobAccepted> {
  try {
    const obj = requireObject(value, 'accepted');
    const status = requireStatus(obj['status'], 'accepted.status');
    const jobId = requireJobId(obj['job_id'], 'accepted.job_id');
    requireLiteral(
      obj['contract_version'],
      HOUSEHOLD_CONTRACT_VERSION,
      'accepted.contract_version',
    );
    requireLiteral(obj['status_url'], householdStatusUrl(jobId), 'accepted.status_url');
    const cached = obj['cached'];
    if (typeof cached !== 'boolean') {
      fail('accepted.cached');
    }
    const body: HouseholdJobAccepted = {
      job_id: jobId,
      status,
      cached,
      status_url: householdStatusUrl(jobId),
      contract_version: HOUSEHOLD_CONTRACT_VERSION,
    };
    if (httpStatus === 202) {
      assertExactKeys(obj, ACCEPTED_KEYS, 'accepted');
      if (cached || (status !== 'queued' && status !== 'running')) {
        fail('accepted.202');
      }
      return { ok: true, value: body };
    }
    if (httpStatus === 200 && status === 'succeeded') {
      assertExactKeys(obj, [...ACCEPTED_KEYS, 'result'], 'accepted');
      if (!cached) {
        fail('accepted.cached');
      }
      body.result = assertResult(obj['result']);
      return { ok: true, value: body };
    }
    if (httpStatus === 200 && status === 'failed') {
      assertExactKeys(obj, [...ACCEPTED_KEYS, 'error_code', 'error_message'], 'accepted');
      if (cached) {
        fail('accepted.cached');
      }
      body.error_code = requireNullableString(obj['error_code'], 'accepted.error_code');
      body.error_message = requireNullableString(obj['error_message'], 'accepted.error_message');
      return { ok: true, value: body };
    }
    fail('accepted.http_status');
  } catch {
    return { ok: false, error: householdMalformedError() };
  }
}

const STATUS_BASE_KEYS = [
  'job_id',
  'status',
  'created_at',
  'started_at',
  'contract_version',
] as const;

/** Validate a GET envelope, including its association with the requested job id. */
export function validateHouseholdJobStatus(
  value: unknown,
  expectedJobId: string,
): ValidationOutcome<HouseholdJobStatus> {
  try {
    const obj = requireObject(value, 'status');
    const jobId = requireJobId(obj['job_id'], 'status.job_id');
    if (jobId.toLowerCase() !== expectedJobId.toLowerCase()) {
      fail('status.job_id_mismatch');
    }
    const status = requireStatus(obj['status'], 'status.status');
    requireLiteral(obj['contract_version'], HOUSEHOLD_CONTRACT_VERSION, 'status.contract_version');
    const body: HouseholdJobStatus = {
      job_id: jobId,
      status,
      created_at: requireString(obj['created_at'], 'status.created_at'),
      started_at: requireNullableString(obj['started_at'], 'status.started_at'),
      contract_version: HOUSEHOLD_CONTRACT_VERSION,
    };
    if (status === 'queued' || status === 'running') {
      assertExactKeys(obj, STATUS_BASE_KEYS, 'status', ['completed_at']);
    } else if (status === 'succeeded') {
      assertExactKeys(obj, [...STATUS_BASE_KEYS, 'result'], 'status', ['completed_at']);
      body.result = assertResult(obj['result']);
    } else {
      assertExactKeys(obj, [...STATUS_BASE_KEYS, 'error_code', 'error_message'], 'status', [
        'completed_at',
      ]);
      body.error_code = requireNullableString(obj['error_code'], 'status.error_code');
      body.error_message = requireNullableString(obj['error_message'], 'status.error_message');
    }
    if ('completed_at' in obj) {
      body.completed_at = requireString(obj['completed_at'], 'status.completed_at');
    }
    return { ok: true, value: body };
  } catch {
    return { ok: false, error: householdMalformedError() };
  }
}

/** Validate 422 unsupported_scenario reasons; returns null when the shape is unexpected. */
export function parseUnsupportedReasons(value: unknown): HouseholdUnsupportedReason[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const reasons: HouseholdUnsupportedReason[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) {
      return null;
    }
    const supported = item['supported'];
    if (
      typeof item['code'] !== 'string' ||
      typeof item['field'] !== 'string' ||
      !isPlainObject(supported) ||
      typeof supported['min'] !== 'number' ||
      typeof supported['max'] !== 'number' ||
      !Number.isFinite(supported['min']) ||
      !Number.isFinite(supported['max'])
    ) {
      return null;
    }
    reasons.push({
      code: item['code'],
      field: item['field'],
      supported: { min: supported['min'], max: supported['max'] },
    });
  }
  return reasons;
}
