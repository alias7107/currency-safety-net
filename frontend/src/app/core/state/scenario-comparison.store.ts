import { Injectable, computed, signal } from '@angular/core';

import type { OptimizationResult, RebalanceFrequency } from '../api/models';

/** Versioned sessionStorage key for Phase 2A comparison v1. */
export const COMPARISON_STORAGE_KEY = 'currency-safety-net:comparison:v1';

export const COMPARISON_SCHEMA_VERSION = 1;

export const COMPARISON_MAX_SCENARIOS = 3;

/** Wire values accepted by the options endpoint / calculator. */
export const COMPARISON_REBALANCE_FREQUENCIES = ['monthly', 'quarterly', 'none'] as const;

const WEIGHT_SUM_TOLERANCE = 1e-6;

/**
 * Persisted snapshot of one succeeded optimization result for side-by-side
 * comparison. Values are copied from the API payload — never recomputed.
 */
export interface ComparisonScenario {
  schemaVersion: typeof COMPARISON_SCHEMA_VERSION;
  jobId: string;
  savedAt: string;
  profile: string;
  horizon_years: number;
  expense_income_ratio: number;
  buffer_months: number;
  rebalance_frequency: RebalanceFrequency;
  conversion_cost: number;
  weights: number[];
  shortfall_probability: number;
  cvar95_cumulative_shortfall: number;
  var95_cumulative_shortfall: number;
  mean_cumulative_shortfall: number;
  wealth_depletion_probability: number;
  identification_class: string | null;
  model_version: string;
  data_as_of: string;
  simulation_paths: number;
  simulation_seed: number;
}

export type AddComparisonResult =
  | { status: 'added'; scenario: ComparisonScenario }
  | { status: 'duplicate' }
  | { status: 'full' }
  | { status: 'invalid' };

@Injectable({ providedIn: 'root' })
export class ScenarioComparisonStore {
  private readonly scenariosState = signal<ComparisonScenario[]>(this.readInitial());

  readonly scenarios = this.scenariosState.asReadonly();
  readonly count = computed(() => this.scenariosState().length);
  readonly isFull = computed(() => this.scenariosState().length >= COMPARISON_MAX_SCENARIOS);
  readonly isEmpty = computed(() => this.scenariosState().length === 0);

  contains(jobId: string): boolean {
    return this.scenariosState().some((item) => item.jobId === jobId);
  }

  add(jobId: string, result: OptimizationResult | null | undefined): AddComparisonResult {
    if (!isNonEmptyString(jobId) || !isCompleteResult(result)) {
      return { status: 'invalid' };
    }
    if (this.contains(jobId)) {
      return { status: 'duplicate' };
    }
    if (this.isFull()) {
      return { status: 'full' };
    }

    const scenario = toComparisonScenario(jobId, result);
    const next = [...this.scenariosState(), scenario];
    this.scenariosState.set(next);
    this.persist(next);
    return { status: 'added', scenario };
  }

  remove(jobId: string): void {
    const next = this.scenariosState().filter((item) => item.jobId !== jobId);
    if (next.length === this.scenariosState().length) {
      return;
    }
    this.scenariosState.set(next);
    this.persist(next);
  }

  clear(): void {
    this.scenariosState.set([]);
    this.persist([]);
  }

  private readInitial(): ComparisonScenario[] {
    try {
      const raw = safeSessionGet(COMPARISON_STORAGE_KEY);
      if (!raw) {
        return [];
      }
      return parseStoredScenarios(raw);
    } catch {
      return [];
    }
  }

  private persist(scenarios: ComparisonScenario[]): void {
    try {
      if (scenarios.length === 0) {
        safeSessionRemove(COMPARISON_STORAGE_KEY);
        return;
      }
      safeSessionSet(COMPARISON_STORAGE_KEY, JSON.stringify({ scenarios }));
    } catch {
      // Session storage may be unavailable (private mode quota). Keep in-memory state.
    }
  }
}

