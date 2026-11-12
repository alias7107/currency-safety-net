import { evaluateAssessment } from '../assessment/assessment-normalization';
import { emptyAssessmentDraft, type AssessmentDraft } from '../assessment/assessment.model';
import {
  buildHouseholdAnalysisRequest,
  evaluateSimulationEligibility,
  stepForReasonField,
} from './household-analysis.request';

const TODAY = '2026-11-11';

const CONTRACT_KEYS = [
  'contract_version',
  'income_shares',
  'expense_shares',
  'current_reserve_weights',
  'expense_income_ratio',
  'buffer_months',
  'horizon_years',
  'rebalance_frequency',
  'conversion_cost',
].sort();

/** Mixed currencies with different user rates; not a P1–P4 composition. */
function mixedDraft(overrides: Partial<AssessmentDraft> = {}): AssessmentDraft {
  return {
    ...emptyAssessmentDraft(),
    step: 4,
    incomeCurrencies: ['KZT', 'USD'],
    expenseCurrencies: ['KZT', 'EUR'],
    reserveCurrencies: ['USD', 'EUR'],
    income: { KZT: '300 000', USD: '1000' },
    expenses: { KZT: '600000', EUR: '200' },
    reserves: { USD: '2000', EUR: '500' },
    rates: { USD: '500', EUR: '550' },
    valuationDate: '2026-11-01',
    monthlyContribution: '75000',
    horizonYears: 3,
    rebalanceFrequency: 'quarterly',
    conversionCost: 0.0025,
    ...overrides,
  };
}

function eligibility(draft: AssessmentDraft) {
  return evaluateSimulationEligibility(evaluateAssessment(draft, TODAY));
}

function codes(draft: AssessmentDraft): string[] {
  return eligibility(draft).reasons.map((r) => r.code);
}

