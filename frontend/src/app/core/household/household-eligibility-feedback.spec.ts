import { evaluateAssessment } from '../assessment/assessment-normalization';
import { emptyAssessmentDraft, type AssessmentDraft } from '../assessment/assessment.model';
import { EN_STRINGS } from '../i18n/en';
import { evaluateSimulationEligibility } from './household-analysis.request';
import {
  buildConversionCostFeedback,
  buildCoverageFeedback,
  buildRatioFeedback,
  buildRebalanceFeedback,
  textAgainstRange,
} from './household-eligibility-feedback';

const inline = EN_STRINGS.assessment.simulation.inline;
const TODAY = '2026-11-13';

/** KZT-only household; amounts chosen so ratios and months are exact. */
function draft(overrides: Partial<AssessmentDraft> = {}): AssessmentDraft {
  return {
    ...emptyAssessmentDraft(),
    incomeCurrencies: ['KZT'],
    expenseCurrencies: ['KZT'],
    reserveCurrencies: ['KZT'],
    income: { KZT: '1000000' },
    expenses: { KZT: '900000' },
    reserves: { KZT: '2700000' },
    horizonYears: 3,
    rebalanceFrequency: 'quarterly',
    conversionCost: 0.0025,
    ...overrides,
  };
}

const evaluate = (d: AssessmentDraft) => evaluateAssessment(d, TODAY);
const ratio = (d: AssessmentDraft) => buildRatioFeedback(evaluate(d));
const coverage = (d: AssessmentDraft) => buildCoverageFeedback(evaluate(d));

