import type { CurrencyCode } from '../api/models';

/** Canonical currency order shared with the research engine weight vectors. */
export const ASSESSMENT_CURRENCIES: readonly CurrencyCode[] = ['KZT', 'USD', 'EUR'];
export type ForeignCurrency = Exclude<CurrencyCode, 'KZT'>;
export const FOREIGN_CURRENCIES: readonly ForeignCurrency[] = ['USD', 'EUR'];

export const SUPPORTED_COUNTRIES = ['KZ'] as const;
export type CountryCode = (typeof SUPPORTED_COUNTRIES)[number];
export const SUPPORTED_BASE_CURRENCIES = ['KZT'] as const;
export type BaseCurrency = (typeof SUPPORTED_BASE_CURRENCIES)[number];

/** Horizons evaluated by the research model (mirrors `HH_HORIZON_YEARS`). */
export const ASSESSMENT_HORIZONS = [1, 3, 5] as const;

/** Questionnaire steps 0–3; 4 is the household overview. */
export const ASSESSMENT_STEP_COUNT = 4;
export const ASSESSMENT_OVERVIEW_STEP = 4;

export type RawAmounts = Partial<Record<CurrencyCode, string>>;

/**
 * Raw questionnaire answers exactly as typed. Derived totals and shares are
 * never stored; they are recomputed from this draft after every change.
 */
export interface AssessmentDraft {
  version: 1;
  step: number;
  country: CountryCode;
  baseCurrency: BaseCurrency;
  incomeCurrencies: CurrencyCode[];
  expenseCurrencies: CurrencyCode[];
  reserveCurrencies: CurrencyCode[];
  noReserve: boolean;
  income: RawAmounts;
  expenses: RawAmounts;
  reserves: RawAmounts;
  /** KZT per one unit of foreign currency, as typed by the user. */
  rates: Partial<Record<ForeignCurrency, string>>;
  /** ISO `YYYY-MM-DD`, or empty when not entered. */
  valuationDate: string;
  /** KZT; empty means “Not provided”, `0` means zero. */
  monthlyContribution: string;
  horizonYears: number | null;
  rebalanceFrequency: string | null;
  conversionCost: number | null;
}

export type AssessmentErrorCode =
  | 'required'
  | 'invalid_number'
  | 'negative'
  | 'too_many_decimals'
  | 'too_large'
  | 'too_long'
  | 'rate_not_positive'
  | 'income_currency_required'
  | 'expense_currency_required'
  | 'reserve_currency_required'
  | 'income_total_zero'
  | 'expense_total_zero'
  | 'date_required'
  | 'date_invalid'
  | 'date_future'
  | 'horizon_required';

/** Field keys such as `income.USD`, `rate.EUR`, `valuationDate`. */
export type AssessmentErrors = Record<string, AssessmentErrorCode>;

export interface CurrencyLine {
  currency: CurrencyCode;
  /** Amount in the entry currency. */
  amount: number;
  /** Amount × valuation rate, in KZT equivalent. */
  valueKzt: number;
  /** `valueKzt / total`; null when the total is zero. */
  share: number | null;
}

export interface CashFlowSection {
  lines: CurrencyLine[];
  totalKzt: number;
  /** Shares in canonical KZT/USD/EUR order; unselected currencies are 0. */
  shareVector: [number, number, number] | null;
}

export type ReserveStatus = 'none_declared' | 'zero_balance' | 'holdings';

export interface ReserveSection {
  status: ReserveStatus;
  lines: CurrencyLine[];
  totalKzt: number;
  /** Existing holdings only — never an optimized or assumed allocation. */
  composition: [number, number, number] | null;
  /** reserveTotal / expenseTotal; null until essential expenses are known. */
  coverageMonths: number | null;
}

export interface ValuationSnapshot {
  source: 'user_provided';
  /** KZT per unit; KZT is fixed at 1. Only currencies in use are present. */
  rates: Partial<Record<CurrencyCode, number>>;
  date: string | null;
}

/** Normalized household data, suitable for a later API contract. */
export interface HouseholdOverview {
  country: CountryCode;
  baseCurrency: BaseCurrency;
  valuation: ValuationSnapshot | null;
  income: CashFlowSection | null;
  expenses: CashFlowSection | null;
  /** expenseTotal / incomeTotal; null unless both totals are positive. */
  expenseIncomeRatio: number | null;
  incomeAfterEssentialKzt: number | null;
  reserve: ReserveSection | null;
  monthlyContributionKzt: number | null;
  horizonYears: number | null;
  rebalanceFrequency: string | null;
  conversionCost: number | null;
}

export interface AssessmentEvaluation {
  errors: AssessmentErrors;
  overview: HouseholdOverview;
  /** Rates required by the selected currencies (foreign only). */
  requiredRates: ForeignCurrency[];
  /** True when every questionnaire step validates. */
  complete: boolean;
}

export function emptyAssessmentDraft(): AssessmentDraft {
  return {
    version: 1,
    step: 0,
    country: 'KZ',
    baseCurrency: 'KZT',
    incomeCurrencies: [],
    expenseCurrencies: [],
    reserveCurrencies: [],
    noReserve: false,
    income: {},
    expenses: {},
    reserves: {},
    rates: {},
    valuationDate: '',
    monthlyContribution: '',
    horizonYears: null,
    rebalanceFrequency: null,
    conversionCost: null,
  };
}
