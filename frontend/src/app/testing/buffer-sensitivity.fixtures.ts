import type {
  BufferSensitivityJobAccepted,
  BufferSensitivityJobStatus,
  BufferSensitivityResult,
  BufferSensitivityResultRow,
} from '../core/api/models';
import {
  BUFFER_SENSITIVITY_CONTRACT_VERSION,
  BUFFER_SENSITIVITY_PRESENTATION_VERSION,
} from '../core/api/buffer-sensitivity.validation';
import { OPTIMIZATION_RESULT, TEST_JOB_ID } from './fixtures';

/** Separate id so batch tests never collide with single-job fixtures. */
export const TEST_BATCH_JOB_ID = 'c3a91e2b-4d55-4f10-9a77-1e8c0b2d6f44';

function row(
  bufferMonths: number,
  overrides: Partial<BufferSensitivityResultRow> = {},
): BufferSensitivityResultRow {
  return {
    buffer_months: bufferMonths,
    weights: [0.55, 0.3, 0.15],
    shortfall_probability: 0.12,
    cvar95_cumulative_shortfall: 1.4,
    var95_cumulative_shortfall: 0.7,
    identification_class: 'A_WELL_IDENTIFIED',
    near_optimal_1pct_frac: 0.02,
    near_optimal_1pct_count: 12,
    n_coarse: 100,
    n_refined: 40,
    n_surface: 140,
    implementation_only: {
      mean_cumulative_shortfall: 0.08,
      wealth_depletion_probability: 0.03,
      mean_terminal_wealth: 1.1,
      median_terminal_wealth: 1.05,
      p05_terminal_wealth: 0.7,
      p95_terminal_wealth: 1.5,
    },
    ...overrides,
  };
}

/** Noncanonical batch payload used only in frontend tests. */
export const BUFFER_SENSITIVITY_RESULT: BufferSensitivityResult = {
  contract_version: BUFFER_SENSITIVITY_CONTRACT_VERSION,
  presentation_version: BUFFER_SENSITIVITY_PRESENTATION_VERSION,
  tested_buffers: [1, 3, 6, 12],
  units: {
    cumulative_shortfall: 'months_of_initial_monthly_income_I0_equals_1',
  },
  provenance: {
    model_version: '1.0.0',
    data_as_of: '2024-06-15',
    dataset_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    simulation_paths: 10000,
    simulation_seed: 42,
    canonical_optimization_specification: 'test-spec-noncanonical',
    fx_path_policy: 'deterministic_regeneration_per_public_optimize_call',
  },
  scenario: {
    profile: OPTIMIZATION_RESULT.profile,
    horizon_years: OPTIMIZATION_RESULT.horizon_years,
    expense_income_ratio: OPTIMIZATION_RESULT.expense_income_ratio,
    rebalance_frequency: OPTIMIZATION_RESULT.rebalance_frequency,
    conversion_cost: OPTIMIZATION_RESULT.conversion_cost,
  },
  results: [
    row(1, {
      weights: [0.5, 0.35, 0.15],
      shortfall_probability: 0.18,
      cvar95_cumulative_shortfall: 2.1,
      var95_cumulative_shortfall: 1.0,
      implementation_only: {
        mean_cumulative_shortfall: 0.11,
        wealth_depletion_probability: 0.05,
        mean_terminal_wealth: 1.0,
        median_terminal_wealth: 0.98,
        p05_terminal_wealth: 0.55,
        p95_terminal_wealth: 1.4,
      },
    }),
    row(3, {
      weights: [0.58, 0.28, 0.14],
      shortfall_probability: 0.1,
      cvar95_cumulative_shortfall: 1.2,
      var95_cumulative_shortfall: 0.55,
      implementation_only: {
        mean_cumulative_shortfall: 0.06,
        wealth_depletion_probability: 0.02,
        mean_terminal_wealth: 1.08,
        median_terminal_wealth: 1.04,
        p05_terminal_wealth: 0.68,
        p95_terminal_wealth: 1.48,
      },
    }),
    row(6, {
      weights: [0.62, 0.25, 0.13],
      shortfall_probability: 0.06,
      cvar95_cumulative_shortfall: 0.8,
      var95_cumulative_shortfall: 0.3,
      implementation_only: {
        mean_cumulative_shortfall: 0.04,
        wealth_depletion_probability: 0.01,
        mean_terminal_wealth: 1.15,
        median_terminal_wealth: 1.1,
        p05_terminal_wealth: 0.75,
        p95_terminal_wealth: 1.55,
      },
    }),
    row(12, {
      weights: [0.7, 0.2, 0.1],
      shortfall_probability: 0.03,
      cvar95_cumulative_shortfall: 0.45,
      var95_cumulative_shortfall: 0.1,
      implementation_only: {
        mean_cumulative_shortfall: 0.02,
        wealth_depletion_probability: 0.005,
        mean_terminal_wealth: 1.22,
        median_terminal_wealth: 1.18,
        p05_terminal_wealth: 0.85,
        p95_terminal_wealth: 1.6,
      },
    }),
  ],
};

export const QUEUED_BATCH_JOB: BufferSensitivityJobAccepted = {
  job_id: TEST_BATCH_JOB_ID,
  status: 'queued',
  cached: false,
  status_url: `/api/v1/buffer-sensitivity-jobs/${TEST_BATCH_JOB_ID}/`,
  contract_version: BUFFER_SENSITIVITY_CONTRACT_VERSION,
  tested_buffers: [1, 3, 6, 12],
};

export const CACHED_BATCH_JOB: BufferSensitivityJobAccepted = {
  job_id: TEST_BATCH_JOB_ID,
  status: 'succeeded',
  cached: true,
  status_url: `/api/v1/buffer-sensitivity-jobs/${TEST_BATCH_JOB_ID}/`,
  contract_version: BUFFER_SENSITIVITY_CONTRACT_VERSION,
  tested_buffers: [1, 3, 6, 12],
  result: BUFFER_SENSITIVITY_RESULT,
};

export function batchJobStatus(
  status: BufferSensitivityJobStatus['status'],
  overrides: Partial<BufferSensitivityJobStatus> = {},
): BufferSensitivityJobStatus {
  return {
    job_id: TEST_BATCH_JOB_ID,
    status,
    created_at: '2026-09-12T12:00:00Z',
    started_at: status === 'queued' ? null : '2026-09-12T12:00:01Z',
    contract_version: BUFFER_SENSITIVITY_CONTRACT_VERSION,
    tested_buffers: [1, 3, 6, 12],
    ...overrides,
  };
}

export { TEST_JOB_ID };
