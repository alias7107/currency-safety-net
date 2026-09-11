import { TestBed } from '@angular/core/testing';

import type { OptimizationResult } from '../api/models';
import { OPTIMIZATION_RESULT, TEST_JOB_ID } from '../../testing/fixtures';
import {
  COMPARISON_MAX_SCENARIOS,
  COMPARISON_SCHEMA_VERSION,
  COMPARISON_STORAGE_KEY,
  ScenarioComparisonStore,
  isCompleteResult,
  normalizeStoredScenario,
  parseStoredScenarios,
} from './scenario-comparison.store';

function resultVariant(overrides: Partial<OptimizationResult> = {}): OptimizationResult {
  return { ...OPTIMIZATION_RESULT, ...overrides };
}

function validStored(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: COMPARISON_SCHEMA_VERSION,
    jobId: TEST_JOB_ID,
    savedAt: '2026-01-15T12:00:00.000Z',
    profile: OPTIMIZATION_RESULT.profile,
    horizon_years: OPTIMIZATION_RESULT.horizon_years,
    expense_income_ratio: OPTIMIZATION_RESULT.expense_income_ratio,
    buffer_months: OPTIMIZATION_RESULT.buffer_months,
    rebalance_frequency: OPTIMIZATION_RESULT.rebalance_frequency,
    conversion_cost: OPTIMIZATION_RESULT.conversion_cost,
    weights: [...OPTIMIZATION_RESULT.weights],
    shortfall_probability: OPTIMIZATION_RESULT.shortfall_probability,
    cvar95_cumulative_shortfall: OPTIMIZATION_RESULT.cvar95_cumulative_shortfall,
    var95_cumulative_shortfall: OPTIMIZATION_RESULT.var95_cumulative_shortfall,
    mean_cumulative_shortfall: OPTIMIZATION_RESULT.mean_cumulative_shortfall,
    wealth_depletion_probability: OPTIMIZATION_RESULT.wealth_depletion_probability,
    identification_class: OPTIMIZATION_RESULT.identification_class ?? null,
    model_version: OPTIMIZATION_RESULT.model_version,
    data_as_of: OPTIMIZATION_RESULT.data_as_of,
    simulation_paths: OPTIMIZATION_RESULT.simulation_paths,
    simulation_seed: OPTIMIZATION_RESULT.simulation_seed,
    ...overrides,
  };
}

