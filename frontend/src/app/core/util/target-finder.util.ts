import type { BufferSensitivityResult, BufferSensitivityResultRow } from '../api/models';

export type TargetMetricKey = 'shortfall_probability' | 'cvar95_cumulative_shortfall';

export type ThresholdParseResult =
  | { ok: true; value: number }
  | { ok: false; reason: 'blank' | 'invalid' | 'negative' | 'above_100' };

export type TargetFinderOutcome =
  | {
      status: 'found';
      bufferMonths: number;
      metricValue: number;
      row: BufferSensitivityResultRow;
    }
  | { status: 'none' }
  | { status: 'invalid_threshold' };

/** Sort tested buffer rows ascending by buffer_months (API order is already ascending). */
export function sortBufferRowsAscending(
  rows: readonly BufferSensitivityResultRow[],
): BufferSensitivityResultRow[] {
  return [...rows].sort((a, b) => a.buffer_months - b.buffer_months);
}

/**
 * Convert a user-entered percentage string (e.g. "7.5") into an API probability in [0, 1].
 * Rejects blank, non-finite, negative, and values above 100%.
 */
export function parseProbabilityPercentInput(raw: string): ThresholdParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: 'blank' };
  }
  const percent = Number(trimmed);
  if (!Number.isFinite(percent)) {
    return { ok: false, reason: 'invalid' };
  }
  if (percent < 0) {
    return { ok: false, reason: 'negative' };
  }
  if (percent > 100) {
    return { ok: false, reason: 'above_100' };
  }
  return { ok: true, value: percent / 100 };
}

/**
 * Parse a CVaR95 threshold entered in months of initial monthly income.
 * Rejects blank, non-finite, and negative values.
 */
export function parseCvarThresholdInput(raw: string): ThresholdParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: 'blank' };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { ok: false, reason: 'invalid' };
  }
  if (value < 0) {
    return { ok: false, reason: 'negative' };
  }
  return { ok: true, value };
}

function metricValue(row: BufferSensitivityResultRow, metric: TargetMetricKey): number {
  return metric === 'shortfall_probability'
    ? row.shortfall_probability
    : row.cvar95_cumulative_shortfall;
}

/**
 * First tested buffer (ascending) whose selected metric is ≤ the user threshold.
 * Equality counts. Never interpolates. Never invents buffers outside the result set.
 */
export function findMinimumTestedBufferMeetingThreshold(
  result: BufferSensitivityResult,
  metric: TargetMetricKey,
  threshold: number,
): TargetFinderOutcome {
  if (!Number.isFinite(threshold) || threshold < 0) {
    return { status: 'invalid_threshold' };
  }
  if (metric === 'shortfall_probability' && threshold > 1) {
    return { status: 'invalid_threshold' };
  }

  const ordered = sortBufferRowsAscending(result.results);
  for (const row of ordered) {
    const value = metricValue(row, metric);
    if (value <= threshold) {
      return {
        status: 'found',
        bufferMonths: row.buffer_months,
        metricValue: value,
        row,
      };
    }
  }
  return { status: 'none' };
}
