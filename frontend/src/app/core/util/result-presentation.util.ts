import type { OptimizationResult } from '../api/models';
import { EN_STRINGS } from '../i18n/en';
import {
  formatBufferMonths,
  formatConversionCost,
  formatHorizon,
  formatInteger,
  formatMonthsOfIncome,
  formatPercent,
  formatRatio,
  formatRebalanceFrequency,
} from './format.util';
import { profileDisplayTitle } from './result-interpretation.util';

const WELL_IDENTIFIED = 'A_WELL_IDENTIFIED';

export interface DiagnosticMetricView {
  key: string;
  label: string;
  value: string;
  unit: string | null;
  definition: string;
  howToRead: string;
  note: string | null;
}

export interface ProvenanceDetailRow {
  key: string;
  label: string;
  value: string;
}

export interface IdentificationPresentation {
  label: string;
  body: string;
}

/** Format CVaR95 cumulative shortfall using the shared months-of-income formatter. */
export function formatCvar95Value(result: OptimizationResult): string {
  return formatMonthsOfIncome(result.cvar95_cumulative_shortfall);
}

/**
 * Diagnostic metrics already returned by the API and shown on results/report.
 * CVaR95 is excluded — it is the optimization objective, not a diagnostic.
 */
export function buildDiagnosticMetricViews(result: OptimizationResult): DiagnosticMetricView[] {
  const labels = EN_STRINGS.results.metrics;
  const copy = EN_STRINGS.results.phase2b.diagnostics;
  const months = EN_STRINGS.results.phase2b.objectiveUnit;

  return [
    {
      key: 'shortfall_probability',
      label: labels.shortfallProbability.label,
      value: formatPercent(result.shortfall_probability, 2),
      unit: null,
      definition: copy.shortfallProbability.definition,
      howToRead: copy.shortfallProbability.howToRead,
      note: null,
    },
    {
      key: 'var95_cumulative_shortfall',
      label: labels.var95.label,
      value: formatMonthsOfIncome(result.var95_cumulative_shortfall),
      unit: months,
      definition: copy.var95.definition,
      howToRead: copy.var95.howToRead,
      note: result.var95_cumulative_shortfall === 0 ? copy.var95.zeroNote : null,
    },
    {
      key: 'mean_cumulative_shortfall',
      label: labels.meanShortfall.label,
      value: formatMonthsOfIncome(result.mean_cumulative_shortfall),
      unit: months,
      definition: copy.meanShortfall.definition,
      howToRead: copy.meanShortfall.howToRead,
      note: null,
    },
    {
      key: 'wealth_depletion_probability',
      label: labels.depletion.label,
      value: formatPercent(result.wealth_depletion_probability, 2),
      unit: null,
      definition: copy.depletion.definition,
      howToRead: copy.depletion.howToRead,
      note: null,
    },
  ];
}

/**
 * Safe public identification presentation.
 * Only the documented well-identified class gets a mapped label; other raw
 * identifiers are not exposed.
 */
export function buildIdentificationPresentation(
  identificationClass: string | null | undefined,
): IdentificationPresentation | null {
  if (!identificationClass) {
    return null;
  }
  if (identificationClass === WELL_IDENTIFIED) {
    return {
      label: EN_STRINGS.results.identificationWellIdentified,
      body: EN_STRINGS.results.identificationWellIdentifiedBody,
    };
  }
  return {
    label: EN_STRINGS.common.notAvailable,
    body: EN_STRINGS.results.identificationOtherBody,
  };
}

/**
 * Reproducibility / model-detail rows from the API payload.
 * Optional grid counts are omitted when absent. Job ID is included when provided.
 */
export function buildProvenanceDetailRows(
  result: OptimizationResult,
  jobId: string | null = null,
): ProvenanceDetailRow[] {
  const labels = EN_STRINGS.results.detailLabels;
  const rows: ProvenanceDetailRow[] = [
    { key: 'profile', label: labels.profile, value: profileDisplayTitle(result.profile) },
    { key: 'horizon', label: labels.horizon, value: formatHorizon(result.horizon_years) },
    { key: 'ratio', label: labels.ratio, value: formatRatio(result.expense_income_ratio) },
    { key: 'buffer', label: labels.buffer, value: formatBufferMonths(result.buffer_months) },
    {
      key: 'rebalance',
      label: labels.rebalance,
      value: formatRebalanceFrequency(result.rebalance_frequency),
    },
    {
      key: 'conversion',
      label: labels.conversionCost,
      value: formatConversionCost(result.conversion_cost),
    },
    { key: 'model_version', label: labels.modelVersion, value: result.model_version },
    { key: 'data_as_of', label: labels.dataAsOf, value: result.data_as_of },
    {
      key: 'simulation_paths',
      label: labels.simulationPaths,
      value: formatInteger(result.simulation_paths),
    },
    {
      key: 'simulation_seed',
      label: labels.simulationSeed,
      value: formatInteger(result.simulation_seed),
    },
  ];

  if (result.n_coarse !== undefined) {
    rows.push({
      key: 'n_coarse',
      label: labels.gridCoarse,
      value: formatInteger(result.n_coarse),
    });
  }
  if (result.n_refined !== undefined) {
    rows.push({
      key: 'n_refined',
      label: labels.gridRefined,
      value: formatInteger(result.n_refined),
    });
  }
  if (result.n_surface !== undefined) {
    rows.push({
      key: 'n_surface',
      label: labels.gridSurface,
      value: formatInteger(result.n_surface),
    });
  }

  if (jobId) {
    rows.push({ key: 'job_id', label: labels.jobId, value: jobId });
  }

  return rows;
}

/** Provenance-only subset for the printable report (no scenario assumption rows). */
export function buildReportProvenanceRows(
  result: OptimizationResult,
  jobId: string | null,
): ProvenanceDetailRow[] {
  return buildProvenanceDetailRows(result, jobId).filter((row) =>
    [
      'job_id',
      'model_version',
      'data_as_of',
      'simulation_paths',
      'simulation_seed',
      'n_coarse',
      'n_refined',
      'n_surface',
    ].includes(row.key),
  );
}