describe('ScenarioComparisonStore', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  function store(): ScenarioComparisonStore {
    return TestBed.inject(ScenarioComparisonStore);
  }

  it('adds a successful scenario', () => {
    const comparison = store();
    const outcome = comparison.add(TEST_JOB_ID, OPTIMIZATION_RESULT);
    expect(outcome.status).toBe('added');
    expect(comparison.count()).toBe(1);
    expect(comparison.contains(TEST_JOB_ID)).toBe(true);
    expect(comparison.scenarios()[0]?.weights).toEqual(OPTIMIZATION_RESULT.weights);
    expect(comparison.scenarios()[0]?.cvar95_cumulative_shortfall).toBe(
      OPTIMIZATION_RESULT.cvar95_cumulative_shortfall,
    );
  });

  it('rejects incomplete results', () => {
    const comparison = store();
    expect(comparison.add(TEST_JOB_ID, null).status).toBe('invalid');
    expect(
      comparison.add(TEST_JOB_ID, resultVariant({ weights: [0.5, 0.5] as unknown as number[] }))
        .status,
    ).toBe('invalid');
    expect(
      comparison.add(TEST_JOB_ID, resultVariant({ model_version: '' as unknown as string })).status,
    ).toBe('invalid');
    expect(comparison.count()).toBe(0);
  });

  it('prevents duplicate job ids', () => {
    const comparison = store();
    expect(comparison.add(TEST_JOB_ID, OPTIMIZATION_RESULT).status).toBe('added');
    expect(comparison.add(TEST_JOB_ID, OPTIMIZATION_RESULT).status).toBe('duplicate');
    expect(comparison.count()).toBe(1);
  });

  it('enforces a maximum of three without silently evicting', () => {
    const comparison = store();
    for (let i = 0; i < COMPARISON_MAX_SCENARIOS; i += 1) {
      expect(comparison.add(`job-${i}`, OPTIMIZATION_RESULT).status).toBe('added');
    }
    const before = comparison.scenarios().map((item) => item.jobId);
    expect(comparison.add('job-extra', OPTIMIZATION_RESULT).status).toBe('full');
    expect(comparison.scenarios().map((item) => item.jobId)).toEqual(before);
    expect(comparison.isFull()).toBe(true);
  });

  it('removes one scenario', () => {
    const comparison = store();
    comparison.add('a', OPTIMIZATION_RESULT);
    comparison.add('b', OPTIMIZATION_RESULT);
    comparison.remove('a');
    expect(comparison.contains('a')).toBe(false);
    expect(comparison.contains('b')).toBe(true);
    expect(comparison.count()).toBe(1);
  });

  it('clears all scenarios', () => {
    const comparison = store();
    comparison.add('a', OPTIMIZATION_RESULT);
    comparison.add('b', OPTIMIZATION_RESULT);
    comparison.clear();
    expect(comparison.count()).toBe(0);
    expect(sessionStorage.getItem(COMPARISON_STORAGE_KEY)).toBeNull();
  });

  it('restores valid session data', () => {
    const first = store();
    first.add(TEST_JOB_ID, OPTIMIZATION_RESULT);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const restored = store();
    expect(restored.count()).toBe(1);
    expect(restored.contains(TEST_JOB_ID)).toBe(true);
  });

  it('discards corrupt JSON on restore', () => {
    sessionStorage.setItem(COMPARISON_STORAGE_KEY, '{not-json');
    expect(store().count()).toBe(0);
  });

  it('discards invalid schema on restore', () => {
    sessionStorage.setItem(
      COMPARISON_STORAGE_KEY,
      JSON.stringify({
        scenarios: [validStored({ schemaVersion: 99 })],
      }),
    );
    expect(store().count()).toBe(0);
  });

  it('handles unavailable sessionStorage safely', () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(() => store()).not.toThrow();
    const comparison = store();
    expect(comparison.add(TEST_JOB_ID, OPTIMIZATION_RESULT).status).toBe('added');
    expect(comparison.count()).toBe(1);

    getSpy.mockRestore();
    setSpy.mockRestore();
  });
});

