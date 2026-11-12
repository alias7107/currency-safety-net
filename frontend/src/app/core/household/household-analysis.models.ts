import type { ApiError, JobStatus } from '../api/models';

export const HOUSEHOLD_CONTRACT_VERSION = 'household_analysis_v1';
export const HOUSEHOLD_ENGINE_INTERFACE_VERSION = 'personal_analysis_engine_v1';
export const HOUSEHOLD_UNITS = 'months_of_initial_monthly_income_I0_equals_1';
export const HOUSEHOLD_FX_PATH_POLICY = 'single_bundle_shared_by_both_policies';
export const CURRENT_POLICY_LABEL = 'current_mix_under_selected_rebalancing';
export const OPTIMIZED_POLICY_LABEL = 'lowest_cvar95_found_on_evaluated_grid';

/** Same rule as HouseholdProfile: sum computed as (v0 + v1) + v2. */
export const SHARE_SUM_TOLERANCE = 1e-12;
/** Absolute tie tolerance for the CVaR95 comparison (engine OPT_CVAR_ZERO_TOL). */
export const TIE_ABSOLUTE_TOLERANCE = 1e-8;
/** Backend delta-consistency tolerance. */
export const DELTA_CONSISTENCY_TOLERANCE = 1e-15;

/** Initial supported simulation domain (inclusive), from the backend contract. */
export const SUPPORTED_EXPENSE_INCOME_RATIO = { min: 0.8, max: 1.05 } as const;
export const SUPPORTED_BUFFER_MONTHS = { min: 1, max: 12 } as const;
export const SUPPORTED_CONVERSION_COST = { min: 0, max: 0.01 } as const;
export const SUPPORTED_HORIZON_YEARS: readonly number[] = [1, 3, 5];
export const SUPPORTED_REBALANCE_FREQUENCIES: readonly string[] = ['monthly', 'quarterly', 'none'];

export const PRODUCTION_SIMULATION_PATHS = 10_000;
export const PRODUCTION_SIMULATION_SEED = 42;

export const HOUSEHOLD_IDENTIFICATION_CLASSES: readonly string[] = [
  'A_WELL_IDENTIFIED',
  'B_WEAKLY_IDENTIFIED',
  'C_NOT_IDENTIFIED',
];

export type HouseholdVector = [number, number, number];

/** Exactly the contracted POST body; nothing else may leave the browser. */
export interface HouseholdAnalysisRequest {
  contract_version: typeof HOUSEHOLD_CONTRACT_VERSION;
  income_shares: HouseholdVector;
  expense_shares: HouseholdVector;
  current_reserve_weights: HouseholdVector | null;
  expense_income_ratio: number;
  buffer_months: number;
  horizon_years: number;
  rebalance_frequency: string;
  conversion_cost: number;
}

export interface HouseholdAnalysisScenario {
  income_shares: HouseholdVector;
  expense_shares: HouseholdVector;
  current_reserve_weights: HouseholdVector;
  expense_income_ratio: number;
  buffer_months: number;
  horizon_years: number;
  rebalance_frequency: string;
  conversion_cost: number;
}

export interface HouseholdProvenance {
  model_version: string;
  data_as_of: string;
  dataset_sha256: string;
  simulation_paths: number;
  simulation_seed: number;
  canonical_optimization_specification: string;
  fx_path_policy: typeof HOUSEHOLD_FX_PATH_POLICY;
}

export interface HouseholdPolicyEvaluation {
  label: string;
  weights: HouseholdVector;
  objective: { cvar95_cumulative_shortfall: number };
  diagnostics: { shortfall_probability: number; var95_cumulative_shortfall: number };
  implementation_only: {
    mean_cumulative_shortfall: number;
    wealth_depletion_probability: number;
    mean_terminal_wealth: number;
    median_terminal_wealth: number;
    p05_terminal_wealth: number;
    p95_terminal_wealth: number;
  };
}

export interface HouseholdIdentification {
  applies_to: 'optimization_surface';
  identification_class: string;
  n_coarse: number;
  n_refined: number;
  n_surface: number;
  near_optimal_1pct_count: number;
  near_optimal_1pct_frac: number;
}

export type HouseholdComparisonOutcome =
  'optimized_lower' | 'current_lower' | 'equal_within_tolerance';

export interface HouseholdComparison {
  objective: 'cvar95_cumulative_shortfall';
  direction: 'lower_is_better';
  cvar95_optimized_minus_current: number;
  outcome: HouseholdComparisonOutcome;
  tie_absolute_tolerance: number;
  includes_initial_switching_cost: false;
}

export interface HouseholdAnalysisResult {
  contract_version: typeof HOUSEHOLD_CONTRACT_VERSION;
  engine_interface_version: typeof HOUSEHOLD_ENGINE_INTERFACE_VERSION;
  units: { cumulative_shortfall: string; terminal_wealth: string };
  scenario: HouseholdAnalysisScenario;
  provenance: HouseholdProvenance;
  current_policy: HouseholdPolicyEvaluation;
  optimized_policy: HouseholdPolicyEvaluation & { identification: HouseholdIdentification };
  comparison: HouseholdComparison;
}

/** POST 202/200 envelope. */
export interface HouseholdJobAccepted {
  job_id: string;
  status: JobStatus;
  cached: boolean;
  status_url: string;
  contract_version: string;
  result?: HouseholdAnalysisResult;
  error_code?: string | null;
  error_message?: string | null;
}

/** GET envelope. */
export interface HouseholdJobStatus {
  job_id: string;
  status: JobStatus;
  created_at: string;
  started_at: string | null;
  contract_version: string;
  completed_at?: string;
  result?: HouseholdAnalysisResult;
  error_code?: string | null;
  error_message?: string | null;
}

export interface HouseholdUnsupportedReason {
  code: string;
  field: string;
  supported: { min: number; max: number };
}

/** Normalized error with the household-specific distinctions preserved. */
export interface HouseholdApiError extends ApiError {
  /** Present for 503 queue_unavailable: the failed job row kept for retry. */
  failedJobId?: string;
  /** Seconds from a valid Retry-After header. */
  retryAfterSeconds?: number;
  /** Validated 422 unsupported_scenario reasons. */
  reasons?: HouseholdUnsupportedReason[];
}

export interface HouseholdJobSubmission {
  httpStatus: number;
  body: HouseholdJobAccepted;
}
