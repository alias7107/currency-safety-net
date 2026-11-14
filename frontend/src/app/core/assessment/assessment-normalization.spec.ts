import {
  AMOUNT_MAX,
  RAW_INPUT_MAX_LENGTH,
  evaluateAssessment,
  firstInvalidStep,
  isIsoCalendarDate,
  parseAmount,
  parseRate,
  requiredRateCurrencies,
  restoreAssessmentDraft,
  stepForErrorKey,
} from './assessment-normalization';
import { type AssessmentDraft, emptyAssessmentDraft } from './assessment.model';

const TODAY = '2026-11-11';

/** Arbitrary household fixture — not a research profile and not canonical output. */
function mixedDraft(overrides: Partial<AssessmentDraft> = {}): AssessmentDraft {
  return {
    ...emptyAssessmentDraft(),
    incomeCurrencies: ['KZT', 'USD'],
    expenseCurrencies: ['KZT', 'EUR'],
    reserveCurrencies: ['USD', 'KZT'],
    income: { KZT: '300000', USD: '1000' },
    expenses: { KZT: '200000', EUR: '100' },
    reserves: { KZT: '150000', USD: '900' },
    rates: { USD: '500', EUR: '550' },
    valuationDate: '2026-11-01',
    horizonYears: 3,
    ...overrides,
  };
}

describe('parseAmount', () => {
  it('distinguishes blank input from zero', () => {
    expect(parseAmount('')).toEqual({ kind: 'blank' });
    expect(parseAmount('   ')).toEqual({ kind: 'blank' });
    expect(parseAmount('0')).toEqual({ kind: 'value', value: 0 });
  });

  it('accepts digit grouping with spaces and a decimal point', () => {
    expect(parseAmount('1 250 000')).toEqual({ kind: 'value', value: 1_250_000 });
    expect(parseAmount('1250.5')).toEqual({ kind: 'value', value: 1250.5 });
  });

  it('rejects negative, malformed, ambiguous and non-finite input', () => {
    expect(parseAmount('-5')).toEqual({ kind: 'invalid', code: 'negative' });
    expect(parseAmount('1,250')).toEqual({ kind: 'invalid', code: 'invalid_number' });
    expect(parseAmount('abc')).toEqual({ kind: 'invalid', code: 'invalid_number' });
    expect(parseAmount('1e5')).toEqual({ kind: 'invalid', code: 'invalid_number' });
    expect(parseAmount('Infinity')).toEqual({ kind: 'invalid', code: 'invalid_number' });
    expect(parseAmount('NaN')).toEqual({ kind: 'invalid', code: 'invalid_number' });
    expect(parseAmount('12.345')).toEqual({ kind: 'invalid', code: 'too_many_decimals' });
    expect(parseAmount(String(AMOUNT_MAX + 1))).toEqual({ kind: 'invalid', code: 'too_large' });
  });
});

describe('parseAmount thousands grouping', () => {
  it('accepts correct grouping with space, no-break space or narrow no-break space', () => {
    expect(parseAmount('1 250 000.50')).toEqual({ kind: 'value', value: 1_250_000.5 });
    expect(parseAmount('1\u00A0250\u00A0000')).toEqual({ kind: 'value', value: 1_250_000 });
    expect(parseAmount('12\u202F500')).toEqual({ kind: 'value', value: 12_500 });
    expect(parseAmount('999 999')).toEqual({ kind: 'value', value: 999_999 });
  });

  it('ignores leading and trailing whitespace only', () => {
    expect(parseAmount('  250000  ')).toEqual({ kind: 'value', value: 250_000 });
    expect(parseAmount('\t250000\n')).toEqual({ kind: 'value', value: 250_000 });
    expect(parseAmount(' \t \n')).toEqual({ kind: 'blank' });
  });

  it.each([
    ['1 2'],
    ['12 34'],
    ['1.2 3'],
    ['1 250.5 0'],
    ['1  250'],
    ['1234 567'],
    [' 1 25'],
    ['1\t250'],
    ['1\n250'],
    ['1\r\n250'],
    ['1,250,000'],
    ['2.5e3'],
    ['1 250,50'],
  ])('rejects malformed grouping or syntax %j', (raw) => {
    expect(parseAmount(raw)).toEqual({ kind: 'invalid', code: 'invalid_number' });
  });

  it('keeps the negative, decimal and limit rules for grouped input', () => {
    expect(parseAmount('-1 250')).toEqual({ kind: 'invalid', code: 'negative' });
    expect(parseAmount('1 250.505')).toEqual({ kind: 'invalid', code: 'too_many_decimals' });
    expect(parseAmount('1 000 000 000 001')).toEqual({ kind: 'invalid', code: 'too_large' });
    expect(parseRate('0 000')).toEqual({ kind: 'invalid', code: 'rate_not_positive' });
    expect(parseRate('1 000.123456')).toEqual({ kind: 'value', value: 1000.123456 });
  });
});

