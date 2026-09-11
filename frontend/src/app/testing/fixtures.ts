import type {
  ModelMetadata,
  ModelOptions,
  OptimizationJobAccepted,
  OptimizationJobStatus,
  OptimizationResult,
} from '../core/api/models';

/**
 * Deterministic API payloads for unit tests.
 *
 * These stand in for the Django responses so that no test ever reaches the real
 * optimizer. The numbers are intentionally arbitrary rather than the canonical
 * research values, so that a test failure cannot be masked by a UI that
 * happens to hard-code the published result.
 */

export const TEST_JOB_ID = '8b1f0d1c-6b21-4d0e-9f26-4f2b1c0d5e7a';

export const MODEL_METADATA: ModelMetadata = {
  model_version: '1.0.0',
  data_as_of: '2025-12-31',
  baseline_estimation_period: { start: '2015-08-20', end: '2025-12-31' },
  supported_currencies: ['KZT', 'USD', 'EUR'],
  supported_horizons_years: [1, 3, 5],
  supported_profiles: [
    { id: 'P1', name: 'P1_local_control', description: 'Local income and expenses in KZT.' },
    { id: 'P2', name: 'P2_foreign_income_mismatch', description: 'USD income with KZT expenses.' },
    { id: 'P3', name: 'P3_mixed_income', description: 'Mixed KZT/USD income.' },
    { id: 'P4', name: 'P4_full_multi_currency', description: 'Multi-currency income.' },
  ],
  simulation_method: 'joint stationary bootstrap SB20',
  simulation_paths: 10000,
  simulation_seed: 42,
  risk_metric_names: [
    'shortfall_probability',
    'var95_cumulative_shortfall',
    'cvar95_cumulative_shortfall',
    'mean_cumulative_shortfall',
  ],
  dataset_sha256: 'def1997c9bac432d918772c31b78a12632e50674353ecc0ed0ba2e7e3f25c494',
  canonical_optimization_specification: 'Phase 2C grid-integrity corrected',
  baseline_defaults: {
    expense_income_ratio: 0.95,
    buffer_months: 1,
    rebalance_frequency: 'monthly',
    conversion_cost: 0.0,
  },
};

export const MODEL_OPTIONS: ModelOptions = {
  profiles: MODEL_METADATA.supported_profiles,
  horizons_years: [1, 3, 5],
  expense_income_ratio: { min: 0.8, max: 1.05, default: 0.95, documented_values: [0.8, 0.95, 1.05] },
  buffer_months: { min: 1, max: 12, default: 1, documented_values: [1, 3, 6, 12] },
  rebalance_frequencies: ['monthly', 'quarterly', 'none'],
  conversion_cost: { min: 0, max: 0.01, default: 0, documented_values: [0, 0.0025, 0.005, 0.01] },
  currencies: ['KZT', 'USD', 'EUR'],
};

/** Deliberately a three-way split so a legend bug cannot hide behind 100/0/0. */
export const OPTIMIZATION_RESULT: OptimizationResult = {
  model_version: '1.0.0',
  data_as_of: '2025-12-31',
  simulation_paths: 10000,
  simulation_seed: 42,
  profile: 'P2_foreign_income_mismatch',
  horizon_years: 3,
  expense_income_ratio: 0.95,
  buffer_months: 1,
  rebalance_frequency: 'monthly',
  conversion_cost: 0,
  weights: [0.62, 0.27, 0.11],
  shortfall_probability: 0.0734,
  var95_cumulative_shortfall: 0.4213,
  cvar95_cumulative_shortfall: 0.8642,
  mean_cumulative_shortfall: 0.0521,
  wealth_depletion_probability: 0.0125,
  mean_terminal_wealth: 1.02,
  median_terminal_wealth: 1.01,
  p05_terminal_wealth: 0.61,
  p95_terminal_wealth: 1.44,
  identification_class: 'A_WELL_IDENTIFIED',
  n_coarse: 1275,
  n_refined: 184,
  n_surface: 1459,
  near_optimal_1pct_frac: 0.021,
  near_optimal_1pct_count: 31,
};

export const QUEUED_JOB: OptimizationJobAccepted = {
  job_id: TEST_JOB_ID,
  status: 'queued',
  cached: false,
  status_url: `/api/v1/optimization-jobs/${TEST_JOB_ID}/`,
};

export const CACHED_JOB: OptimizationJobAccepted = {
  job_id: TEST_JOB_ID,
  status: 'succeeded',
  cached: true,
  status_url: `/api/v1/optimization-jobs/${TEST_JOB_ID}/`,
  result: OPTIMIZATION_RESULT,
};

export function jobStatus(
  status: OptimizationJobStatus['status'],
  overrides: Partial<OptimizationJobStatus> = {},
): OptimizationJobStatus {
  return {
    job_id: TEST_JOB_ID,
    status,
    created_at: '2026-09-10T12:00:00Z',
    started_at: status === 'queued' ? null : '2026-09-10T12:00:01Z',
    ...overrides,
  };
}

export function errorBody(code: string, message: string, details?: unknown) {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}
