import type {
  HouseholdAnalysisRequest,
  HouseholdComparisonOutcome,
} from '../core/household/household-analysis.models';
import { expectedOutcome } from '../core/household/household-analysis.validation';

export const TEST_HOUSEHOLD_JOB_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
export const OTHER_HOUSEHOLD_JOB_ID = '9b2f1a4e-3c5d-4e6f-8a7b-1c2d3e4f5a6b';
export const HOUSEHOLD_JOBS_URL = '/api/v1/household-analysis-jobs/';

export function householdJobUrl(jobId: string = TEST_HOUSEHOLD_JOB_ID): string {
  return `${HOUSEHOLD_JOBS_URL}${jobId}/`;
}

export const HOUSEHOLD_REQUEST: HouseholdAnalysisRequest = {
  contract_version: 'household_analysis_v1',
  income_shares: [0.6, 0.4, 0],
  expense_shares: [0.75, 0.25, 0],
  current_reserve_weights: [0.5, 0.25, 0.25],
  expense_income_ratio: 0.9,
  buffer_months: 3,
  horizon_years: 3,
  rebalance_frequency: 'quarterly',
  conversion_cost: 0.0025,
};

const CVAR_BY_OUTCOME: Record<HouseholdComparisonOutcome, { current: number; optimized: number }> =
  {
    optimized_lower: { current: 0.42, optimized: 0.31 },
    current_lower: { current: 0.28, optimized: 0.33 },
    equal_within_tolerance: { current: 0.42, optimized: 0.420000004 },
  };

function policy(
  label: string,
  weights: [number, number, number],
  cvar: number,
): Record<string, unknown> {
  return {
    label,
    weights,
    objective: { cvar95_cumulative_shortfall: cvar },
    diagnostics: { shortfall_probability: 0.12, var95_cumulative_shortfall: 0.2 },
    implementation_only: {
      mean_cumulative_shortfall: 0.05,
      wealth_depletion_probability: 0.03,
      mean_terminal_wealth: 6.4,
      median_terminal_wealth: 6.1,
      p05_terminal_wealth: 2.2,
      p95_terminal_wealth: 11.5,
    },
  };
}

/** A plain JSON result object, as it would arrive over the wire. */
export function householdResult(
  outcome: HouseholdComparisonOutcome = 'optimized_lower',
  request: HouseholdAnalysisRequest = HOUSEHOLD_REQUEST,
): Record<string, any> {
  const { contract_version: _version, ...scenario } = request;
  const weights = request.current_reserve_weights!;
  const { current, optimized } = CVAR_BY_OUTCOME[outcome];
  const delta = optimized - current;
  if (expectedOutcome(delta) !== outcome) {
    throw new Error('fixture outcome mismatch');
  }
  return JSON.parse(
    JSON.stringify({
      contract_version: 'household_analysis_v1',
      engine_interface_version: 'personal_analysis_engine_v1',
      units: {
        cumulative_shortfall: 'months_of_initial_monthly_income_I0_equals_1',
        terminal_wealth: 'months_of_initial_monthly_income_I0_equals_1',
      },
      scenario,
      provenance: {
        model_version: '1.0.0',
        data_as_of: '2025-12-31',
        dataset_sha256: 'a'.repeat(64),
        simulation_paths: 10000,
        simulation_seed: 42,
        canonical_optimization_specification: 'synthetic-test-specification',
        fx_path_policy: 'single_bundle_shared_by_both_policies',
      },
      current_policy: policy('current_mix_under_selected_rebalancing', weights, current),
      optimized_policy: {
        ...policy('lowest_cvar95_found_on_evaluated_grid', [0.3, 0.5, 0.2], optimized),
        identification: {
          applies_to: 'optimization_surface',
          identification_class: 'B_WEAKLY_IDENTIFIED',
          n_coarse: 66,
          n_refined: 40,
          n_surface: 100,
          near_optimal_1pct_count: 8,
          near_optimal_1pct_frac: 0.08,
        },
      },
      comparison: {
        objective: 'cvar95_cumulative_shortfall',
        direction: 'lower_is_better',
        cvar95_optimized_minus_current: delta,
        outcome,
        tie_absolute_tolerance: 1e-8,
        includes_initial_switching_cost: false,
      },
    }),
  );
}

export function householdAccepted(
  overrides: Record<string, unknown> = {},
  jobId: string = TEST_HOUSEHOLD_JOB_ID,
): Record<string, unknown> {
  return {
    job_id: jobId,
    status: 'queued',
    cached: false,
    status_url: householdJobUrl(jobId),
    contract_version: 'household_analysis_v1',
    ...overrides,
  };
}

export function householdJobStatus(
  status: 'queued' | 'running' | 'succeeded' | 'failed',
  extra: Record<string, unknown> = {},
  jobId: string = TEST_HOUSEHOLD_JOB_ID,
): Record<string, unknown> {
  return {
    job_id: jobId,
    status,
    created_at: '2026-11-10T10:00:00Z',
    started_at: status === 'queued' ? null : '2026-11-10T10:00:05Z',
    contract_version: 'household_analysis_v1',
    ...(status === 'succeeded' || status === 'failed'
      ? { completed_at: '2026-11-10T10:02:00Z' }
      : {}),
    ...extra,
  };
}