describe('raw input length limit', () => {
  const atLimit = `${' '.repeat(RAW_INPUT_MAX_LENGTH - 6)}250000`;
  const overLimit = ` ${atLimit}`;

  it('is counted on the raw text, including surrounding whitespace', () => {
    expect(atLimit.length).toBe(RAW_INPUT_MAX_LENGTH);
    expect(parseAmount(atLimit)).toEqual({ kind: 'value', value: 250_000 });
    expect(parseAmount(overLimit)).toEqual({ kind: 'invalid', code: 'too_long' });
    expect(parseRate(overLimit)).toEqual({ kind: 'invalid', code: 'too_long' });
  });

  it('applies the same limit when a draft is restored', () => {
    const restored = restoreAssessmentDraft({
      ...emptyAssessmentDraft(),
      income: { KZT: atLimit, USD: overLimit },
      rates: { USD: overLimit },
      monthlyContribution: overLimit,
    });
    expect(restored.income).toEqual({ KZT: atLimit });
    expect(restored.rates).toEqual({});
    expect(restored.monthlyContribution).toBe('');
  });
});

describe('parseRate', () => {
  it('requires a positive rate with at most six decimals', () => {
    expect(parseRate('512.123456')).toEqual({ kind: 'value', value: 512.123456 });
    expect(parseRate('0')).toEqual({ kind: 'invalid', code: 'rate_not_positive' });
    expect(parseRate('512.1234567')).toEqual({ kind: 'invalid', code: 'too_many_decimals' });
    expect(parseRate('')).toEqual({ kind: 'blank' });
  });
});

describe('isIsoCalendarDate', () => {
  it('accepts only real calendar dates', () => {
    expect(isIsoCalendarDate('2026-11-01')).toBe(true);
    expect(isIsoCalendarDate('2026-02-30')).toBe(false);
    expect(isIsoCalendarDate('11/01/2026')).toBe(false);
    expect(isIsoCalendarDate(20261101)).toBe(false);
  });
});