describe('household-analysis request builder', () => {
  it('maps the normalized overview exactly, in canonical KZT/USD/EUR order', () => {
    const evaluation = evaluateAssessment(mixedDraft(), TODAY);
    const request = buildHouseholdAnalysisRequest(evaluation)!;
    const { overview } = evaluation;

    expect(Object.keys(request).sort()).toEqual(CONTRACT_KEYS);
    expect(request.contract_version).toBe('household_analysis_v1');
    // Same values the overview computed, not re-rounded or renormalized.
    expect(request.income_shares).toEqual(overview.income!.shareVector);
    expect(request.expense_shares).toEqual(overview.expenses!.shareVector);
    expect(request.current_reserve_weights).toEqual(overview.reserve!.composition);
    expect(request.expense_income_ratio).toBe(overview.expenseIncomeRatio);
    expect(request.buffer_months).toBe(overview.reserve!.coverageMonths);

    expect(request.income_shares).toEqual([300000 / 800000, 500000 / 800000, 0]);
    expect(request.expense_shares).toEqual([600000 / 710000, 0, 110000 / 710000]);
    expect(request.current_reserve_weights).toEqual([0, 1000000 / 1275000, 275000 / 1275000]);
    expect(request.expense_income_ratio).toBe(710000 / 800000);
    expect(request.buffer_months).toBe(1275000 / 710000);
    expect(request.horizon_years).toBe(3);
    expect(request.rebalance_frequency).toBe('quarterly');
    expect(request.conversion_cost).toBe(0.0025);
  });

  it('never includes raw amounts, rates, the valuation date, contribution, country or base currency', () => {
    const request = buildHouseholdAnalysisRequest(evaluateAssessment(mixedDraft(), TODAY))!;
    const json = JSON.stringify(request);
    for (const forbidden of [
      '300000',
      '600000',
      '"500"',
      '550',
      '2026-11-01',
      '75000',
      'KZ',
      'KZT',
      'country',
      'base',
      'rate',
      'valuation',
      'contribution',
      'acknowledg',
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('reflects a different user rate in the shares', () => {
    const a = buildHouseholdAnalysisRequest(evaluateAssessment(mixedDraft(), TODAY))!;
    const b = buildHouseholdAnalysisRequest(
      evaluateAssessment(mixedDraft({ rates: { USD: '510', EUR: '550' } }), TODAY),
    )!;
    expect(b.income_shares[1]).toBe(510000 / 810000);
    expect(b.income_shares).not.toEqual(a.income_shares);
  });

  it('accepts the inclusive supported boundaries', () => {
    // ratio exactly 0.80 and 1.05; buffer exactly 1 and 12; cost exactly 0 and 0.01.
    const base = {
      incomeCurrencies: ['KZT'],
      expenseCurrencies: ['KZT'],
      reserveCurrencies: ['KZT'],
      rates: {},
      valuationDate: '',
    } as Partial<AssessmentDraft>;
    const cases: Partial<AssessmentDraft>[] = [
      { income: { KZT: '100000' }, expenses: { KZT: '80000' }, reserves: { KZT: '80000' } },
      { income: { KZT: '100000' }, expenses: { KZT: '105000' }, reserves: { KZT: '1260000' } },
      {
        income: { KZT: '100000' },
        expenses: { KZT: '90000' },
        reserves: { KZT: '90000' },
        conversionCost: 0,
      },
      {
        income: { KZT: '100000' },
        expenses: { KZT: '90000' },
        reserves: { KZT: '1080000' },
        conversionCost: 0.01,
      },
    ];
    for (const c of cases) {
      const result = eligibility(mixedDraft({ ...base, ...c }));
      expect(result.reasons).toEqual([]);
      expect(result.eligible).toBe(true);
    }
  });

  it('rejects values just outside each supported range, with every reason listed', () => {
    const base = {
      incomeCurrencies: ['KZT'],
      expenseCurrencies: ['KZT'],
      reserveCurrencies: ['KZT'],
      rates: {},
      valuationDate: '',
    } as Partial<AssessmentDraft>;
    expect(
      codes(
        mixedDraft({
          ...base,
          income: { KZT: '100000' },
          expenses: { KZT: '79999' },
          reserves: { KZT: '100000' },
        }),
      ),
    ).toEqual(['expense_income_ratio_out_of_supported_range']);
    expect(
      codes(
        mixedDraft({
          ...base,
          income: { KZT: '100000' },
          expenses: { KZT: '105001' },
          reserves: { KZT: '200000' },
        }),
      ),
    ).toEqual(['expense_income_ratio_out_of_supported_range']);
    expect(
      codes(
        mixedDraft({
          ...base,
          income: { KZT: '100000' },
          expenses: { KZT: '90000' },
          reserves: { KZT: '89999' },
        }),
      ),
    ).toEqual(['buffer_months_out_of_supported_range']);
    expect(
      codes(
        mixedDraft({
          ...base,
          income: { KZT: '100000' },
          expenses: { KZT: '90000' },
          reserves: { KZT: '1080001' },
        }),
      ),
    ).toEqual(['buffer_months_out_of_supported_range']);
    expect(
      codes(
        mixedDraft({
          ...base,
          income: { KZT: '100000' },
          expenses: { KZT: '50000' },
          reserves: { KZT: '10000' },
          conversionCost: 0.02,
        }),
      ),
    ).toEqual([
      'expense_income_ratio_out_of_supported_range',
      'buffer_months_out_of_supported_range',
      'conversion_cost_out_of_supported_range',
    ]);
  });

  it('treats a declared zero reserve as a valid overview that cannot be simulated', () => {
    const draft = mixedDraft({ noReserve: true, reserveCurrencies: [], reserves: {} });
    const evaluation = evaluateAssessment(draft, TODAY);
    expect(evaluation.complete).toBe(true);
    const result = evaluateSimulationEligibility(evaluation);
    expect(result.eligible).toBe(false);
    expect(result.request).toBeNull();
    expect(result.reasons).toEqual([{ code: 'no_current_reserve', step: 2 }]);
  });

  it('treats a zero reserve balance the same way', () => {
    expect(codes(mixedDraft({ reserves: { USD: '0', EUR: '0' } }))).toEqual(['no_current_reserve']);
  });

  it('requires explicitly selected model settings', () => {
    expect(codes(mixedDraft({ rebalanceFrequency: null, conversionCost: null }))).toEqual([
      'rebalance_frequency_not_selected',
      'conversion_cost_not_selected',
    ]);
    expect(codes(mixedDraft({ rebalanceFrequency: 'weekly' }))).toEqual([
      'rebalance_frequency_unsupported',
    ]);
  });

  it('reports incomplete answers with the first invalid step', () => {
    const result = eligibility(mixedDraft({ income: { KZT: '', USD: '1000' } }));
    expect(result.reasons).toEqual([{ code: 'answers_incomplete', step: 1 }]);
    expect(result.request).toBeNull();
  });

  it('leaves the draft and its overview unchanged when ineligible', () => {
    const draft = mixedDraft({ expenses: { KZT: '100000', EUR: '0' } });
    const snapshot = JSON.stringify(draft);
    const evaluation = evaluateAssessment(draft, TODAY);
    const before = JSON.stringify(evaluation);
    evaluateSimulationEligibility(evaluation);
    expect(JSON.stringify(draft)).toBe(snapshot);
    expect(JSON.stringify(evaluation)).toBe(before);
  });

  it('maps server reason fields to questionnaire steps', () => {
    expect(stepForReasonField('expense_income_ratio')).toBe(1);
    expect(stepForReasonField('buffer_months')).toBe(2);
    expect(stepForReasonField('current_reserve_weights')).toBe(2);
    expect(stepForReasonField('conversion_cost')).toBe(3);
  });
});
