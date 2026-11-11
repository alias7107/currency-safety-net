/**
 * Pure parsing, validation and arithmetic for the Phase 5A household assessment.
 *
 * Every amount is converted to KZT equivalent with the user's own valuation
 * rates before it is added or turned into a share. Nothing here calls the API,
 * maps households onto research profiles, or produces risk metrics.
 */

import type { CurrencyCode } from '../api/models';
import {
  ASSESSMENT_CURRENCIES,
  ASSESSMENT_HORIZONS,
  ASSESSMENT_OVERVIEW_STEP,
  type AssessmentDraft,
  type AssessmentErrorCode,
  type AssessmentErrors,
  type AssessmentEvaluation,
  type CashFlowSection,
  type CurrencyLine,
  FOREIGN_CURRENCIES,
  type ForeignCurrency,
  type RawAmounts,
  type ReserveSection,
  type ValuationSnapshot,
  emptyAssessmentDraft,
} from './assessment.model';

/** Amounts: non-negative, at most 2 decimals, at most one trillion. */
export const AMOUNT_MAX_DECIMALS = 2;
export const AMOUNT_MAX = 1_000_000_000_000;
/** Valuation rates (KZT per unit): positive, at most 6 decimals, at most one million. */
export const RATE_MAX_DECIMALS = 6;
export const RATE_MAX = 1_000_000;
/** Longest raw text accepted from a field or from restored storage, counted as typed. */
export const RAW_INPUT_MAX_LENGTH = 32;

/** One length rule shared by input parsing and draft restoration. */
export function exceedsRawInputLimit(value: string): boolean {
  return value.length > RAW_INPUT_MAX_LENGTH;
}

/**
 * Accepted thousands-grouping characters: ASCII space (U+0020), no-break space
 * (U+00A0) and narrow no-break space (U+202F). Tabs, line breaks and other
 * whitespace are never accepted inside a number.
 */
const GROUP_SEPARATOR = '[ \\u00A0\\u202F]';

/**
 * Either ungrouped digits, or a 1–3 digit lead followed by groups of exactly
 * three digits, each preceded by one separator. The optional fraction is
 * ungrouped digits after a `.`.
 */
const NUMBER_PATTERN = new RegExp(`^(\\d+|\\d{1,3}(?:${GROUP_SEPARATOR}\\d{3})+)(?:\\.(\\d+))?$`);
const GROUP_SEPARATORS = new RegExp(GROUP_SEPARATOR, 'g');

export type ParseResult =
  | { kind: 'blank' }
  | { kind: 'invalid'; code: AssessmentErrorCode }
  | { kind: 'value'; value: number };

interface NumberRules {
  maxDecimals: number;
  max: number;
  positive: boolean;
}

/**
 * Parses digits with an optional `.` decimal point. Leading and trailing
 * whitespace is ignored. Inside the number, only correct thousands grouping
 * in the integer part is accepted (`1 250 000.50`); the structure is
 * validated before separators are removed, so `1 2` or `12 34` are rejected
 * rather than repaired. Commas are rejected because `1,250` is ambiguous
 * between a thousands separator and a decimal comma; exponent notation is
 * rejected too.
 */
function parseNumber(raw: string | null | undefined, rules: NumberRules): ParseResult {
  if (typeof raw !== 'string') {
    return { kind: 'blank' };
  }
  if (exceedsRawInputLimit(raw)) {
    return { kind: 'invalid', code: 'too_long' };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { kind: 'blank' };
  }
  if (trimmed.startsWith('-') && NUMBER_PATTERN.test(trimmed.slice(1))) {
    return { kind: 'invalid', code: 'negative' };
  }
  const match = NUMBER_PATTERN.exec(trimmed);
  if (!match) {
    return { kind: 'invalid', code: 'invalid_number' };
  }
  if ((match[2]?.length ?? 0) > rules.maxDecimals) {
    return { kind: 'invalid', code: 'too_many_decimals' };
  }
  const value = Number(trimmed.replace(GROUP_SEPARATORS, ''));
  if (!Number.isFinite(value)) {
    return { kind: 'invalid', code: 'invalid_number' };
  }
  if (value > rules.max) {
    return { kind: 'invalid', code: 'too_large' };
  }
  if (rules.positive && value <= 0) {
    return { kind: 'invalid', code: 'rate_not_positive' };
  }
  return { kind: 'value', value };
}

