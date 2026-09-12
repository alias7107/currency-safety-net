import type { OptimizationResult } from '../api/models';
import { EN_STRINGS } from '../i18n/en';
import {
  buildResultNarrativeParagraphs,
  describeAllocation,
  expenseRatioObservation,
  profileDisplayTitle,
} from './result-interpretation.util';

const BASE: OptimizationResult = {
  model_version: 'test-interp-9.1',
  data_as_of: '2019-06-15',
  simulation_paths: 2500,
  simulation_seed: 17,
  profile: 'P3_mixed_income',
  horizon_years: 2,
  expense_income_ratio: 0.88,
  buffer_months: 4,
  rebalance_frequency: 'quarterly',
  conversion_cost: 0.005,
  weights: [0.15, 0.55, 0.3],
  shortfall_probability: 0.21,
  var95_cumulative_shortfall: 0.33,
  cvar95_cumulative_shortfall: 0.77,
  mean_cumulative_shortfall: 0.09,
  wealth_depletion_probability: 0.04,
};

describe('result-interpretation.util', () => {
  it('maps known profiles to display titles and hides unknown internals', () => {
    expect(profileDisplayTitle('P3_mixed_income')).toBe(EN_STRINGS.profiles.P3.title);
    expect(profileDisplayTitle('totally_unknown_label')).toBe(
      EN_STRINGS.compare.profileUnavailable,
    );
    expect(profileDisplayTitle('totally_unknown_label')).not.toContain('totally_unknown');
  });

  it('describes expense-to-income ratio arithmetically only', () => {
    expect(expenseRatioObservation(0.88)).toBe('below');
    expect(expenseRatioObservation(1)).toBe('equal');
    expect(expenseRatioObservation(1.05)).toBe('above');
  });

  it('builds allocation narrative from arbitrary weights', () => {
    const narrative = describeAllocation([0.1, 0.7, 0.2]);
    expect(narrative?.largest?.code).toBe('USD');
    expect(narrative?.tiedLargest).toBeNull();
    expect(narrative?.spread).toBe('distributed');
    expect(narrative?.allocationText).toContain('KZT');
    expect(narrative?.allocationText).toContain('70%');

    const concentrated = describeAllocation([0, 1, 0]);
    expect(concentrated?.spread).toBe('concentrated');
    expect(concentrated?.largest?.code).toBe('USD');
  });

  it('identifies a unique largest currency without inventing a tie', () => {
    const narrative = describeAllocation([0.6, 0.3, 0.1]);
    expect(narrative?.largest?.code).toBe('KZT');
    expect(narrative?.tiedLargest).toBeNull();
    expect(narrative?.spread).toBe('distributed');
  });

  it('reports a two-currency tie for the largest returned weight', () => {
    const narrative = describeAllocation([0.5, 0.5, 0]);
    expect(narrative?.largest).toBeNull();
    expect(narrative?.tiedLargest?.map((item) => item.code)).toEqual(['KZT', 'USD']);
    expect(narrative?.largestPercent).toBe('50%');
    expect(narrative?.spread).toBe('distributed');

    const text = buildResultNarrativeParagraphs({
      ...BASE,
      weights: [0.5, 0.5, 0],
    }).join(' ');
    expect(text).toContain('share the largest returned weight');
    expect(text).toContain('Kazakhstani tenge');
    expect(text).toContain('US dollar');
  });

  it('reports a three-currency tie for equal weights', () => {
    const third = 1 / 3;
    const narrative = describeAllocation([third, third, third]);
    expect(narrative?.largest).toBeNull();
    expect(narrative?.tiedLargest?.map((item) => item.code)).toEqual(['KZT', 'USD', 'EUR']);
    expect(narrative?.spread).toBe('distributed');

    const text = buildResultNarrativeParagraphs({
      ...BASE,
      weights: [third, third, third],
    }).join(' ');
    expect(text).toContain('share the largest returned weight');
    expect(text).toContain('Euro');
  });

  it('changes narrative text when weights change', () => {
    const first = buildResultNarrativeParagraphs({
      ...BASE,
      weights: [0.8, 0.1, 0.1],
    });
    const second = buildResultNarrativeParagraphs({
      ...BASE,
      weights: [0.1, 0.1, 0.8],
    });
    expect(first.join(' ')).toContain('Kazakhstani tenge');
    expect(second.join(' ')).toContain('Euro');
    expect(first.join(' ')).not.toEqual(second.join(' '));
  });

  it('does not invent advice language', () => {
    const text = buildResultNarrativeParagraphs(BASE).join(' ').toLowerCase();
    expect(text).toContain('the model returned');
    expect(text).not.toContain('best');
    expect(text).not.toContain('safe');
    expect(text).not.toContain('recommend');
    expect(text).not.toContain('resilience score');
  });
});

describe('wealth-depletion copy accuracy', () => {
  it('describes terminal end-of-horizon depletion, not anytime path events', () => {
    const definition = EN_STRINGS.results.phase2b.diagnostics.depletion.definition;
    const howToRead = EN_STRINGS.results.phase2b.diagnostics.depletion.howToRead;
    const combined = `${definition} ${howToRead}`.toLowerCase();

    expect(definition).toContain('at the end of the horizon');
    expect(definition).toContain('depletion tolerance');
    expect(howToRead.toLowerCase()).toContain('end-of-horizon');
    expect(combined).not.toContain('before the horizon ended');
    expect(combined).not.toContain('at some point');
  });
});