export function toComparisonScenario(
  jobId: string,
  result: OptimizationResult,
): ComparisonScenario {
  return {
    schemaVersion: COMPARISON_SCHEMA_VERSION,
    jobId,
    savedAt: new Date().toISOString(),
    profile: result.profile,
    horizon_years: result.horizon_years,
    expense_income_ratio: result.expense_income_ratio,
    buffer_months: result.buffer_months,
    rebalance_frequency: result.rebalance_frequency,
    conversion_cost: result.conversion_cost,
    weights: [...result.weights],
    shortfall_probability: result.shortfall_probability,
    cvar95_cumulative_shortfall: result.cvar95_cumulative_shortfall,
    var95_cumulative_shortfall: result.var95_cumulative_shortfall,
    mean_cumulative_shortfall: result.mean_cumulative_shortfall,
    wealth_depletion_probability: result.wealth_depletion_probability,
    identification_class: isNonEmptyString(result.identification_class)
      ? result.identification_class
      : null,
    model_version: result.model_version,
    data_as_of: result.data_as_of,
    simulation_paths: result.simulation_paths,
    simulation_seed: result.simulation_seed,
  };
}

export function isCompleteResult(
  result: OptimizationResult | null | undefined,
): result is OptimizationResult {
  if (!result || typeof result !== 'object') {
    return false;
  }
  return (
    isNonEmptyString(result.profile) &&
    isNonEmptyString(result.model_version) &&
    isNonEmptyString(result.data_as_of) &&
    isSupportedRebalance(result.rebalance_frequency) &&
    isPositiveInteger(result.horizon_years) &&
    isFiniteNumber(result.expense_income_ratio) &&
    result.expense_income_ratio > 0 &&
    isFiniteNumber(result.buffer_months) &&
    result.buffer_months >= 0 &&
    isFiniteNumber(result.conversion_cost) &&
    result.conversion_cost >= 0 &&
    result.conversion_cost <= 1 &&
    isProbability(result.shortfall_probability) &&
    isProbability(result.wealth_depletion_probability) &&
    isNonNegativeFinite(result.cvar95_cumulative_shortfall) &&
    isNonNegativeFinite(result.var95_cumulative_shortfall) &&
    isNonNegativeFinite(result.mean_cumulative_shortfall) &&
    isPositiveInteger(result.simulation_paths) &&
    isInteger(result.simulation_seed) &&
    isValidWeights(result.weights) &&
    isOptionalIdentificationClass(result.identification_class)
  );
}

export function parseStoredScenarios(raw: string): ComparisonScenario[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const list = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { scenarios?: unknown }).scenarios)
      ? (parsed as { scenarios: unknown[] }).scenarios
      : null;

  if (!list) {
    return [];
  }

  const out: ComparisonScenario[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const scenario = normalizeStoredScenario(item);
    if (!scenario) {
      continue;
    }
    if (seen.has(scenario.jobId)) {
      continue;
    }
    seen.add(scenario.jobId);
    out.push(scenario);
    if (out.length >= COMPARISON_MAX_SCENARIOS) {
      break;
    }
  }
  return out;
}

/**
 * Strict runtime validation for persisted comparison payloads.
 * Rejects the whole scenario on any invalid field — no coercion or repair.
 */