export function parseAmount(raw: string | null | undefined): ParseResult {
  return parseNumber(raw, { maxDecimals: AMOUNT_MAX_DECIMALS, max: AMOUNT_MAX, positive: false });
}

export function parseRate(raw: string | null | undefined): ParseResult {
  return parseNumber(raw, { maxDecimals: RATE_MAX_DECIMALS, max: RATE_MAX, positive: true });
}

/** True for a real calendar date written as `YYYY-MM-DD` (year 1900 or later). */
export function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1900) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Today's local date as `YYYY-MM-DD`. */
export function localIsoDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Selected currencies in canonical KZT/USD/EUR order with duplicates removed. */
export function canonicalCurrencies(values: readonly unknown[] | null | undefined): CurrencyCode[] {
  const selected = new Set(Array.isArray(values) ? values : []);
  return ASSESSMENT_CURRENCIES.filter((code) => selected.has(code));
}

export function effectiveReserveCurrencies(draft: AssessmentDraft): CurrencyCode[] {
  return draft.noReserve ? [] : canonicalCurrencies(draft.reserveCurrencies);
}

/** Foreign currencies that need a user-provided valuation rate. */
export function requiredRateCurrencies(draft: AssessmentDraft): ForeignCurrency[] {
  const used = new Set<CurrencyCode>([
    ...canonicalCurrencies(draft.incomeCurrencies),
    ...canonicalCurrencies(draft.expenseCurrencies),
    ...effectiveReserveCurrencies(draft),
  ]);
  return FOREIGN_CURRENCIES.filter((code) => used.has(code));
}

/** Which questionnaire step owns an error key (0-based). */
export function stepForErrorKey(key: string): number {
  if (key.endsWith('Currencies')) {
    return 0;
  }
  if (
    key.startsWith('income.') ||
    key.startsWith('expense.') ||
    key.startsWith('rate.') ||
    key === 'valuationDate' ||
    key === 'incomeTotal' ||
    key === 'expenseTotal'
  ) {
    return 1;
  }
  return 2;
}

export function errorsForStep(errors: AssessmentErrors, step: number): AssessmentErrors {
  return Object.fromEntries(
    Object.entries(errors).filter(([key]) => stepForErrorKey(key) === step),
  ) as AssessmentErrors;
}

/** Earliest step with an error, or -1 when the questionnaire validates. */
export function firstInvalidStep(errors: AssessmentErrors): number {
  const steps = Object.keys(errors).map(stepForErrorKey);
  return steps.length ? Math.min(...steps) : -1;
}

function shareVector(lines: CurrencyLine[], total: number): [number, number, number] | null {
  if (!(total > 0)) {
    return null;
  }
  const vector = ASSESSMENT_CURRENCIES.map((code) => {
    const line = lines.find((item) => item.currency === code);
    return line ? line.valueKzt / total : 0;
  });
  return [vector[0]!, vector[1]!, vector[2]!];
}

/**
 * Parses one group of amounts. Returns null (with errors recorded) unless every
 * selected currency has a valid amount and every needed rate is available.
 */
function valueLines(
  currencies: CurrencyCode[],
  raw: RawAmounts,
  keyPrefix: string,
  rates: Partial<Record<CurrencyCode, number>> | null,
  errors: AssessmentErrors,
): { lines: CurrencyLine[]; total: number } | null {
  const amounts: { currency: CurrencyCode; amount: number }[] = [];
  let valid = true;
  for (const currency of currencies) {
    const parsed = parseAmount(raw[currency]);
    if (parsed.kind === 'value') {
      amounts.push({ currency, amount: parsed.value });
    } else {
      errors[`${keyPrefix}.${currency}`] = parsed.kind === 'blank' ? 'required' : parsed.code;
      valid = false;
    }
  }
  if (!valid || !rates) {
    return null;
  }
  const valued = amounts.map(({ currency, amount }) => ({
    currency,
    amount,
    valueKzt: amount * (rates[currency] as number),
  }));
  const total = valued.reduce((sum, line) => sum + line.valueKzt, 0);
  const lines = valued.map((line) => ({
    ...line,
    share: total > 0 ? line.valueKzt / total : null,
  }));
  return { lines, total };
}

