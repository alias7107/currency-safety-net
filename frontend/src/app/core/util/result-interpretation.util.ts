import type { CurrencyCode, OptimizationResult } from '../api/models';
import { ALLOCATION_CURRENCY_ORDER } from '../api/allocation-currencies';
import { EN_STRINGS } from '../i18n/en';
import { formatWeight, interpolate, profileIdFromName } from './format.util';

const WEIGHT_POSITIVE_EPSILON = 1e-9;
/** Tolerance for treating allocation weights as equal when finding the largest share. */
const WEIGHT_TIE_TOLERANCE = 1e-9;

export type ExpenseRatioObservation = 'below' | 'equal' | 'above';

export type AllocationSpread = 'concentrated' | 'distributed';

export interface AllocationLargestCurrency {
  code: CurrencyCode;
  label: string;
  percentText: string;
}

export interface AllocationNarrative {
  allocationText: string;
  /** Present when exactly one currency has the unique largest weight. */
  largest: AllocationLargestCurrency | null;
  /** Present when two or more currencies share the largest weight within tolerance. */
  tiedLargest: AllocationLargestCurrency[] | null;
  largestPercent: string;
  spread: AllocationSpread;
  positiveCurrencyCount: number;
}

/**
 * Pure, deterministic interpretation of a succeeded optimization payload.
 * Never invents scores, thresholds for risk bands, or financial advice.
 */
export function profileDisplayTitle(profile: string | null | undefined): string {
  const id = profileIdFromName(profile);
  if (!id) {
    return EN_STRINGS.compare.profileUnavailable;
  }
  const table = EN_STRINGS.profiles as Record<string, { title: string } | undefined>;
  return table[id]?.title ?? EN_STRINGS.compare.profileUnavailable;
}

export function expenseRatioObservation(ratio: number): ExpenseRatioObservation {
  if (!Number.isFinite(ratio)) {
    return 'equal';
  }
  if (ratio < 1) {
    return 'below';
  }
  if (ratio > 1) {
    return 'above';
  }
  return 'equal';
}

export function describeAllocation(
  weights: readonly number[] | null | undefined,
): AllocationNarrative | null {
  if (!Array.isArray(weights) || weights.length < ALLOCATION_CURRENCY_ORDER.length) {
    return null;
  }

  const segments = ALLOCATION_CURRENCY_ORDER.map((code, index) => {
    const raw = weights[index];
    const weight = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, raw) : 0;
    return {
      code,
      weight,
      label: EN_STRINGS.currencies[code].label,
      percentText: formatWeight(weight),
    };
  });

  const maxWeight = Math.max(...segments.map((segment) => segment.weight));
  const tied = segments.filter(
    (segment) => Math.abs(segment.weight - maxWeight) <= WEIGHT_TIE_TOLERANCE,
  );

  const positiveCurrencyCount = segments.filter(
    (segment) => segment.weight > WEIGHT_POSITIVE_EPSILON,
  ).length;

  const largestEntries: AllocationLargestCurrency[] = tied.map((segment) => ({
    code: segment.code,
    label: segment.label,
    percentText: segment.percentText,
  }));

  return {
    allocationText: interpolate(EN_STRINGS.results.phase2b.allocationList, {
      kzt: segments[0]!.percentText,
      usd: segments[1]!.percentText,
      eur: segments[2]!.percentText,
    }),
    largest: largestEntries.length === 1 ? largestEntries[0]! : null,
    tiedLargest: largestEntries.length > 1 ? largestEntries : null,
    largestPercent: largestEntries[0]?.percentText ?? formatWeight(maxWeight),
    spread: positiveCurrencyCount <= 1 ? 'concentrated' : 'distributed',
    positiveCurrencyCount,
  };
}

function formatTiedCurrencies(entries: AllocationLargestCurrency[]): string {
  if (entries.length === 2) {
    return `${entries[0]!.label} (${entries[0]!.code}) and ${entries[1]!.label} (${entries[1]!.code})`;
  }
  const head = entries
    .slice(0, -1)
    .map((entry) => `${entry.label} (${entry.code})`)
    .join(', ');
  const last = entries[entries.length - 1]!;
  return `${head}, and ${last.label} (${last.code})`;
}

export function buildResultNarrativeParagraphs(result: OptimizationResult): string[] {
  const allocation = describeAllocation(result.weights);
  if (!allocation) {
    return [];
  }

  const copy = EN_STRINGS.results.phase2b;
  const paragraphs: string[] = [
    interpolate(copy.narrativeAllocation, { allocation: allocation.allocationText }),
  ];

  if (allocation.tiedLargest && allocation.tiedLargest.length > 1) {
    paragraphs.push(
      interpolate(copy.narrativeLargestTied, {
        currencies: formatTiedCurrencies(allocation.tiedLargest),
        percent: allocation.largestPercent,
      }),
    );
  } else if (allocation.largest) {
    paragraphs.push(
      interpolate(copy.narrativeLargest, {
        currency: allocation.largest.label,
        code: allocation.largest.code,
        percent: allocation.largest.percentText,
      }),
    );
  }

  if (allocation.spread === 'concentrated' && allocation.largest) {
    paragraphs.push(
      interpolate(copy.narrativeConcentrated, {
        currency: allocation.largest.label,
        code: allocation.largest.code,
      }),
    );
  } else if (allocation.spread === 'distributed') {
    paragraphs.push(
      interpolate(copy.narrativeDistributed, {
        count: allocation.positiveCurrencyCount,
      }),
    );
  }

  paragraphs.push(
    interpolate(copy.narrativeHorizonBuffer, {
      horizon: String(result.horizon_years),
      horizonUnit: result.horizon_years === 1 ? copy.yearSingular : copy.yearPlural,
      buffer: String(result.buffer_months),
      bufferUnit: result.buffer_months === 1 ? copy.monthSingular : copy.monthPlural,
    }),
  );

  return paragraphs;
}
