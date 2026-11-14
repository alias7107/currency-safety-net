import { EN_STRINGS } from '../i18n/en';
import { HOUSEHOLD_REQUEST, householdResult } from '../../testing/household-analysis.fixtures';
import type {
  HouseholdAnalysisRequest,
  HouseholdAnalysisResult,
  HouseholdComparisonOutcome,
} from './household-analysis.models';
import { validateHouseholdResult } from './household-analysis.validation';
import { buildHouseholdPlainLanguageSummary } from './household-plain-language';

const copy = EN_STRINGS.assessmentResults.plainLanguage;

function validated(
  outcome: HouseholdComparisonOutcome = 'optimized_lower',
  edit: (raw: Record<string, any>) => void = () => undefined,
  request: HouseholdAnalysisRequest = HOUSEHOLD_REQUEST,
): HouseholdAnalysisResult {
  const raw = householdResult(outcome, request);
  edit(raw);
  const checked = validateHouseholdResult(raw, request);
  if (!checked.ok) {
    throw new Error(`fixture rejected: ${checked.error.message}`);
  }
  return checked.value;
}

function allText(result: HouseholdAnalysisResult): string {
  const s = buildHouseholdPlainLanguageSummary(result);
  return [...s.startingPoint, ...s.simulation, ...s.comparison, s.interpretation].join(' ');
}