describe('evaluateAssessment', () => {
  it('converts every currency to KZT before summing and computing shares', () => {
    const { overview, errors, complete } = evaluateAssessment(mixedDraft(), TODAY);

    expect(errors).toEqual({});
    expect(complete).toBe(true);
    // Income: 300,000 KZT + 1,000 USD × 500 = 800,000 KZT.
    expect(overview.income!.totalKzt).toBe(800_000);
    expect(overview.income!.shareVector).toEqual([0.375, 0.625, 0]);
    // Expenses: 200,000 KZT + 100 EUR × 550 = 255,000 KZT.
    expect(overview.expenses!.totalKzt).toBe(255_000);
    expect(overview.expenses!.shareVector![2]).toBeCloseTo(55_000 / 255_000, 12);
    expect(overview.expenseIncomeRatio).toBeCloseTo(255_000 / 800_000, 12);
    expect(overview.incomeAfterEssentialKzt).toBe(545_000);
  });

  it('accepts arbitrary currency shares without mapping to a research profile', () => {
    const { overview } = evaluateAssessment(mixedDraft(), TODAY);
    expect(Object.keys(overview)).not.toContain('profile');
    expect(JSON.stringify(overview)).not.toMatch(/\bP[1-4]\b/);
    expect(overview.income!.shareVector).toEqual([0.375, 0.625, 0]);
  });

  it('keeps unrounded shares', () => {
    const draft = mixedDraft({
      incomeCurrencies: ['KZT', 'USD'],
      income: { KZT: '1000', USD: '4' },
      rates: { USD: '500', EUR: '550' },
    });
    const shares = evaluateAssessment(draft, TODAY).overview.income!.shareVector!;
    expect(shares[0]).toBe(1 / 3);
    expect(shares[1]).toBe(2 / 3);
  });

  it('computes reserve total, current composition and coverage months', () => {
    const { reserve } = evaluateAssessment(mixedDraft(), TODAY).overview;
    // Reserve: 150,000 KZT + 900 USD × 500 = 600,000 KZT; expenses 255,000 KZT.
    expect(reserve!.status).toBe('holdings');
    expect(reserve!.totalKzt).toBe(600_000);
    expect(reserve!.composition).toEqual([0.25, 0.75, 0]);
    expect(reserve!.coverageMonths).toBeCloseTo(600_000 / 255_000, 12);
  });

  it('recomputes every affected total and share when a valuation rate changes', () => {
    const before = evaluateAssessment(mixedDraft(), TODAY).overview;
    const after = evaluateAssessment(
      mixedDraft({ rates: { USD: '400', EUR: '550' } }),
      TODAY,
    ).overview;

    expect(after.income!.totalKzt).toBe(700_000);
    expect(after.income!.shareVector![1]).toBeCloseTo(400_000 / 700_000, 12);
    expect(after.reserve!.totalKzt).toBe(510_000);
    expect(after.reserve!.coverageMonths).toBeCloseTo(510_000 / 255_000, 12);
    expect(after.expenseIncomeRatio).not.toBe(before.expenseIncomeRatio);
    expect(after.expenses!.totalKzt).toBe(before.expenses!.totalKzt);
  });

  it('asks only for rates needed by selected currencies, including reserves', () => {
    const kztOnly = mixedDraft({
      incomeCurrencies: ['KZT'],
      expenseCurrencies: ['KZT'],
      reserveCurrencies: ['EUR'],
    });
    expect(requiredRateCurrencies(kztOnly)).toEqual(['EUR']);
    expect(requiredRateCurrencies({ ...kztOnly, noReserve: true, reserveCurrencies: [] })).toEqual(
      [],
    );
  });

  it('does not require a valuation date when only KZT is used', () => {
    const draft = mixedDraft({
      incomeCurrencies: ['KZT'],
      expenseCurrencies: ['KZT'],
      reserveCurrencies: ['KZT'],
      valuationDate: '',
    });
    const { errors, overview } = evaluateAssessment(draft, TODAY);
    expect(errors).toEqual({});
    expect(overview.valuation).toEqual({ source: 'user_provided', rates: { KZT: 1 }, date: null });
  });

  it('validates the valuation date when foreign currencies are used', () => {
    expect(evaluateAssessment(mixedDraft({ valuationDate: '' }), TODAY).errors).toMatchObject({
      valuationDate: 'date_required',
    });
    expect(
      evaluateAssessment(mixedDraft({ valuationDate: '2026-02-30' }), TODAY).errors,
    ).toMatchObject({ valuationDate: 'date_invalid' });
    expect(
      evaluateAssessment(mixedDraft({ valuationDate: '2026-11-12' }), TODAY).errors,
    ).toMatchObject({ valuationDate: 'date_future' });
  });

  it('represents an explicit no-reserve answer as zero with no allocation', () => {
    const { overview, errors } = evaluateAssessment(
      mixedDraft({ noReserve: true, reserveCurrencies: [] }),
      TODAY,
    );
    expect(errors).toEqual({});
    expect(overview.reserve).toEqual({
      status: 'none_declared',
      lines: [],
      totalKzt: 0,
      composition: null,
      coverageMonths: 0,
    });
  });

  it('treats an all-zero reserve as no current reserve without inventing weights', () => {
    const { reserve } = evaluateAssessment(
      mixedDraft({ reserves: { KZT: '0', USD: '0' } }),
      TODAY,
    ).overview;
    expect(reserve!.status).toBe('zero_balance');
    expect(reserve!.totalKzt).toBe(0);
    expect(reserve!.composition).toBeNull();
    expect(reserve!.coverageMonths).toBe(0);
    expect(reserve!.lines.every((line) => line.share === null)).toBe(true);
  });

  it('keeps valid personal values outside the research engine ranges unchanged', () => {
    // Ratio 0.60 (< 0.80) and more than 12 months of reserve.
    const draft = mixedDraft({
      incomeCurrencies: ['KZT'],
      expenseCurrencies: ['KZT'],
      reserveCurrencies: ['KZT'],
      income: { KZT: '500000' },
      expenses: { KZT: '300000' },
      reserves: { KZT: '6000000' },
    });
    const { overview, errors } = evaluateAssessment(draft, TODAY);
    expect(errors).toEqual({});
    expect(overview.expenseIncomeRatio).toBe(0.6);
    expect(overview.reserve!.coverageMonths).toBe(20);
  });

  it('allows essential expenses above income and reports a negative remainder', () => {
    const draft = mixedDraft({
      incomeCurrencies: ['KZT'],
      expenseCurrencies: ['KZT'],
      income: { KZT: '100000' },
      expenses: { KZT: '130000' },
    });
    const { overview } = evaluateAssessment(draft, TODAY);
    expect(overview.expenseIncomeRatio).toBe(1.3);
    expect(overview.incomeAfterEssentialKzt).toBe(-30_000);
  });

  it('allows zero individual entries but rejects zero totals', () => {
    const zeroUsd = evaluateAssessment(mixedDraft({ income: { KZT: '300000', USD: '0' } }), TODAY);
    expect(zeroUsd.errors).toEqual({});
    expect(zeroUsd.overview.income!.shareVector).toEqual([1, 0, 0]);

    const zeroIncome = evaluateAssessment(mixedDraft({ income: { KZT: '0', USD: '0' } }), TODAY);
    expect(zeroIncome.errors).toMatchObject({ incomeTotal: 'income_total_zero' });
    expect(zeroIncome.overview.income!.shareVector).toBeNull();
    expect(zeroIncome.overview.expenseIncomeRatio).toBeNull();
    expect(zeroIncome.overview.incomeAfterEssentialKzt).toBeNull();

    const zeroExpenses = evaluateAssessment(
      mixedDraft({ expenses: { KZT: '0', EUR: '0' } }),
      TODAY,
    );
    expect(zeroExpenses.errors).toMatchObject({ expenseTotal: 'expense_total_zero' });
    expect(zeroExpenses.overview.reserve!.coverageMonths).toBeNull();
  });

  it('does not turn blank entries into zero', () => {
    const { errors, overview } = evaluateAssessment(
      mixedDraft({ income: { KZT: '300000', USD: '' } }),
      TODAY,
    );
    expect(errors).toMatchObject({ 'income.USD': 'required' });
    expect(overview.income).toBeNull();
  });

  it('rejects invalid rates and withholds every converted total', () => {
    const { errors, overview } = evaluateAssessment(
      mixedDraft({ rates: { USD: '-1', EUR: '550' } }),
      TODAY,
    );
    expect(errors).toMatchObject({ 'rate.USD': 'negative' });
    expect(overview.valuation).toBeNull();
    expect(overview.income).toBeNull();
    expect(overview.reserve).toBeNull();
  });

  it('excludes deselected currencies even when raw entries remain', () => {
    const draft = mixedDraft({
      incomeCurrencies: ['KZT'],
      income: { KZT: '300000', USD: '99999', EUR: 'not a number' },
    });
    const { overview, errors } = evaluateAssessment(draft, TODAY);
    expect(errors['income.USD']).toBeUndefined();
    expect(errors['income.EUR']).toBeUndefined();
    expect(overview.income!.lines.map((line) => line.currency)).toEqual(['KZT']);
    expect(overview.income!.totalKzt).toBe(300_000);
  });

  it('treats a blank contribution as not provided and zero as zero', () => {
    expect(evaluateAssessment(mixedDraft(), TODAY).overview.monthlyContributionKzt).toBeNull();
    expect(
      evaluateAssessment(mixedDraft({ monthlyContribution: '0' }), TODAY).overview
        .monthlyContributionKzt,
    ).toBe(0);
    expect(
      evaluateAssessment(mixedDraft({ monthlyContribution: 'ten' }), TODAY).errors,
    ).toMatchObject({ monthlyContribution: 'invalid_number' });
  });

  it('does not add the contribution to income or subtract it from expenses', () => {
    const withContribution = evaluateAssessment(
      mixedDraft({ monthlyContribution: '50000' }),
      TODAY,
    ).overview;
    const without = evaluateAssessment(mixedDraft(), TODAY).overview;
    expect(withContribution.income!.totalKzt).toBe(without.income!.totalKzt);
    expect(withContribution.expenses!.totalKzt).toBe(without.expenses!.totalKzt);
    expect(withContribution.reserve!.coverageMonths).toBe(without.reserve!.coverageMonths);
  });

  it('requires currency selections and a horizon', () => {
    const { errors } = evaluateAssessment(emptyAssessmentDraft(), TODAY);
    expect(errors).toMatchObject({
      incomeCurrencies: 'income_currency_required',
      expenseCurrencies: 'expense_currency_required',
      reserveCurrencies: 'reserve_currency_required',
      horizonYears: 'horizon_required',
    });
    expect(firstInvalidStep(errors)).toBe(0);
  });

  it('maps error keys to their questionnaire step', () => {
    expect(stepForErrorKey('reserveCurrencies')).toBe(0);
    expect(stepForErrorKey('rate.USD')).toBe(1);
    expect(stepForErrorKey('expenseTotal')).toBe(1);
    expect(stepForErrorKey('reserve.KZT')).toBe(2);
    expect(stepForErrorKey('horizonYears')).toBe(2);
  });
});