export function normalizeStoredScenario(value: unknown): ComparisonScenario | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;

  if (record['schemaVersion'] !== COMPARISON_SCHEMA_VERSION) {
    return null;
  }

  const jobId = record['jobId'];
  if (!isNonEmptyString(jobId)) {
    return null;
  }

  const savedAt = record['savedAt'];
  if (!isNonEmptyString(savedAt) || Number.isNaN(Date.parse(savedAt))) {
    return null;
  }

  const profile = record['profile'];
  const modelVersion = record['model_version'];
  const dataAsOf = record['data_as_of'];
  const rebalance = record['rebalance_frequency'];
  if (
    !isNonEmptyString(profile) ||
    !isNonEmptyString(modelVersion) ||
    !isNonEmptyString(dataAsOf) ||
    !isSupportedRebalance(rebalance)
  ) {
    return null;
  }

  const horizonYears = record['horizon_years'];
  const expenseIncomeRatio = record['expense_income_ratio'];
  const bufferMonths = record['buffer_months'];
  const conversionCost = record['conversion_cost'];
  const shortfallProbability = record['shortfall_probability'];
  const cvar95 = record['cvar95_cumulative_shortfall'];
  const var95 = record['var95_cumulative_shortfall'];
  const meanShortfall = record['mean_cumulative_shortfall'];
  const depletionProbability = record['wealth_depletion_probability'];
  const simulationPaths = record['simulation_paths'];
  const simulationSeed = record['simulation_seed'];
  const weights = record['weights'];

  if (
    !isPositiveInteger(horizonYears) ||
    !isFiniteNumber(expenseIncomeRatio) ||
    expenseIncomeRatio <= 0 ||
    !isFiniteNumber(bufferMonths) ||
    bufferMonths < 0 ||
    !isFiniteNumber(conversionCost) ||
    conversionCost < 0 ||
    conversionCost > 1 ||
    !isProbability(shortfallProbability) ||
    !isProbability(depletionProbability) ||
    !isNonNegativeFinite(cvar95) ||
    !isNonNegativeFinite(var95) ||
    !isNonNegativeFinite(meanShortfall) ||
    !isPositiveInteger(simulationPaths) ||
    !isInteger(simulationSeed) ||
    !isValidWeights(weights)
  ) {
    return null;
  }

  if (!('identification_class' in record)) {
    // absent is allowed
  } else if (record['identification_class'] === null) {
    // null is allowed
  } else if (!isNonEmptyString(record['identification_class'])) {
    return null;
  }

  const identificationClass = isNonEmptyString(record['identification_class'])
    ? record['identification_class']
    : null;

  return {
    schemaVersion: COMPARISON_SCHEMA_VERSION,
    jobId,
    savedAt,
    profile,
    horizon_years: horizonYears,
    expense_income_ratio: expenseIncomeRatio,
    buffer_months: bufferMonths,
    rebalance_frequency: rebalance,
    conversion_cost: conversionCost,
    weights: [...weights],
    shortfall_probability: shortfallProbability,
    cvar95_cumulative_shortfall: cvar95,
    var95_cumulative_shortfall: var95,
    mean_cumulative_shortfall: meanShortfall,
    wealth_depletion_probability: depletionProbability,
    identification_class: identificationClass,
    model_version: modelVersion,
    data_as_of: dataAsOf,
    simulation_paths: simulationPaths,
    simulation_seed: simulationSeed,
  };
}

/** Rejects empty and whitespace-only strings without trimming stored values. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isInteger(value) && value > 0;
}

function isProbability(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function isSupportedRebalance(value: unknown): value is RebalanceFrequency {
  return (
    typeof value === 'string' &&
    (COMPARISON_REBALANCE_FREQUENCIES as readonly string[]).includes(value)
  );
}

function isValidWeights(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length !== 3) {
    return false;
  }
  if (!value.every((weight) => isFiniteNumber(weight) && weight >= 0 && weight <= 1)) {
    return false;
  }
  const sum = value[0]! + value[1]! + value[2]!;
  return Math.abs(sum - 1) <= WEIGHT_SUM_TOLERANCE;
}

function isOptionalIdentificationClass(value: unknown): boolean {
  return value === undefined || value === null || isNonEmptyString(value);
}

function safeSessionGet(key: string): string | null {
  try {
    if (typeof sessionStorage === 'undefined') {
      return null;
    }
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionSet(key: string, value: string): void {
  try {
    if (typeof sessionStorage === 'undefined') {
      return;
    }
    sessionStorage.setItem(key, value);
  } catch {
    // Ignore quota / privacy errors.
  }
}

function safeSessionRemove(key: string): void {
  try {
    if (typeof sessionStorage === 'undefined') {
      return;
    }
    sessionStorage.removeItem(key);
  } catch {
    // Ignore.
  }
}