describe('buildHouseholdPlainLanguageSummary', () => {
  it('describes the starting point from the submitted scenario', () => {
    const s = buildHouseholdPlainLanguageSummary(validated());
    expect(s.startingPoint[0]).toBe(
      'Your essential expenses were 90% of your income. The rest is not necessarily money left over, because the assessment did not ask about your other spending.',
    );
    expect(s.startingPoint[1]).toContain('equal to 3 months of your entered essential expenses');
    expect(s.startingPoint[1]).toContain('not a prediction of how long your savings');
    expect(s.startingPoint.join(' ')).not.toMatch(/disposable|spare|free to spend/i);
  });

  it('states plainly when essential expenses exceed income, and when they equal it', () => {
    const above = { ...HOUSEHOLD_REQUEST, expense_income_ratio: 1.025 };
    expect(
      buildHouseholdPlainLanguageSummary(validated('optimized_lower', () => undefined, above))
        .startingPoint[0],
    ).toBe(
      'Your essential expenses were 102.5% of your income, which means they were higher than your income.',
    );
    const equal = { ...HOUSEHOLD_REQUEST, expense_income_ratio: 1 };
    expect(
      buildHouseholdPlainLanguageSummary(validated('optimized_lower', () => undefined, equal))
        .startingPoint[0],
    ).toBe(copy.ratioEqual);
  });

  it('never rounds a ratio that is not exactly 100% into "100%"', () => {
    const over = { ...HOUSEHOLD_REQUEST, expense_income_ratio: 1.0003 };
    expect(
      buildHouseholdPlainLanguageSummary(validated('optimized_lower', () => undefined, over))
        .startingPoint[0],
    ).toContain('just over 100% of your income, which means they were higher');
    const under = { ...HOUSEHOLD_REQUEST, expense_income_ratio: 0.9997 };
    expect(
      buildHouseholdPlainLanguageSummary(validated('optimized_lower', () => undefined, under))
        .startingPoint[0],
    ).toContain('were just under 100% of your income.');
  });

  it('reports the current mix shortfall share as a share of simulated scenarios', () => {
    const s = buildHouseholdPlainLanguageSummary(validated());
    expect(s.simulation[0]).toBe(
      'In 12% of simulated scenarios, income and available savings could not fully cover your entered essential expenses at some point over 3 years.',
    );
    expect(s.simulation[1]).toBe(copy.shortfallSomeNote);
  });

  it('uses the singular for a one-year horizon', () => {
    const oneYear = { ...HOUSEHOLD_REQUEST, horizon_years: 1 };
    const s = buildHouseholdPlainLanguageSummary(
      validated('optimized_lower', () => undefined, oneYear),
    );
    expect(s.simulation[0]).toContain('at some point over 1 year.');
  });

  it('says no shortfalls occurred for an exact zero without claiming there is no risk', () => {
    const s = buildHouseholdPlainLanguageSummary(
      validated('optimized_lower', (raw) => {
        raw['current_policy'].diagnostics.shortfall_probability = 0;
        raw['current_policy'].diagnostics.var95_cumulative_shortfall = 0;
      }),
    );
    expect(s.simulation).toEqual([interpolated(copy.shortfallNone, '3 years')]);
    expect(s.simulation[0]).toContain('no shortfalls occurred in these simulated scenarios');
    expect(s.simulation[0]).toContain('does not mean there is no risk');
    expect(s.simulation[0]).not.toMatch(/\b0%/);
  });

  it('never displays a small non-zero shortfall share as zero', () => {
    for (const p of [0.0001, 0.00049]) {
      const s = buildHouseholdPlainLanguageSummary(
        validated('optimized_lower', (raw) => {
          raw['current_policy'].diagnostics.shortfall_probability = p;
        }),
      );
      expect(s.simulation[0]).toContain('In less than 0.1% of simulated scenarios');
      expect(s.simulation[0]).not.toMatch(/\b0%|no shortfalls/);
    }
    const s = buildHouseholdPlainLanguageSummary(
      validated('optimized_lower', (raw) => {
        raw['current_policy'].diagnostics.shortfall_probability = 0.0006;
      }),
    );
    expect(s.simulation[0]).toContain('In 0.1% of simulated scenarios');
  });

  it('never displays a share below one as 100%', () => {
    const s = buildHouseholdPlainLanguageSummary(
      validated('optimized_lower', (raw) => {
        raw['current_policy'].diagnostics.shortfall_probability = 0.9996;
      }),
    );
    expect(s.simulation[0]).toContain('In more than 99.9% of simulated scenarios');
  });

  it('explains optimized_lower as a worst-5% severity comparison, not lower overall risk', () => {
    const s = buildHouseholdPlainLanguageSummary(validated('optimized_lower'));
    expect(s.outcome).toBe('optimized_lower');
    expect(s.comparison).toEqual([
      copy.comparisonIntro,
      copy.outcomes.optimized_lower,
      copy.severityNote,
    ]);
    expect(s.comparison.join(' ')).toContain('worst 5% of simulated scenarios was lower');
    expect(s.comparison.join(' ')).toContain('does not necessarily mean fewer shortfalls');
  });

  it('explains equal_within_tolerance without claiming everything is identical', () => {
    const s = buildHouseholdPlainLanguageSummary(validated('equal_within_tolerance'));
    expect(s.comparison[1]).toBe(copy.outcomes.equal_within_tolerance);
    expect(s.comparison[1]).toContain('essentially the same result');
    expect(s.comparison[1]).toContain('can still differ');
  });

  it('explains current_lower without claiming the current mix is the best possible', () => {
    const s = buildHouseholdPlainLanguageSummary(validated('current_lower'));
    expect(s.comparison[1]).toBe(copy.outcomes.current_lower);
    expect(s.comparison[1]).toContain('better than the alternatives the model tested');
    expect(s.comparison[1]).toContain('does not make it the best possible mix');
  });

  it('uses the validated outcome, not the size of the rounded difference', () => {
    const tie = buildHouseholdPlainLanguageSummary(validated('equal_within_tolerance'));
    expect(tie.outcome).toBe('equal_within_tolerance');
    expect(tie.comparison[1]).not.toContain('did better');
  });

  it('adds the not-identified note only for class C, for every outcome', () => {
    for (const outcome of ['optimized_lower', 'current_lower', 'equal_within_tolerance'] as const) {
      const c = buildHouseholdPlainLanguageSummary(
        validated(outcome, (raw) => {
          raw['optimized_policy'].identification.identification_class = 'C_NOT_IDENTIFIED';
        }),
      );
      expect(c.notIdentified).toBe(true);
      expect(c.comparison[c.comparison.length - 1]).toBe(copy.notIdentified);
      expect(copy.notIdentified).toContain('not a uniquely preferred choice');
      expect(copy.notIdentified).not.toMatch(/identical|exactly the same|all .* tie/i);
    }
    const b = buildHouseholdPlainLanguageSummary(validated('optimized_lower'));
    expect(b.notIdentified).toBe(false);
    expect(b.comparison).not.toContain(copy.notIdentified);
  });

  it('keeps the interpretation note short and mentions assumptions and switching costs', () => {
    const s = buildHouseholdPlainLanguageSummary(validated());
    expect(s.interpretation).toContain(
      'depend on the amounts, currencies and settings you entered',
    );
    expect(s.interpretation).toContain('does not include the cost of switching');
  });

  it('avoids jargon, identifiers, scores, invented amounts and instructions', () => {
    for (const outcome of ['optimized_lower', 'current_lower', 'equal_within_tolerance'] as const) {
      const text = allText(
        validated(outcome, (raw) => {
          raw['optimized_policy'].identification.identification_class = 'C_NOT_IDENTIFIED';
        }),
      );
      expect(text).not.toMatch(
        /CVaR|VaR|C_NOT|_IDENTIFIED|optimized_lower|grid|score|risk band|you should|\bbuy\b|\bsell\b|KZT|USD|EUR|₸|\$|€|=/,
      );
    }
  });
});

function interpolated(template: string, horizon: string): string {
  return template.replace('{horizon}', horizon);
}