function cashFlowSection(
  currencies: CurrencyCode[],
  raw: RawAmounts,
  keyPrefix: string,
  totalKey: string,
  zeroCode: AssessmentErrorCode,
  rates: Partial<Record<CurrencyCode, number>> | null,
  errors: AssessmentErrors,
): CashFlowSection | null {
  if (!currencies.length) {
    return null;
  }
  const valued = valueLines(currencies, raw, keyPrefix, rates, errors);
  if (!valued) {
    return null;
  }
  if (!(valued.total > 0)) {
    errors[totalKey] = zeroCode;
  }
  return {
    lines: valued.lines,
    totalKzt: valued.total,
    shareVector: shareVector(valued.lines, valued.total),
  };
}

/**
 * Validates the draft and derives the household overview.
 *
 * @param today local `YYYY-MM-DD`; valuation dates after it are rejected.
 */
export function evaluateAssessment(draft: AssessmentDraft, today: string): AssessmentEvaluation {
  const errors: AssessmentErrors = {};
  const incomeCurrencies = canonicalCurrencies(draft.incomeCurrencies);
  const expenseCurrencies = canonicalCurrencies(draft.expenseCurrencies);
  const reserveCurrencies = effectiveReserveCurrencies(draft);

  if (!incomeCurrencies.length) {
    errors['incomeCurrencies'] = 'income_currency_required';
  }
  if (!expenseCurrencies.length) {
    errors['expenseCurrencies'] = 'expense_currency_required';
  }
  if (!draft.noReserve && !reserveCurrencies.length) {
    errors['reserveCurrencies'] = 'reserve_currency_required';
  }

  const requiredRates = requiredRateCurrencies(draft);
  const rates: Partial<Record<CurrencyCode, number>> = { KZT: 1 };
  let ratesValid = true;
  for (const currency of requiredRates) {
    const parsed = parseRate(draft.rates[currency]);
    if (parsed.kind === 'value') {
      rates[currency] = parsed.value;
    } else {
      errors[`rate.${currency}`] = parsed.kind === 'blank' ? 'required' : parsed.code;
      ratesValid = false;
    }
  }

  let valuationDate: string | null = null;
  if (requiredRates.length) {
    if (!draft.valuationDate) {
      errors['valuationDate'] = 'date_required';
    } else if (!isIsoCalendarDate(draft.valuationDate)) {
      errors['valuationDate'] = 'date_invalid';
    } else if (draft.valuationDate > today) {
      errors['valuationDate'] = 'date_future';
    } else {
      valuationDate = draft.valuationDate;
    }
  }

  const activeRates = ratesValid ? rates : null;
  const valuation: ValuationSnapshot | null = activeRates
    ? { source: 'user_provided', rates: { ...activeRates }, date: valuationDate }
    : null;

  const income = cashFlowSection(
    incomeCurrencies,
    draft.income,
    'income',
    'incomeTotal',
    'income_total_zero',
    activeRates,
    errors,
  );
  const expenses = cashFlowSection(
    expenseCurrencies,
    draft.expenses,
    'expense',
    'expenseTotal',
    'expense_total_zero',
    activeRates,
    errors,
  );

  const incomeTotal = income?.totalKzt ?? 0;
  const expenseTotal = expenses?.totalKzt ?? 0;
  const bothPositive = incomeTotal > 0 && expenseTotal > 0;

  let reserve: ReserveSection | null = null;
  if (draft.noReserve) {
    reserve = {
      status: 'none_declared',
      lines: [],
      totalKzt: 0,
      composition: null,
      coverageMonths: expenseTotal > 0 ? 0 : null,
    };
  } else if (reserveCurrencies.length) {
    const valued = valueLines(reserveCurrencies, draft.reserves, 'reserve', activeRates, errors);
    if (valued) {
      reserve = {
        status: valued.total > 0 ? 'holdings' : 'zero_balance',
        lines: valued.lines,
        totalKzt: valued.total,
        composition: shareVector(valued.lines, valued.total),
        coverageMonths: expenseTotal > 0 ? valued.total / expenseTotal : null,
      };
    }
  }

  let monthlyContributionKzt: number | null = null;
  const contribution = parseAmount(draft.monthlyContribution);
  if (contribution.kind === 'value') {
    monthlyContributionKzt = contribution.value;
  } else if (contribution.kind === 'invalid') {
    errors['monthlyContribution'] = contribution.code;
  }

  const horizonYears = (ASSESSMENT_HORIZONS as readonly number[]).includes(
    draft.horizonYears as number,
  )
    ? (draft.horizonYears as number)
    : null;
  if (horizonYears === null) {
    errors['horizonYears'] = 'horizon_required';
  }

  return {
    errors,
    requiredRates,
    complete: Object.keys(errors).length === 0,
    overview: {
      country: draft.country,
      baseCurrency: draft.baseCurrency,
      valuation,
      income,
      expenses,
      expenseIncomeRatio: bothPositive ? expenseTotal / incomeTotal : null,
      incomeAfterEssentialKzt: bothPositive ? incomeTotal - expenseTotal : null,
      reserve,
      monthlyContributionKzt,
      horizonYears,
      rebalanceFrequency: draft.rebalanceFrequency,
      conversionCost: draft.conversionCost,
    },
  };
}

