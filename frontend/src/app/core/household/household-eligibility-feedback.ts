import type { AssessmentEvaluation } from '../assessment/assessment.model';
import { EN_STRINGS } from '../i18n/en';
import {
  formatBufferMonths,
  formatConversionCost,
  formatMonthsOfIncome,
  formatPercent,
  formatRebalanceFrequency,
  interpolate,
} from '../util/format.util';
import {
  SUPPORTED_BUFFER_MONTHS,
  SUPPORTED_CONVERSION_COST,
  SUPPORTED_EXPENSE_INCOME_RATIO,
  SUPPORTED_REBALANCE_FREQUENCIES,
} from './household-analysis.models';
import {
  isBufferMonthsSupported,
  isConversionCostSupported,
  isExpenseIncomeRatioSupported,
  isRebalanceFrequencySupported,
} from './household-analysis.request';

/** `pending`: required inputs are not yet valid, so no value or conclusion is shown. */
export type InlineFeedbackState = 'pending' | 'supported' | 'outside' | 'none';

export interface InlineFeedback {
  state: InlineFeedbackState;
  text: string;
  /** Shown with every "not available" conclusion. */
  modelLimit: string | null;
}

interface Range {
  min: number;
  max: number;
}

const copy = EN_STRINGS.assessment.simulation.inline;

const ratioText = (value: number): string => formatPercent(value, 1);
/** Rounded to the displayed two decimals first, so 0.99999 reads "1 month", not "1 months". */
const monthsText = (value: number): string => formatBufferMonths(Math.round(value * 100) / 100);

/**
 * Formats a value so that rounding never lands it on a boundary it is
 * actually outside of, e.g. 105.04% reads "just over 105%", not "105%".
 */
export function textAgainstRange(
  value: number,
  range: Range,
  format: (value: number) => string,
): string {
  const text = format(value);
  if (value > range.max && text === format(range.max)) {
    return interpolate(copy.justOver, { value: text });
  }
  if (value < range.min && text === format(range.min)) {
    return interpolate(copy.justUnder, { value: text });
  }
  return text;
}

function outcome(supported: boolean, text: string): InlineFeedback {
  return {
    state: supported ? 'supported' : 'outside',
    text,
    modelLimit: supported ? null : copy.modelLimit,
  };
}

/** Essential expenses as a share of income, once amounts and rates are valid. */
export function buildRatioFeedback(evaluation: AssessmentEvaluation): InlineFeedback {
  const range = {
    min: ratioText(SUPPORTED_EXPENSE_INCOME_RATIO.min),
    max: ratioText(SUPPORTED_EXPENSE_INCOME_RATIO.max),
  };
  const ratio = evaluation.overview.expenseIncomeRatio;
  if (ratio === null) {
    return { state: 'pending', text: interpolate(copy.ratioPending, range), modelLimit: null };
  }
  const supported = isExpenseIncomeRatioSupported(ratio);
  const value = textAgainstRange(ratio, SUPPORTED_EXPENSE_INCOME_RATIO, ratioText);
  return outcome(
    supported,
    interpolate(supported ? copy.ratioSupported : copy.ratioOutside, { value, ...range }),
  );
}

/** Reserve coverage in months of essential expenses, once its inputs are valid. */
export function buildCoverageFeedback(evaluation: AssessmentEvaluation): InlineFeedback {
  const range = {
    min: formatMonthsOfIncome(SUPPORTED_BUFFER_MONTHS.min, 0),
    max: formatMonthsOfIncome(SUPPORTED_BUFFER_MONTHS.max, 0),
  };
  const reserve = evaluation.overview.reserve;
  if (reserve !== null && reserve.status !== 'holdings') {
    return {
      state: 'none',
      text: interpolate(copy.coverageNone, range),
      modelLimit: copy.modelLimit,
    };
  }
  const months = reserve?.coverageMonths ?? null;
  if (months === null) {
    return { state: 'pending', text: interpolate(copy.coveragePending, range), modelLimit: null };
  }
  const supported = isBufferMonthsSupported(months);
  const value = textAgainstRange(months, SUPPORTED_BUFFER_MONTHS, monthsText);
  return outcome(
    supported,
    interpolate(supported ? copy.coverageSupported : copy.coverageOutside, { value, ...range }),
  );
}

function joinWithOr(items: string[]): string {
  if (items.length <= 1) {
    return items.join('');
  }
  return `${items.slice(0, -1).join(', ')}, ${copy.or} ${items[items.length - 1]}`;
}

/**
 * Shown only when the offered or selected frequencies include one the
 * simulation does not support; otherwise null.
 */
export function buildRebalanceFeedback(
  offered: readonly string[],
  selected: string | null,
): InlineFeedback | null {
  const selectedOutside = selected !== null && !isRebalanceFrequencySupported(selected);
  if (!selectedOutside && offered.every(isRebalanceFrequencySupported)) {
    return null;
  }
  const list = joinWithOr(
    SUPPORTED_REBALANCE_FREQUENCIES.map((value) => formatRebalanceFrequency(value).toLowerCase()),
  );
  return selectedOutside
    ? outcome(false, interpolate(copy.rebalanceOutside, { list }))
    : { state: 'supported', text: interpolate(copy.rebalanceRange, { list }), modelLimit: null };
}

/** Same rule for conversion costs. */
export function buildConversionCostFeedback(
  offered: readonly number[],
  selected: number | null,
): InlineFeedback | null {
  const selectedOutside = selected !== null && !isConversionCostSupported(selected);
  if (!selectedOutside && offered.every(isConversionCostSupported)) {
    return null;
  }
  const range = {
    min: formatConversionCost(SUPPORTED_CONVERSION_COST.min),
    max: formatConversionCost(SUPPORTED_CONVERSION_COST.max),
  };
  return selectedOutside
    ? outcome(false, interpolate(copy.costOutside, range))
    : { state: 'supported', text: interpolate(copy.costRange, range), modelLimit: null };
}
