import type { CurrencyCode } from '../api/models';

/**
 * Canonical API weight order for model allocations: [KZT, USD, EUR].
 * Reuse this wherever allocation weights are interpreted or rendered.
 */
export const ALLOCATION_CURRENCY_ORDER: readonly CurrencyCode[] = ['KZT', 'USD', 'EUR'];