describe('strict stored-scenario validation', () => {
  it('accepts a fully valid stored scenario', () => {
    expect(normalizeStoredScenario(validStored())).not.toBeNull();
  });

  it('rejects numeric strings without coercion', () => {
    expect(normalizeStoredScenario(validStored({ shortfall_probability: '0.25' }))).toBeNull();
    expect(normalizeStoredScenario(validStored({ horizon_years: '3' }))).toBeNull();
    expect(normalizeStoredScenario(validStored({ simulation_paths: '10000' }))).toBeNull();
  });

  it('rejects null numeric values', () => {
    expect(normalizeStoredScenario(validStored({ shortfall_probability: null }))).toBeNull();
    expect(normalizeStoredScenario(validStored({ buffer_months: null }))).toBeNull();
    expect(normalizeStoredScenario(validStored({ conversion_cost: null }))).toBeNull();
  });

  it('rejects booleans', () => {
    expect(normalizeStoredScenario(validStored({ shortfall_probability: true }))).toBeNull();
    expect(normalizeStoredScenario(validStored({ horizon_years: false }))).toBeNull();
  });

  it('rejects probabilities outside [0, 1]', () => {
    expect(normalizeStoredScenario(validStored({ shortfall_probability: -0.01 }))).toBeNull();
    expect(normalizeStoredScenario(validStored({ shortfall_probability: 1.01 }))).toBeNull();
    expect(normalizeStoredScenario(validStored({ wealth_depletion_probability: 1.5 }))).toBeNull();
  });

  it('rejects negative weights', () => {
    expect(normalizeStoredScenario(validStored({ weights: [-0.1, 0.6, 0.5] }))).toBeNull();
  });

  it('rejects weights that do not sum to one', () => {
    expect(normalizeStoredScenario(validStored({ weights: [0.5, 0.3, 0.1] }))).toBeNull();
    expect(normalizeStoredScenario(validStored({ weights: [1, 0, 0.1] }))).toBeNull();
  });

  it('rejects invalid rebalance frequency', () => {
    expect(normalizeStoredScenario(validStored({ rebalance_frequency: 'weekly' }))).toBeNull();
    expect(normalizeStoredScenario(validStored({ rebalance_frequency: 'annual' }))).toBeNull();
    expect(normalizeStoredScenario(validStored({ rebalance_frequency: '' }))).toBeNull();
  });

  it('rejects zero or fractional simulation path counts', () => {
    expect(normalizeStoredScenario(validStored({ simulation_paths: 0 }))).toBeNull();
    expect(normalizeStoredScenario(validStored({ simulation_paths: 10.5 }))).toBeNull();
    expect(normalizeStoredScenario(validStored({ simulation_paths: -1 }))).toBeNull();
  });

  it('keeps valid scenarios and discards invalid ones in a mixed list', () => {
    const parsed = parseStoredScenarios(
      JSON.stringify({
        scenarios: [
          validStored({ jobId: 'good-1' }),
          validStored({ jobId: 'bad-string', shortfall_probability: '0.2' }),
          validStored({
            jobId: 'good-2',
            profile: 'P1_local_control',
            weights: [0.5, 0.3, 0.2],
          }),
          validStored({ jobId: 'bad-rebalance', rebalance_frequency: 'daily' }),
        ],
      }),
    );
    expect(parsed.map((item) => item.jobId)).toEqual(['good-1', 'good-2']);
  });

  it('rejects empty string coercion targets', () => {
    expect(normalizeStoredScenario(validStored({ shortfall_probability: '' }))).toBeNull();
    expect(normalizeStoredScenario(validStored({ model_version: '' }))).toBeNull();
  });

  it('rejects negative cumulative shortfall metrics', () => {
    expect(normalizeStoredScenario(validStored({ cvar95_cumulative_shortfall: -0.01 }))).toBeNull();
    expect(normalizeStoredScenario(validStored({ var95_cumulative_shortfall: -1 }))).toBeNull();
    expect(normalizeStoredScenario(validStored({ mean_cumulative_shortfall: -0.5 }))).toBeNull();
  });

  it('rejects non-numeric cumulative shortfall metrics', () => {
    expect(normalizeStoredScenario(validStored({ cvar95_cumulative_shortfall: '0' }))).toBeNull();
    expect(normalizeStoredScenario(validStored({ var95_cumulative_shortfall: true }))).toBeNull();
    expect(normalizeStoredScenario(validStored({ mean_cumulative_shortfall: null }))).toBeNull();
    expect(
      normalizeStoredScenario(validStored({ cvar95_cumulative_shortfall: Number.NaN })),
    ).toBeNull();
    expect(
      normalizeStoredScenario(
        validStored({ var95_cumulative_shortfall: Number.POSITIVE_INFINITY }),
      ),
    ).toBeNull();
  });

  it('accepts zero-valued cumulative shortfall metrics', () => {
    const restored = normalizeStoredScenario(
      validStored({
        cvar95_cumulative_shortfall: 0,
        var95_cumulative_shortfall: 0,
        mean_cumulative_shortfall: 0,
      }),
    );
    expect(restored).not.toBeNull();
    expect(restored?.cvar95_cumulative_shortfall).toBe(0);
    expect(restored?.var95_cumulative_shortfall).toBe(0);
    expect(restored?.mean_cumulative_shortfall).toBe(0);
  });

  it('rejects whitespace-only required strings', () => {
    expect(normalizeStoredScenario(validStored({ jobId: '   ' }))).toBeNull();
    expect(normalizeStoredScenario(validStored({ profile: '\n\t' }))).toBeNull();
    expect(normalizeStoredScenario(validStored({ model_version: ' ' }))).toBeNull();
    expect(normalizeStoredScenario(validStored({ data_as_of: '\t' }))).toBeNull();
    expect(normalizeStoredScenario(validStored({ identification_class: '   ' }))).toBeNull();
  });

  it('accepts null identification_class and restores a valid scenario unchanged', () => {
    const payload = validStored({ identification_class: null });
    const restored = normalizeStoredScenario(payload);
    expect(restored).not.toBeNull();
    expect(restored?.identification_class).toBeNull();
    expect(restored?.jobId).toBe(payload['jobId']);
    expect(restored?.profile).toBe(payload['profile']);
    expect(restored?.model_version).toBe(payload['model_version']);
    expect(restored?.data_as_of).toBe(payload['data_as_of']);
    expect(restored?.weights).toEqual(payload['weights']);
    expect(restored?.cvar95_cumulative_shortfall).toBe(payload['cvar95_cumulative_shortfall']);
  });
});

