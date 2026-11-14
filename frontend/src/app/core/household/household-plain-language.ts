import { EN_STRINGS } from '../i18n/en';
import { formatBufferMonths, formatHorizon, formatPercent, interpolate } from '../util/format.util';
import type {
  HouseholdAnalysisResult,
  HouseholdComparisonOutcome,
} from './household-analysis.models';

export interface HouseholdPlainLanguageSummary {
  outcome: HouseholdComparisonOutcome;
  notIdentified: boolean;
  startingPoint: string[];
  simulation: string[];
  comparison: string[];
  interpretation: string;
}

const copy = EN_STRINGS.assessmentResults.plainLanguage;


export function buildHouseholdPlainLanguageSummary(
  result: HouseholdAnalysisResult,
): HouseholdPlainLanguageSummary {
  const { scenario } = result;
  const horizon = formatHorizon(scenario.horizon_years);
  const outcome = result.comparison.outcome;
  const notIdentified =
    result.optimized_policy.identification.identification_class === 'C_NOT_IDENTIFIED';

  const comparison: string[] = [copy.comparisonIntro, copy.outcomes[outcome], copy.severityNote];
  if (notIdentified) {
    comparison.push(copy.notIdentified);
  }

  return {
    outcome,
    notIdentified,
    startingPoint: [
      ratioSentence(scenario.expense_income_ratio),
      interpolate(copy.coverage, { months: formatBufferMonths(scenario.buffer_months) }),
    ],
    simulation: shortfallSentences(
      result.current_policy.diagnostics.shortfall_probability,
      horizon,
    ),
    comparison,
    interpretation: copy.interpretation,
  };
}

function ratioSentence(ratio: number): string {
  if (ratio === 1) {
    return copy.ratioEqual;
  }
  let text = formatPercent(ratio, 1);
  if (text === '100%') {
    text = ratio > 1 ? copy.justOverHundred : copy.justUnderHundred;
  }
  return interpolate(ratio > 1 ? copy.ratioAbove : copy.ratioBelow, { ratio: text });
}

function shortfallSentences(probability: number, horizon: string): string[] {
  if (probability === 0) {
    return [interpolate(copy.shortfallNone, { horizon })];
  }
  return [
    interpolate(copy.shortfallSome, { percentage: plainShare(probability), horizon }),
    copy.shortfallSomeNote,
  ];
}

/** Non-zero shares never read as 0%, and shares below one never read as 100%. */
function plainShare(value: number): string {
  const text = formatPercent(value, 1);
  if (text.startsWith('<')) {
    return interpolate(copy.lessThan, { value: text.slice(1) });
  }
  if (value < 1 && text === '100%') {
    return interpolate(copy.moreThan, { value: formatPercent(0.999, 1) });
  }
  return text;
}
