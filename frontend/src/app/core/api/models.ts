/**
 * Wire types for the Currency Safety Net API.
 *
 * Field names deliberately mirror the Django/DRF payloads (snake_case) so that
 * responses can be consumed without a translation layer.
 */

export type CurrencyCode = 'KZT' | 'USD' | 'EUR';

export type ProfileId = 'P1' | 'P2' | 'P3' | 'P4';

export type RebalanceFrequency = 'monthly' | 'quarterly' | 'none' | string;

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type IdentificationClass = 'A_WELL_IDENTIFIED' | string;

export interface HouseholdProfileOption {
  id: ProfileId | string;
  name: string;
  description: string;
}

export interface NumericOption {
  min: number;
  max: number;
  default: number;
  documented_values: number[];
}

export interface EstimationPeriod {
  start: string | null;
  end: string | null;
}

export interface BaselineDefaults {
  expense_income_ratio: number | null;
  buffer_months: number | null;
  rebalance_frequency: RebalanceFrequency | null;
  conversion_cost: number | null;
}

/** GET /api/v1/model/metadata/ */
export interface ModelMetadata {
  model_version: string;
  data_as_of: string;
  baseline_estimation_period: EstimationPeriod;
  supported_currencies: CurrencyCode[];
  supported_horizons_years: number[];
  supported_profiles: HouseholdProfileOption[];
  simulation_method: string | null;
  simulation_paths: number;
  simulation_seed: number;
  risk_metric_names: string[];
  dataset_sha256: string;
  canonical_optimization_specification: string | null;
  baseline_defaults: BaselineDefaults;
}

/** GET /api/v1/model/options/ */
export interface ModelOptions {
  profiles: HouseholdProfileOption[];
  horizons_years: number[];
  expense_income_ratio: NumericOption;
  buffer_months: NumericOption;
  rebalance_frequencies: RebalanceFrequency[];
  conversion_cost: NumericOption;
  currencies: CurrencyCode[];
}

/** POST /api/v1/optimization-jobs/ request body. */
export interface OptimizationRequest {
  profile: ProfileId | string;
  horizon_years: number;
  expense_income_ratio: number;
  buffer_months: number;
  rebalance_frequency: RebalanceFrequency;
  conversion_cost: number;
}

/**
 * Model output for one scenario. Every displayed number originates here; the UI
 * never derives or hard-codes allocation weights or risk metrics.
 */
export interface OptimizationResult {
  model_version: string;
  data_as_of: string;
  simulation_paths: number;
  simulation_seed: number;

  profile: string;
  horizon_years: number;
  expense_income_ratio: number;
  buffer_months: number;
  rebalance_frequency: RebalanceFrequency;
  conversion_cost: number;

  /** Ordered [KZT, USD, EUR]; sums to 1. */
  weights: number[];

  shortfall_probability: number;
  var95_cumulative_shortfall: number;
  cvar95_cumulative_shortfall: number;
  mean_cumulative_shortfall: number;
  wealth_depletion_probability: number;

  mean_terminal_wealth?: number;
  median_terminal_wealth?: number;
  p05_terminal_wealth?: number;
  p95_terminal_wealth?: number;

  identification_class?: IdentificationClass;
  n_coarse?: number;
  n_refined?: number;
  n_surface?: number;
  near_optimal_1pct_frac?: number;
  near_optimal_1pct_count?: number;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

/** POST /api/v1/optimization-jobs/ response (202 queued, or 200 when cached). */
export interface OptimizationJobAccepted {
  job_id: string;
  status: JobStatus;
  cached: boolean;
  status_url: string;
  result?: OptimizationResult;
  error?: ApiErrorBody;
  error_code?: string | null;
  error_message?: string | null;
}

/** GET /api/v1/optimization-jobs/{jobId}/ response. */
export interface OptimizationJobStatus {
  job_id: string;
  status: JobStatus;
  created_at: string;
  started_at: string | null;
  completed_at?: string | null;
  result?: OptimizationResult;
  error_code?: string | null;
  error_message?: string | null;
}

/** Normalized error shape used by every UI error surface. */
export interface ApiError {
  /** HTTP status, or 0 for transport/network failures. */
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/** POST /api/v1/buffer-sensitivity-jobs/ request — never includes buffer_months. */
export interface BufferSensitivityRequest {
  profile: ProfileId | string;
  horizon_years: number;
  expense_income_ratio: number;
  rebalance_frequency: RebalanceFrequency;
  conversion_cost: number;
}

export interface BufferSensitivityUnits {
  cumulative_shortfall: string;
}

export interface BufferSensitivityProvenance {
  model_version: string;
  data_as_of: string;
  dataset_sha256: string;
  simulation_paths: number;
  simulation_seed: number;
  canonical_optimization_specification: string;
  fx_path_policy: string;
}

export interface BufferSensitivityScenario {
  profile: string;
  horizon_years: number;
  expense_income_ratio: number;
  rebalance_frequency: RebalanceFrequency;
  conversion_cost: number;
}

export interface BufferSensitivityImplementationOnly {
  mean_cumulative_shortfall: number;
  wealth_depletion_probability: number;
  mean_terminal_wealth: number;
  median_terminal_wealth: number;
  p05_terminal_wealth: number;
  p95_terminal_wealth: number;
}

/** One tested-buffer row inside buffer_sensitivity_batch_v1. */
export interface BufferSensitivityResultRow {
  buffer_months: number;
  /** Ordered [KZT, USD, EUR]; sums to 1. */
  weights: number[];
  shortfall_probability: number;
  cvar95_cumulative_shortfall: number;
  var95_cumulative_shortfall: number;
  identification_class: IdentificationClass;
  near_optimal_1pct_frac: number;
  near_optimal_1pct_count: number;
  n_coarse: number;
  n_refined: number;
  n_surface: number;
  implementation_only: BufferSensitivityImplementationOnly;
}

/** Complete succeeded batch payload (contract buffer_sensitivity_batch_v1). */
export interface BufferSensitivityResult {
  contract_version: string;
  presentation_version: string;
  tested_buffers: number[];
  units: BufferSensitivityUnits;
  provenance: BufferSensitivityProvenance;
  scenario: BufferSensitivityScenario;
  results: BufferSensitivityResultRow[];
}

/** POST /api/v1/buffer-sensitivity-jobs/ response (202 queued, or 200 when cached). */
export interface BufferSensitivityJobAccepted {
  job_id: string;
  status: JobStatus;
  cached: boolean;
  status_url: string;
  contract_version: string;
  tested_buffers: number[];
  result?: BufferSensitivityResult;
  error?: ApiErrorBody;
  error_code?: string | null;
  error_message?: string | null;
}

/** GET /api/v1/buffer-sensitivity-jobs/{jobId}/ response. */
export interface BufferSensitivityJobStatus {
  job_id: string;
  status: JobStatus;
  created_at: string;
  started_at: string | null;
  completed_at?: string | null;
  contract_version: string;
  tested_buffers: number[];
  result?: BufferSensitivityResult;
  error_code?: string | null;
  error_message?: string | null;
}
