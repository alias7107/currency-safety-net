import type { OptimizationResult } from '../api/models';
import { EN_STRINGS } from '../i18n/en';
import { formatInteger, formatMonthsOfIncome, formatPercent } from './format.util';
import { buildIdentificationPresentation } from './result-presentation.util';

export interface ResilienceProfileMetric {
  key: string;
  role: 'objective' | 'diagnostic' | 'implementation_only';
  title: string;
  value: string;
  unit: string | null;
  definition: string;
  howToRead: string;
  note: string | null;
  badge: string | null;
}

export interface ResilienceIdentificationView {
  label: string;
  body: string;
  nearOptimalCount: string | null;
  nearOptimalFraction: string | null;
  surfaceNote: string;
}

export interface ResilienceProfileViewModel {
  heading: string;
  body: string;
  objective: ResilienceProfileMetric;
  frequency: ResilienceProfileMetric;
  depletion: ResilienceProfileMetric;
  additionalDiagnostics: ResilienceProfileMetric[];
  identification: ResilienceIdentificationView;
  zeroVarNote: string | null;
  notScoreNote: string;
}

/**
 * Pure presentation model for the multi-metric Resilience Profile.
 * Every numeric display string originates from the supplied API result.
 */
export function buildResilienceProfileViewModel(
  result: OptimizationResult,
): ResilienceProfileViewModel {
  const copy = EN_STRINGS.resilienceProfile;
  const months = copy.units.monthsOfIncome;
  const phase2b = EN_STRINGS.results.phase2b.diagnostics;

  const objective: ResilienceProfileMetric = {
    key: 'cvar95_cumulative_shortfall',
    role: 'objective',
    title: copy.objective.title,
    value: formatMonthsOfIncome(result.cvar95_cumulative_shortfall),
    unit: months,
    definition: copy.objective.definition,
    howToRead: copy.objective.howToRead,
    note: copy.objective.notAdvice,
    badge: copy.objective.badge,
  };

  const frequency: ResilienceProfileMetric = {
    key: 'shortfall_probability',
    role: 'diagnostic',
    title: copy.frequency.title,
    value: formatPercent(result.shortfall_probability, 2),
    unit: null,
    definition: copy.frequency.definition,
    howToRead: copy.frequency.howToRead,
    note: null,
    badge: copy.frequency.badge,
  };

  const depletion: ResilienceProfileMetric = {
    key: 'wealth_depletion_probability',
    role: 'implementation_only',
    title: copy.depletion.title,
    value: formatPercent(result.wealth_depletion_probability, 2),
    unit: null,
    definition: copy.depletion.definition,
    howToRead: copy.depletion.howToRead,
    note: copy.depletion.horizonNote,
    badge: copy.depletion.badge,
  };

  const var95Note = result.var95_cumulative_shortfall === 0 ? phase2b.var95.zeroNote : null;

  const additionalDiagnostics: ResilienceProfileMetric[] = [
    {
      key: 'var95_cumulative_shortfall',
      role: 'diagnostic',
      title: copy.additional.var95.title,
      value: formatMonthsOfIncome(result.var95_cumulative_shortfall),
      unit: months,
      definition: copy.additional.var95.definition,
      howToRead: copy.additional.var95.howToRead,
      note: var95Note,
      badge: copy.additional.badge,
    },
    {
      key: 'mean_cumulative_shortfall',
      role: 'diagnostic',
      title: copy.additional.meanShortfall.title,
      value: formatMonthsOfIncome(result.mean_cumulative_shortfall),
      unit: months,
      definition: copy.additional.meanShortfall.definition,
      howToRead: copy.additional.meanShortfall.howToRead,
      note: null,
      badge: copy.additional.badge,
    },
  ];

  const identity = buildIdentificationPresentation(result.identification_class);
  const identification: ResilienceIdentificationView = {
    label: identity.label,
    body: identity.body,
    nearOptimalCount:
      result.near_optimal_1pct_count !== undefined
        ? formatInteger(result.near_optimal_1pct_count)
        : null,
    nearOptimalFraction:
      result.near_optimal_1pct_frac !== undefined
        ? formatPercent(result.near_optimal_1pct_frac, 2)
        : null,
    surfaceNote: copy.identification.surfaceNote,
  };

  return {
    heading: copy.heading,
    body: copy.body,
    objective,
    frequency,
    depletion,
    additionalDiagnostics,
    identification,
    zeroVarNote: var95Note,
    notScoreNote: copy.notScoreNote,
  };
}