describe('restoreAssessmentDraft', () => {
  it('returns an empty draft for non-objects and unknown versions', () => {
    expect(restoreAssessmentDraft(null)).toEqual(emptyAssessmentDraft());
    expect(restoreAssessmentDraft('draft')).toEqual(emptyAssessmentDraft());
    expect(restoreAssessmentDraft([])).toEqual(emptyAssessmentDraft());
    expect(restoreAssessmentDraft({ ...mixedDraft(), version: 2 })).toEqual(emptyAssessmentDraft());
  });

  it('restores a valid draft unchanged', () => {
    const draft = mixedDraft({
      step: 2,
      reserveCurrencies: ['KZT', 'USD'],
      monthlyContribution: '0',
      conversionCost: 0.0025,
    });
    expect(restoreAssessmentDraft(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
  });

  it('restores currency selections in canonical KZT/USD/EUR order', () => {
    const restored = restoreAssessmentDraft(
      mixedDraft({ reserveCurrencies: ['EUR', 'USD', 'KZT'] }),
    );
    expect(restored.reserveCurrencies).toEqual(['KZT', 'USD', 'EUR']);
  });

  it('drops malformed fields, unsupported enums and persisted derived values', () => {
    const restored = restoreAssessmentDraft({
      version: 1,
      step: 9,
      country: 'US',
      baseCurrency: 'USD',
      incomeCurrencies: ['USD', 'GBP', 'USD', 7],
      expenseCurrencies: 'KZT',
      reserveCurrencies: ['EUR'],
      income: { USD: 1500, KZT: '1'.repeat(40), GBP: '5' },
      expenses: ['KZT'],
      reserves: { EUR: '200' },
      rates: { USD: '500', KZT: '2' },
      valuationDate: '2026-13-01',
      monthlyContribution: 12,
      horizonYears: 2,
      rebalanceFrequency: 'Monthly; drop table',
      conversionCost: Number.POSITIVE_INFINITY,
      incomeTotal: 999,
      expenseIncomeRatio: 0.1,
    });

    expect(restored).toEqual({
      ...emptyAssessmentDraft(),
      incomeCurrencies: ['USD'],
      reserveCurrencies: ['EUR'],
      reserves: { EUR: '200' },
      rates: { USD: '500' },
    });
    expect(restored).not.toHaveProperty('incomeTotal');
    expect(restored).not.toHaveProperty('expenseIncomeRatio');
  });

  it('clears reserve currencies when no reserve is declared', () => {
    const restored = restoreAssessmentDraft({
      ...mixedDraft(),
      noReserve: true,
      reserveCurrencies: ['USD'],
    });
    expect(restored.noReserve).toBe(true);
    expect(restored.reserveCurrencies).toEqual([]);
  });
});