/* ---------- Strict restoration of a persisted draft ---------- */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function restoreRaw(value: unknown): string {
  return typeof value === 'string' && !exceedsRawInputLimit(value) ? value : '';
}

function restoreAmounts(value: unknown, allowed: readonly string[]): RawAmounts {
  if (!isPlainObject(value)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const code of allowed) {
    const raw = restoreRaw(value[code]);
    if (raw) {
      out[code] = raw;
    }
  }
  return out as RawAmounts;
}

/**
 * Rebuilds a draft from untrusted storage. Unknown keys are dropped and every
 * field that fails its type, enum, date or length check falls back to empty.
 * Derived totals or percentages in storage are ignored.
 */
export function restoreAssessmentDraft(input: unknown): AssessmentDraft {
  const empty = emptyAssessmentDraft();
  if (!isPlainObject(input) || input['version'] !== 1) {
    return empty;
  }
  const step = input['step'];
  const noReserve = input['noReserve'] === true;
  const horizon = input['horizonYears'];
  const rebalance = input['rebalanceFrequency'];
  const cost = input['conversionCost'];
  const date = input['valuationDate'];

  return {
    ...empty,
    step:
      typeof step === 'number' &&
      Number.isInteger(step) &&
      step >= 0 &&
      step <= ASSESSMENT_OVERVIEW_STEP
        ? step
        : 0,
    country: input['country'] === 'KZ' ? 'KZ' : empty.country,
    baseCurrency: input['baseCurrency'] === 'KZT' ? 'KZT' : empty.baseCurrency,
    incomeCurrencies: canonicalCurrencies(input['incomeCurrencies'] as unknown[]),
    expenseCurrencies: canonicalCurrencies(input['expenseCurrencies'] as unknown[]),
    reserveCurrencies: noReserve
      ? []
      : canonicalCurrencies(input['reserveCurrencies'] as unknown[]),
    noReserve,
    income: restoreAmounts(input['income'], ASSESSMENT_CURRENCIES),
    expenses: restoreAmounts(input['expenses'], ASSESSMENT_CURRENCIES),
    reserves: restoreAmounts(input['reserves'], ASSESSMENT_CURRENCIES),
    rates: restoreAmounts(input['rates'], FOREIGN_CURRENCIES),
    valuationDate: isIsoCalendarDate(date) ? date : '',
    monthlyContribution: restoreRaw(input['monthlyContribution']),
    horizonYears:
      typeof horizon === 'number' && (ASSESSMENT_HORIZONS as readonly number[]).includes(horizon)
        ? horizon
        : null,
    rebalanceFrequency:
      typeof rebalance === 'string' && /^[a-z_]{1,32}$/.test(rebalance) ? rebalance : null,
    conversionCost:
      typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 && cost <= 1 ? cost : null,
  };
}
