import { Injectable, signal } from '@angular/core';

import type { OptimizationRequest } from '../api/models';

export const SCENARIO_FORM_STORAGE_KEY = 'csn.scenario-form.v1';
export const SCENARIO_STEP_STORAGE_KEY = 'csn.scenario-step.v1';

/** Research baseline: the values used in the published run. */
export const DEFAULT_SCENARIO: Readonly<OptimizationRequest> = Object.freeze({
  profile: 'P2',
  horizon_years: 3,
  expense_income_ratio: 0.95,
  buffer_months: 1,
  rebalance_frequency: 'monthly',
  conversion_cost: 0,
});

export const SCENARIO_STEP_COUNT = 3;

/**
 * Keeps the scenario inputs alive across the calculator steps and across a
 * return trip from the results page. SessionStorage (not localStorage) so the
 * draft disappears when the tab closes.
 */
@Injectable({ providedIn: 'root' })
export class ScenarioFormStore {
  private readonly scenarioState = signal<OptimizationRequest>(this.readScenario());
  private readonly stepState = signal<number>(this.readStep());

  readonly scenario = this.scenarioState.asReadonly();
  readonly step = this.stepState.asReadonly();

  patch(partial: Partial<OptimizationRequest>): void {
    const next = { ...this.scenarioState(), ...partial };
    this.scenarioState.set(next);
    this.write(SCENARIO_FORM_STORAGE_KEY, JSON.stringify(next));
  }

  setStep(step: number): void {
    const clamped = Math.min(Math.max(Math.trunc(step), 0), SCENARIO_STEP_COUNT - 1);
    this.stepState.set(clamped);
    this.write(SCENARIO_STEP_STORAGE_KEY, String(clamped));
  }

  reset(): void {
    this.scenarioState.set({ ...DEFAULT_SCENARIO });
    this.stepState.set(0);
    this.remove(SCENARIO_FORM_STORAGE_KEY);
    this.remove(SCENARIO_STEP_STORAGE_KEY);
  }

  private readScenario(): OptimizationRequest {
    const raw = this.read(SCENARIO_FORM_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_SCENARIO };
    }
    try {
      const parsed = JSON.parse(raw) as Partial<OptimizationRequest> | null;
      if (!parsed || typeof parsed !== 'object') {
        return { ...DEFAULT_SCENARIO };
      }
      return {
        profile: pickString(parsed.profile, DEFAULT_SCENARIO.profile),
        horizon_years: pickNumber(parsed.horizon_years, DEFAULT_SCENARIO.horizon_years),
        expense_income_ratio: pickNumber(
          parsed.expense_income_ratio,
          DEFAULT_SCENARIO.expense_income_ratio,
        ),
        buffer_months: pickNumber(parsed.buffer_months, DEFAULT_SCENARIO.buffer_months),
        rebalance_frequency: pickString(
          parsed.rebalance_frequency,
          DEFAULT_SCENARIO.rebalance_frequency,
        ),
        conversion_cost: pickNumber(parsed.conversion_cost, DEFAULT_SCENARIO.conversion_cost),
      };
    } catch {
      return { ...DEFAULT_SCENARIO };
    }
  }

  private readStep(): number {
    const raw = this.read(SCENARIO_STEP_STORAGE_KEY);
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed >= SCENARIO_STEP_COUNT) {
      return 0;
    }
    return parsed;
  }

  private storage(): Storage | null {
    try {
      return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    } catch {
      return null;
    }
  }

  private read(key: string): string | null {
    try {
      return this.storage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      this.storage()?.setItem(key, value);
    } catch {
      // Storage disabled or full: the in-memory signal remains authoritative.
    }
  }

  private remove(key: string): void {
    try {
      this.storage()?.removeItem(key);
    } catch {
      // Ignored for the same reason as `write`.
    }
  }
}

function pickNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}
