import {
  HOUSEHOLD_REQUEST,
  OTHER_HOUSEHOLD_JOB_ID,
  TEST_HOUSEHOLD_JOB_ID,
  householdAccepted,
  householdJobStatus,
  householdResult,
} from '../../testing/household-analysis.fixtures';
import {
  expectedOutcome,
  isValidShareVector,
  parseUnsupportedReasons,
  validateHouseholdJobAccepted,
  validateHouseholdJobStatus,
  validateHouseholdResult,
} from './household-analysis.validation';

type Mutator = (r: Record<string, any>) => void;

function rejects(mutate: Mutator): boolean {
  const result = householdResult();
  mutate(result);
  const checked = validateHouseholdResult(result);
  return !checked.ok && checked.error.code === 'malformed_response';
}

describe('household-analysis validation', () => {
  it('accepts a contract-valid result for every outcome', () => {
    for (const outcome of ['optimized_lower', 'current_lower', 'equal_within_tolerance'] as const) {
      const checked = validateHouseholdResult(householdResult(outcome), HOUSEHOLD_REQUEST);
      expect(checked.ok).toBe(true);
      if (checked.ok) {
        expect(checked.value.comparison.outcome).toBe(outcome);
      }
    }
  });

  it('classifies outcomes with the absolute tie tolerance', () => {
    expect(expectedOutcome(0)).toBe('equal_within_tolerance');
    expect(expectedOutcome(1e-8)).toBe('equal_within_tolerance');
    expect(expectedOutcome(-1e-8)).toBe('equal_within_tolerance');
    expect(expectedOutcome(-1.1e-8)).toBe('optimized_lower');
    expect(expectedOutcome(1.1e-8)).toBe('current_lower');
  });

  it.each<[string, Mutator]>([
    ['extra top-level key', (r) => (r['extra'] = 1)],
    ['missing comparison', (r) => delete r['comparison']],
    ['wrong contract version', (r) => (r['contract_version'] = 'household_analysis_v2')],
    ['wrong engine interface', (r) => (r['engine_interface_version'] = 'v0')],
    ['wrong units', (r) => (r['units'].terminal_wealth = 'KZT')],
    ['extra units key', (r) => (r['units'].x = 'y')],
    ['scenario extra key', (r) => (r['scenario'].country = 'KZ')],
    ['scenario null weights', (r) => (r['scenario'].current_reserve_weights = null)],
    ['scenario vector off sum', (r) => (r['scenario'].income_shares = [0.6, 0.4, 0.01])],
    ['scenario negative share', (r) => (r['scenario'].expense_shares = [1.1, -0.1, 0])],
    ['scenario string number', (r) => (r['scenario'].buffer_months = '3')],
    ['scenario unsupported horizon', (r) => (r['scenario'].horizon_years = 2)],
    ['scenario non-integer horizon', (r) => (r['scenario'].horizon_years = 3.0000001)],
    ['scenario unsupported rebalance', (r) => (r['scenario'].rebalance_frequency = 'Monthly')],
    ['sha not hex', (r) => (r['provenance'].dataset_sha256 = 'Z'.repeat(64))],
    ['sha uppercase', (r) => (r['provenance'].dataset_sha256 = 'A'.repeat(64))],
    ['sha short', (r) => (r['provenance'].dataset_sha256 = 'a'.repeat(63))],
    ['paths not 10000', (r) => (r['provenance'].simulation_paths = 5000)],
    ['paths as string', (r) => (r['provenance'].simulation_paths = '10000')],
    ['seed float', (r) => (r['provenance'].simulation_seed = 42.5)],
    ['fx policy', (r) => (r['provenance'].fx_path_policy = 'independent')],
    ['empty model version', (r) => (r['provenance'].model_version = ' ')],
    ['current label', (r) => (r['current_policy'].label = 'optimal')],
    [
      'current weights differ from scenario',
      (r) => (r['current_policy'].weights = [0.5, 0.3, 0.2]),
    ],
    ['identification on current', (r) => (r['current_policy'].identification = {})],
    ['missing identification', (r) => delete r['optimized_policy'].identification],
    ['NaN cvar', (r) => (r['current_policy'].objective.cvar95_cumulative_shortfall = NaN)],
    ['negative cvar', (r) => (r['optimized_policy'].objective.cvar95_cumulative_shortfall = -1)],
    ['probability above 1', (r) => (r['current_policy'].diagnostics.shortfall_probability = 1.2)],
    [
      'depletion probability negative',
      (r) => (r['optimized_policy'].implementation_only.wealth_depletion_probability = -0.1),
    ],
    [
      'negative terminal wealth',
      (r) => (r['current_policy'].implementation_only.p05_terminal_wealth = -1),
    ],
    [
      'identification class',
      (r) => (r['optimized_policy'].identification.identification_class = 'D'),
    ],
    ['applies_to', (r) => (r['optimized_policy'].identification.applies_to = 'household')],
    ['count float', (r) => (r['optimized_policy'].identification.n_coarse = 66.5)],
    ['count unsafe integer', (r) => (r['optimized_policy'].identification.n_refined = 2 ** 53)],
    ['surface exceeds grid', (r) => (r['optimized_policy'].identification.n_surface = 107)],
    ['near count zero', (r) => (r['optimized_policy'].identification.near_optimal_1pct_count = 0)],
    [
      'near frac inconsistent',
      (r) => (r['optimized_policy'].identification.near_optimal_1pct_frac = 0.09),
    ],
    ['delta inconsistent', (r) => (r['comparison'].cvar95_optimized_minus_current = -0.2)],
    ['outcome inconsistent', (r) => (r['comparison'].outcome = 'current_lower')],
    ['tolerance changed', (r) => (r['comparison'].tie_absolute_tolerance = 1e-6)],
    ['switching cost included', (r) => (r['comparison'].includes_initial_switching_cost = true)],
    ['direction', (r) => (r['comparison'].direction = 'higher_is_better')],
  ])('rejects a result with %s', (_name, mutate) => {
    expect(rejects(mutate)).toBe(true);
  });

  it('accepts an off-grid current mix that beats the grid', () => {
    const checked = validateHouseholdResult(householdResult('current_lower'));
    expect(checked.ok).toBe(true);
  });

  it('rejects a result whose echoed scenario differs from the submitted request', () => {
    const changed = { ...HOUSEHOLD_REQUEST, buffer_months: 4 };
    expect(validateHouseholdResult(householdResult(), changed).ok).toBe(false);
    expect(validateHouseholdResult(householdResult()).ok).toBe(true);
  });

  it('checks share vectors with the (v0 + v1) + v2 rule', () => {
    expect(isValidShareVector([0.1, 0.2, 0.7])).toBe(true);
    expect(isValidShareVector([1, 0, 0])).toBe(true);
    expect(isValidShareVector([1, 0])).toBe(false);
    expect(isValidShareVector([0.5, 0.5, 1e-11])).toBe(false);
    expect(isValidShareVector([0.5, 0.5, Infinity])).toBe(false);
    expect(isValidShareVector([0.5, '0.5', 0])).toBe(false);
  });

  describe('POST envelopes', () => {
    it('accepts 202 queued and running envelopes', () => {
      expect(validateHouseholdJobAccepted(202, householdAccepted()).ok).toBe(true);
      expect(validateHouseholdJobAccepted(202, householdAccepted({ status: 'running' })).ok).toBe(
        true,
      );
    });

    it('accepts a cached 200 with a valid result', () => {
      const body = householdAccepted({
        status: 'succeeded',
        cached: true,
        result: householdResult(),
      });
      const checked = validateHouseholdJobAccepted(200, body);
      expect(checked.ok && checked.value.result?.comparison.outcome).toBe('optimized_lower');
    });

    it('accepts a reused failed job returned with 200', () => {
      const body = householdAccepted({
        status: 'failed',
        error_code: 'max_attempts_exceeded',
        error_message: 'The household analysis job failed.',
      });
      expect(validateHouseholdJobAccepted(200, body).ok).toBe(true);
    });

    it.each<[string, number, Record<string, unknown>]>([
      ['cached flag on 202', 202, householdAccepted({ cached: true })],
      ['succeeded on 202', 202, householdAccepted({ status: 'succeeded' })],
      ['status_url mismatch', 202, householdAccepted({ status_url: '/api/v1/other/' })],
      [
        'invalid job id',
        202,
        householdAccepted({ job_id: 'abc', status_url: '/api/v1/household-analysis-jobs/abc/' }),
      ],
      ['contract version', 202, householdAccepted({ contract_version: 'v0' })],
      ['extra key', 202, householdAccepted({ debug: true })],
      ['cached 200 without result', 200, householdAccepted({ status: 'succeeded', cached: true })],
      [
        'cached 200 not cached',
        200,
        householdAccepted({ status: 'succeeded', cached: false, result: householdResult() }),
      ],
      [
        'cached 200 malformed result',
        200,
        householdAccepted({ status: 'succeeded', cached: true, result: { a: 1 } }),
      ],
      ['200 queued', 200, householdAccepted()],
      ['string cached', 202, householdAccepted({ cached: 'false' })],
    ])('rejects %s', (_name, status, body) => {
      expect(validateHouseholdJobAccepted(status, body).ok).toBe(false);
    });
  });

  describe('GET envelopes', () => {
    it('accepts queued, running, succeeded and failed envelopes for the requested job', () => {
      expect(
        validateHouseholdJobStatus(householdJobStatus('queued'), TEST_HOUSEHOLD_JOB_ID).ok,
      ).toBe(true);
      expect(
        validateHouseholdJobStatus(householdJobStatus('running'), TEST_HOUSEHOLD_JOB_ID).ok,
      ).toBe(true);
      expect(
        validateHouseholdJobStatus(
          householdJobStatus('succeeded', { result: householdResult() }),
          TEST_HOUSEHOLD_JOB_ID,
        ).ok,
      ).toBe(true);
      expect(
        validateHouseholdJobStatus(
          householdJobStatus('failed', { error_code: 'soft_time_limit', error_message: 'x' }),
          TEST_HOUSEHOLD_JOB_ID,
        ).ok,
      ).toBe(true);
    });

    it('rejects a status for a different job id', () => {
      expect(
        validateHouseholdJobStatus(householdJobStatus('queued'), OTHER_HOUSEHOLD_JOB_ID).ok,
      ).toBe(false);
    });

    it.each<[string, Record<string, unknown>]>([
      ['succeeded without result', householdJobStatus('succeeded')],
      ['succeeded with malformed result', householdJobStatus('succeeded', { result: { x: 1 } })],
      ['failed without error fields', householdJobStatus('failed')],
      ['queued with result', householdJobStatus('queued', { result: householdResult() })],
      ['unknown status', householdJobStatus('queued', { status: 'done' })],
      ['extra key', householdJobStatus('queued', { traceback: 'x' })],
      ['missing created_at', householdJobStatus('queued', { created_at: undefined })],
    ])('rejects %s', (_name, body) => {
      const cleaned = JSON.parse(JSON.stringify(body));
      expect(validateHouseholdJobStatus(cleaned, TEST_HOUSEHOLD_JOB_ID).ok).toBe(false);
    });
  });

  it('parses 422 reasons and refuses unexpected shapes', () => {
    const reasons = [
      {
        code: 'buffer_months_out_of_supported_range',
        field: 'buffer_months',
        supported: { min: 1, max: 12 },
      },
    ];
    expect(parseUnsupportedReasons(reasons)).toEqual(reasons);
    expect(parseUnsupportedReasons([{ code: 'x' }])).toBeNull();
    expect(parseUnsupportedReasons([])).toBeNull();
    expect(parseUnsupportedReasons('x')).toBeNull();
  });
});
