import { firstInvalidStep } from '../assessment/assessment-normalization';
import type { AssessmentEvaluation } from '../assessment/assessment.model';
import {
  HOUSEHOLD_CONTRACT_VERSION,
  SUPPORTED_BUFFER_MONTHS,
  SUPPORTED_CONVERSION_COST,
  SUPPORTED_EXPENSE_INCOME_RATIO,
  SUPPORTED_HORIZON_YEARS,
  SUPPORTED_REBALANCE_FREQUENCIES,
  type HouseholdAnalysisRequest,
  type HouseholdVector,
} from './household-analysis.models';
import { isValidShareVector } from './household-analysis.validation';

/** Questionnaire step indices used for "edit" links. */
export const STEP_SITUATION = 0;
export const STEP_CASHFLOWS = 1;
export const STEP_RESERVE = 2;
export const STEP_SETTINGS = 3;

export type SimulationIneligibilityCode =
  | 'answers_incomplete'
  | 'share_vector_invalid'
  | 'model_settings_unavailable'
  | 'rebalance_frequency_not_selected'
  | 'rebalance_frequency_unsupported'
  | 'conversion_cost_not_selected'
  | 'horizon_unsupported'
  | 'expense_income_ratio_out_of_supported_range'
  | 'no_current_reserve'
  | 'buffer_months_out_of_supported_range'
  | 'conversion_cost_out_of_supported_range';

export interface SimulationIneligibilityReason {
  code: SimulationIneligibilityCode;
  /** Questionnaire step that holds the relevant answer. */
  step: number;
}

export interface SimulationEligibility {
  eligible: boolean;
  reasons: SimulationIneligibilityReason[];
  /** Present only when eligible. */
  request: HouseholdAnalysisRequest | null;
}

/** Steps for server-side 422 reason fields. */
export function stepForReasonField(field: string): number {
  switch (field) {
    case 'expense_income_ratio':
      return STEP_CASHFLOWS;
    case 'buffer_months':
    case 'current_reserve_weights':
      return STEP_RESERVE;
    case 'conversion_cost':
    case 'rebalance_frequency':
    case 'horizon_years':
      return STEP_SETTINGS;
    default:
      return STEP_SITUATION;
  }
}

function inRange(value: number, range: { min: number; max: number }): boolean {
  return Number.isFinite(value) && value >= range.min && value <= range.max;
}

/* Inclusive checks on unrounded values, shared by eligibility and inline feedback. */

export function isExpenseIncomeRatioSupported(ratio: number): boolean {
  return inRange(ratio, SUPPORTED_EXPENSE_INCOME_RATIO);
}

export function isBufferMonthsSupported(months: number): boolean {
  return inRange(months, SUPPORTED_BUFFER_MONTHS);
}

export function isConversionCostSupported(cost: number): boolean {
  return inRange(cost, SUPPORTED_CONVERSION_COST);
}

export function isRebalanceFrequencySupported(value: string): boolean {
  return SUPPORTED_REBALANCE_FREQUENCIES.includes(value);
}

export function isHorizonSupported(years: number): boolean {
  return SUPPORTED_HORIZON_YEARS.includes(years);
}

function copyVector(v: HouseholdVector): HouseholdVector {
  return [v[0], v[1], v[2]];
}

/**
 * Lists every reason the current answers cannot be simulated. A valid
 * arithmetic overview can still be ineligible (for example, zero reserve).
 */
export function evaluateSimulationEligibility(
  evaluation: AssessmentEvaluation,
): SimulationEligibility {
  const reasons: SimulationIneligibilityReason[] = [];
  const add = (code: SimulationIneligibilityCode, step: number): void => {
    reasons.push({ code, step });
  };

  if (!evaluation.complete) {
    add('answers_incomplete', firstInvalidStep(evaluation.errors));
    return { eligible: false, reasons, request: null };
  }

  const { overview } = evaluation;
  const incomeShares = overview.income?.shareVector ?? null;
  const expenseShares = overview.expenses?.shareVector ?? null;
  const ratio = overview.expenseIncomeRatio;
  const reserve = overview.reserve;
  const buffer = reserve?.coverageMonths ?? null;
  const weights = reserve?.composition ?? null;

  if (!isValidShareVector(incomeShares) || !isValidShareVector(expenseShares)) {
    add('share_vector_invalid', STEP_CASHFLOWS);
  }
  if (ratio === null || !isExpenseIncomeRatioSupported(ratio)) {
    add('expense_income_ratio_out_of_supported_range', STEP_CASHFLOWS);
  }

  if (reserve === null || reserve.status !== 'holdings' || buffer === null || buffer <= 0) {
    add('no_current_reserve', STEP_RESERVE);
  } else {
    if (!isValidShareVector(weights)) {
      add('share_vector_invalid', STEP_RESERVE);
    }
    if (!isBufferMonthsSupported(buffer)) {
      add('buffer_months_out_of_supported_range', STEP_RESERVE);
    }
  }

  const horizon = overview.horizonYears;
  if (horizon === null || !isHorizonSupported(horizon)) {
    add('horizon_unsupported', STEP_RESERVE);
  }

  const rebalance = overview.rebalanceFrequency;
  if (rebalance === null) {
    add('rebalance_frequency_not_selected', STEP_SETTINGS);
  } else if (!isRebalanceFrequencySupported(rebalance)) {
    add('rebalance_frequency_unsupported', STEP_SETTINGS);
  }

  const cost = overview.conversionCost;
  if (cost === null) {
    add('conversion_cost_not_selected', STEP_SETTINGS);
  } else if (!isConversionCostSupported(cost)) {
    add('conversion_cost_out_of_supported_range', STEP_SETTINGS);
  }

  if (reasons.length) {
    return { eligible: false, reasons, request: null };
  }

  const request: HouseholdAnalysisRequest = {
    contract_version: HOUSEHOLD_CONTRACT_VERSION,
    income_shares: copyVector(incomeShares as HouseholdVector),
    expense_shares: copyVector(expenseShares as HouseholdVector),
    current_reserve_weights: copyVector(weights as HouseholdVector),
    expense_income_ratio: ratio as number,
    buffer_months: buffer as number,
    horizon_years: horizon as number,
    rebalance_frequency: rebalance as string,
    conversion_cost: cost as number,
  };
  return { eligible: true, reasons: [], request };
}

/** The request for eligible answers, otherwise null. */
export function buildHouseholdAnalysisRequest(
  evaluation: AssessmentEvaluation,
): HouseholdAnalysisRequest | null {
  return evaluateSimulationEligibility(evaluation).request;
}