describe('add() shares restoration validation rules', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  function store(): ScenarioComparisonStore {
    return TestBed.inject(ScenarioComparisonStore);
  }

  it('rejects whitespace-only job ids and invalid shortfall metrics on add', () => {
    const comparison = store();
    expect(comparison.add('   ', OPTIMIZATION_RESULT).status).toBe('invalid');
    expect(
      comparison.add(TEST_JOB_ID, resultVariant({ cvar95_cumulative_shortfall: -1 })).status,
    ).toBe('invalid');
    expect(
      comparison.add(TEST_JOB_ID, resultVariant({ var95_cumulative_shortfall: -0.01 })).status,
    ).toBe('invalid');
    expect(
      comparison.add(TEST_JOB_ID, resultVariant({ mean_cumulative_shortfall: -2 })).status,
    ).toBe('invalid');
    expect(comparison.add(TEST_JOB_ID, resultVariant({ profile: '  ' })).status).toBe('invalid');
    expect(comparison.add(TEST_JOB_ID, resultVariant({ model_version: '\n' })).status).toBe(
      'invalid',
    );
    expect(comparison.add(TEST_JOB_ID, resultVariant({ data_as_of: '\t' })).status).toBe('invalid');
    expect(comparison.add(TEST_JOB_ID, resultVariant({ identification_class: '   ' })).status).toBe(
      'invalid',
    );
    expect(comparison.count()).toBe(0);
  });

  it('accepts zero shortfall metrics and null identification on add', () => {
    const comparison = store();
    const outcome = comparison.add(
      TEST_JOB_ID,
      resultVariant({
        cvar95_cumulative_shortfall: 0,
        var95_cumulative_shortfall: 0,
        mean_cumulative_shortfall: 0,
        identification_class: undefined,
      }),
    );
    expect(outcome.status).toBe('added');
    expect(comparison.scenarios()[0]?.cvar95_cumulative_shortfall).toBe(0);
    expect(comparison.scenarios()[0]?.identification_class).toBeNull();
  });
});

describe('comparison store helpers', () => {
  it('isCompleteResult rejects partial payloads', () => {
    expect(isCompleteResult(OPTIMIZATION_RESULT)).toBe(true);
    expect(isCompleteResult(undefined)).toBe(false);
    expect(isCompleteResult({ ...OPTIMIZATION_RESULT, weights: [1, 0] })).toBe(false);
    expect(isCompleteResult({ ...OPTIMIZATION_RESULT, weights: [0.5, 0.3, 0.1] })).toBe(false);
    expect(isCompleteResult({ ...OPTIMIZATION_RESULT, rebalance_frequency: 'weekly' })).toBe(false);
  });

  it('parseStoredScenarios tolerates unexpected shapes', () => {
    expect(parseStoredScenarios('[]')).toEqual([]);
    expect(parseStoredScenarios('{"scenarios":null}')).toEqual([]);
  });
});
