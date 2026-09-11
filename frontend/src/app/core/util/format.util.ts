/**
 * Display formatting for model outputs.
 *
 * Every function is pure and locale-pinned to `en-US` so that rendered numbers
 * are deterministic across environments and assertable in tests.
 */

const LOCALE = 'en-US';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Format a 0–1 proportion as a percentage. Values that are non-zero but round
 * to zero at the requested precision are reported as `<0.1%` rather than `0%`,
 * so a small modelled risk is never displayed as no risk at all.
 */
export function formatPercent(value: number | null | undefined, maxFractionDigits = 1): string {
  if (!isFiniteNumber(value)) {
    return '—';
  }
  const formatter = new Intl.NumberFormat(LOCALE, {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
  // Smallest proportion that is still visible at this precision, e.g. 0.001 → "0.1%".
  const smallestVisible = Math.pow(10, -(maxFractionDigits + 2));
  if (value > 0 && value < smallestVisible / 2) {
    return `<${formatter.format(smallestVisible)}`;
  }
  if (value < 0 && value > -smallestVisible / 2) {
    return `>${formatter.format(-smallestVisible)}`;
  }
  return formatter.format(value);
}

/** Allocation weights are shown to one decimal, e.g. `37.5%`, `100%`. */
export function formatWeight(value: number | null | undefined): string {
  return formatPercent(value, 1);
}

/**
 * Shortfall figures are normalised to months of income (I₀ = 1), so they are
 * shown as plain multiples rather than currency amounts.
 */
export function formatMonthsOfIncome(value: number | null | undefined, digits = 2): string {
  if (!isFiniteNumber(value)) {
    return '—';
  }
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatRatio(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) {
    return '—';
  }
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

export function formatInteger(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) {
    return '—';
  }
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(value);
}

export function formatHorizon(years: number | null | undefined): string {
  if (!isFiniteNumber(years)) {
    return '—';
  }
  return `${formatInteger(years)} ${years === 1 ? 'year' : 'years'}`;
}

export function formatBufferMonths(months: number | null | undefined): string {
  if (!isFiniteNumber(months)) {
    return '—';
  }
  const amount = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 }).format(months);
  return `${amount} ${months === 1 ? 'month' : 'months'}`;
}

/** Conversion cost arrives as a proportion, e.g. `0.0025` → `0.25%`. */
export function formatConversionCost(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) {
    return '—';
  }
  if (value === 0) {
    return '0%';
  }
  return formatPercent(value, 2);
}

/**
 * `none` is a documented rebalancing option meaning the buffer is never
 * returned to its target weights, so it needs a label rather than the raw word.
 */
const REBALANCE_LABELS: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
  none: 'No rebalancing',
};

export function formatRebalanceFrequency(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  return REBALANCE_LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * The engine returns internal profile names such as
 * `P2_foreign_income_mismatch`. Only the leading public id is used by the UI.
 */
export function profileIdFromName(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = /^(P\d)(?:_|$)/i.exec(value.trim());
  return match ? match[1].toUpperCase() : null;
}

/** `A_WELL_IDENTIFIED` → `A Well Identified`, used only as a secondary label. */
export function humanizeIdentificationClass(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function formatDate(value: string | null | undefined): string {
  return value && value.trim() ? value : '—';
}

/** Replace `{name}` placeholders in centralised copy. */
export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