describe('inline simulation feedback', () => {
  describe('essential expenses as a share of income', () => {
    it('shows the value and the supported range for a supported ratio', () => {
      const f = ratio(draft());
      expect(f.state).toBe('supported');
      expect(f.text).toBe(
        'Your essential expenses are 90% of your income. Personal simulations currently support 80%–105%, so this value is within the supported range.',
      );
      expect(f.modelLimit).toBeNull();
    });

    it('treats both boundaries as inclusive on unrounded values', () => {
      expect(ratio(draft({ expenses: { KZT: '800000' } })).state).toBe('supported');
      expect(ratio(draft({ expenses: { KZT: '1050000' } })).state).toBe('supported');
      expect(ratio(draft({ expenses: { KZT: '1050000' } })).text).toContain('are 105% of your');
    });

    it('never rounds a value just outside a boundary onto it', () => {
      const over = ratio(draft({ expenses: { KZT: '1050001' } }));
      expect(over.state).toBe('outside');
      expect(over.text).toContain('are just over 105% of your income');
      expect(over.text).toContain('You can still continue to your household overview.');
      expect(over.modelLimit).toBe(inline.modelLimit);

      const under = ratio(draft({ expenses: { KZT: '799999' } }));
      expect(under.state).toBe('outside');
      expect(under.text).toContain('are just under 80% of your income');
    });

    it('shows a clear outside value without the "just" qualifier', () => {
      const f = ratio(draft({ expenses: { KZT: '500000' } }));
      expect(f.state).toBe('outside');
      expect(f.text).toContain('are 50% of your income');
      expect(f.text).toContain('a personal simulation is not available for this value');
    });

    it('shows no value or conclusion until amounts and rates are valid', () => {
      const incomplete = [
        draft({ expenses: {} }),
        draft({ expenses: { KZT: '12,5' } }),
        draft({ income: { KZT: '0' } }),
        draft({ incomeCurrencies: ['KZT', 'USD'], income: { KZT: '1000000', USD: '100' } }),
        draft({
          incomeCurrencies: ['KZT', 'USD'],
          income: { KZT: '1000000', USD: '100' },
          rates: { USD: '-5' },
        }),
        draft({ incomeCurrencies: [] }),
      ];
      for (const d of incomplete) {
        const f = ratio(d);
        expect(f.state).toBe('pending');
        expect(f.text).toBe(inline.ratioPending.replace('{min}', '80%').replace('{max}', '105%'));
        expect(f.text).not.toMatch(/not available|are \d/);
        expect(f.modelLimit).toBeNull();
      }
    });

    it('recalculates with the user’s exchange rates', () => {
      const d = draft({
        incomeCurrencies: ['KZT', 'USD'],
        income: { KZT: '500000', USD: '1000' },
        rates: { USD: '500' },
      });
      expect(ratio(d).text).toContain('are 90% of your income');
      expect(ratio({ ...d, rates: { USD: '1000' } }).state).toBe('outside');
      expect(ratio({ ...d, rates: { USD: '1000' } }).text).toContain('are 60% of your income');
    });
  });

  describe('reserve coverage', () => {
    it('shows months of essential expenses with the supported range', () => {
      const f = coverage(draft());
      expect(f.state).toBe('supported');
      expect(f.text).toBe(
        'Your reserve covers 3 months of essential expenses. Personal simulations currently support 1–12 months, so this value is within the supported range.',
      );
    });

    it('treats 1 and 12 months as supported and anything beyond as outside', () => {
      const e = { expenses: { KZT: '100000' } };
      expect(coverage(draft({ ...e, reserves: { KZT: '100000' } })).text).toContain(
        'covers 1 month',
      );
      expect(coverage(draft({ ...e, reserves: { KZT: '100000' } })).state).toBe('supported');
      expect(coverage(draft({ ...e, reserves: { KZT: '1200000' } })).state).toBe('supported');
      const over = coverage(draft({ ...e, reserves: { KZT: '1200001' } }));
      expect(over.state).toBe('outside');
      expect(over.text).toContain('covers just over 12 months');
      expect(over.text).toContain('Your household overview is still available.');
      const under = coverage(draft({ ...e, reserves: { KZT: '99999' } }));
      expect(under.state).toBe('outside');
      expect(under.text).toContain('covers just under 1 month');
    });

    it('explains that a simulation needs an existing reserve', () => {
      for (const d of [
        draft({ noReserve: true, reserveCurrencies: [], reserves: {} }),
        draft({ reserves: { KZT: '0' } }),
      ]) {
        const f = coverage(d);
        expect(f.state).toBe('none');
        expect(f.text).toBe(inline.coverageNone.replace('{min}', '1').replace('{max}', '12'));
        expect(f.modelLimit).toBe(inline.modelLimit);
      }
    });

    it('shows no coverage until reserve amounts and essential expenses are valid', () => {
      for (const d of [
        draft({ reserves: {} }),
        draft({ reserves: { KZT: 'abc' } }),
        draft({ expenses: {} }),
        draft({ reserveCurrencies: ['USD'], reserves: { USD: '100' } }),
      ]) {
        const f = coverage(d);
        expect(f.state).toBe('pending');
        expect(f.text).not.toMatch(/not available|covers \d/);
      }
    });
  });

  it('agrees with final eligibility for every ratio and coverage value', () => {
    for (const expenses of [799999, 800000, 900000, 1050000, 1050001]) {
      for (const reserve of [0.99999, 1, 6, 12, 12.00001]) {
        const d = draft({
          expenses: { KZT: String(expenses) },
          reserves: { KZT: (reserve * expenses).toFixed(2) },
        });
        const evaluation = evaluate(d);
        const codes = evaluateSimulationEligibility(evaluation).reasons.map((r) => r.code);
        expect(buildRatioFeedback(evaluation).state === 'supported').toBe(
          !codes.includes('expense_income_ratio_out_of_supported_range'),
        );
        expect(buildCoverageFeedback(evaluation).state === 'supported').toBe(
          !codes.includes('buffer_months_out_of_supported_range'),
        );
      }
    }
  });

  it('keeps in-range values that round to a boundary as they are', () => {
    const range = { min: 0.8, max: 1.05 };
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    expect(textAgainstRange(1.0496, range, pct)).toBe('105%');
    expect(textAgainstRange(1.0504, range, pct)).toBe('just over 105%');
    expect(textAgainstRange(0.7996, range, pct)).toBe('just under 80%');
  });

  describe('settings', () => {
    it('stays silent when every offered and selected value is supported', () => {
      expect(buildRebalanceFeedback(['monthly', 'quarterly', 'none'], 'quarterly')).toBeNull();
      expect(buildConversionCostFeedback([0, 0.0025, 0.005, 0.01], 0.01)).toBeNull();
    });

    it('lists the supported frequencies when an unsupported one is offered or selected', () => {
      const offered = buildRebalanceFeedback(['monthly', 'annual'], 'monthly')!;
      expect(offered.state).toBe('supported');
      expect(offered.text).toBe(
        'Personal simulations currently support monthly, quarterly, or no rebalancing.',
      );
      const selected = buildRebalanceFeedback(['monthly', 'annual'], 'annual')!;
      expect(selected.state).toBe('outside');
      expect(selected.text).toContain('not available with the selected frequency');
      expect(selected.modelLimit).toBe(inline.modelLimit);
    });

    it('shows the supported conversion-cost range when a higher cost is offered or selected', () => {
      expect(buildConversionCostFeedback([0, 0.02], 0)!.text).toBe(
        'Personal simulations currently support conversion costs from 0% to 1%.',
      );
      const selected = buildConversionCostFeedback([0, 0.02], 0.02)!;
      expect(selected.state).toBe('outside');
      expect(selected.text).toContain('not available with the selected cost');
    });
  });
});
