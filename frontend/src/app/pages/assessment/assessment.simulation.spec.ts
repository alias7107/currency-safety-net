import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';

import { emptyAssessmentDraft, type AssessmentDraft } from '../../core/assessment/assessment.model';
import { HouseholdAnalysisStore } from '../../core/household/household-analysis.store';
import { EN_STRINGS } from '../../core/i18n/en';
import { ASSESSMENT_DRAFT_STORAGE_KEY, AssessmentStore } from '../../core/state/assessment.store';
import { MODEL_OPTIONS } from '../../testing/fixtures';
import {
  HOUSEHOLD_JOBS_URL,
  OTHER_HOUSEHOLD_JOB_ID,
  TEST_HOUSEHOLD_JOB_ID,
  householdAccepted,
  householdJobUrl,
  householdResult,
} from '../../testing/household-analysis.fixtures';
import { AssessmentPage } from './assessment.page';

const OPTIONS_URL = '/api/v1/model/options/';
const sim = EN_STRINGS.assessment.simulation;

const CONTRACT_KEYS = [
  'contract_version',
  'income_shares',
  'expense_shares',
  'current_reserve_weights',
  'expense_income_ratio',
  'buffer_months',
  'horizon_years',
  'rebalance_frequency',
  'conversion_cost',
].sort();

/** Eligible mixed-currency household with different user rates. */
function eligibleDraft(overrides: Partial<AssessmentDraft> = {}): AssessmentDraft {
  return {
    ...emptyAssessmentDraft(),
    step: 4,
    incomeCurrencies: ['KZT', 'USD'],
    expenseCurrencies: ['KZT', 'EUR'],
    reserveCurrencies: ['USD', 'EUR'],
    income: { KZT: '300000', USD: '1000' },
    expenses: { KZT: '600000', EUR: '200' },
    reserves: { USD: '2000', EUR: '500' },
    rates: { USD: '500', EUR: '550' },
    valuationDate: '2026-01-15',
    monthlyContribution: '75000',
    horizonYears: 3,
    rebalanceFrequency: 'quarterly',
    conversionCost: 0.0025,
    ...overrides,
  };
}

describe('AssessmentPage personal simulation', () => {
  let fixture: ComponentFixture<AssessmentPage>;
  let http: HttpTestingController;
  let router: Router;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    http.verify();
    sessionStorage.clear();
    localStorage.clear();
  });

  async function create(
    draft: AssessmentDraft | null = eligibleDraft(),
    options: 'ok' | 'fail' = 'ok',
  ): Promise<void> {
    if (draft) {
      sessionStorage.setItem(ASSESSMENT_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    }
    fixture = TestBed.createComponent(AssessmentPage);
    fixture.detectChanges();
    const req = http.expectOne(OPTIONS_URL);
    if (options === 'ok') {
      req.flush(MODEL_OPTIONS);
    } else {
      req.flush(
        { error: { code: 'unavailable', message: 'down' } },
        { status: 503, statusText: 'Service Unavailable' },
      );
    }
    await settle();
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return (host().textContent ?? '').replace(/\s+/g, ' ');
  }

  function el<T extends HTMLElement = HTMLElement>(testId: string): T {
    const found = host().querySelector<T>(`[data-testid="${testId}"]`);
    if (!found) {
      throw new Error(`Missing [data-testid="${testId}"]`);
    }
    return found;
  }

  function maybe(testId: string): HTMLElement | null {
    return host().querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  }

  function runButton(): HTMLButtonElement {
    return el<HTMLButtonElement>('run-simulation');
  }

  function expectPost(): TestRequest {
    const req = http.expectOne(HOUSEHOLD_JOBS_URL);
    expect(req.request.method).toBe('POST');
    return req;
  }

  it('offers the run button directly for an eligible overview, without a confirmation step', async () => {
    await create();
    expect(el('assessment-overview')).toBeTruthy();
    expect(maybe('simulation-ineligible')).toBeNull();
    expect(runButton().disabled).toBe(false);
    expect(maybe('simulation-run-status')).toBeNull();
    expect(runButton().getAttribute('aria-describedby')).toBeNull();
    expect(runButton().textContent).toContain(sim.run);
    const section = el('assessment-simulation');
    expect(section.querySelector('input[type="checkbox"]')).toBeNull();
    expect(section.querySelector('[role="dialog"]')).toBeNull();
    expect(section.textContent).not.toMatch(
      /Before you run it|What is sent and stored|Confirm the/,
    );
    expect(text()).not.toMatch(/Target Finder will/);
    expect(el('total-income')).toBeTruthy();
    expect(el('reserve-composition')).toBeTruthy();
  });

  it('never POSTs on load, restore, or after editing answers', async () => {
    await create();
    TestBed.inject(AssessmentStore).patch({ conversionCost: 0.005 });
    await settle();
    TestBed.inject(AssessmentStore).patch({ monthlyContribution: '80000' });
    await settle();
    expect(runButton().disabled).toBe(false);
    http.expectNone((req) => req.method === 'POST');
    http.expectNone((req) => req.url.includes('optimization-jobs'));
    http.expectNone((req) => req.url.includes('buffer-sensitivity-jobs'));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('submits exactly the contracted normalized fields once, then navigates to the results route', async () => {
    await create();
    expect(runButton().disabled).toBe(false);
    runButton().click();
    runButton().click();
    await settle();
    expect(runButton().disabled).toBe(true);
    expect(runButton().textContent).toContain(sim.submitting);

    const req = expectPost();
    expect(req.request.url).toBe('/api/v1/household-analysis-jobs/');
    expect(Object.keys(req.request.body).sort()).toEqual(CONTRACT_KEYS);
    expect(req.request.body.income_shares).toEqual([300000 / 800000, 500000 / 800000, 0]);
    expect(req.request.body.expense_shares).toEqual([600000 / 710000, 0, 110000 / 710000]);
    expect(req.request.body.current_reserve_weights).toEqual([
      0,
      1000000 / 1275000,
      275000 / 1275000,
    ]);
    expect(req.request.body.expense_income_ratio).toBe(710000 / 800000);
    expect(req.request.body.buffer_months).toBe(1275000 / 710000);
    const json = JSON.stringify(req.request.body);
    for (const raw of [
      '300000',
      '600000',
      '75000',
      '2026-01-15',
      'KZ"',
      'valuation',
      'acknowledg',
    ]) {
      expect(json).not.toContain(raw);
    }

    req.flush(householdAccepted(), { status: 202, statusText: 'Accepted' });
    await settle();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/assessment/results', TEST_HOUSEHOLD_JOB_ID]);
    const entry = TestBed.inject(HouseholdAnalysisStore).get(TEST_HOUSEHOLD_JOB_ID)!;
    expect(entry.request).toEqual(req.request.body);
    expect(entry.result).toBeNull();
    expect(JSON.stringify(entry)).not.toContain('300000');
    expect(router.url).not.toMatch(/300000|income|share/);
  });

  it('stores a validated cached 200 result and navigates without waiting for polling', async () => {
    await create();
    runButton().click();
    await settle();
    const req = expectPost();
    const result = householdResult('optimized_lower', req.request.body);
    req.flush(householdAccepted({ status: 'succeeded', cached: true, result }));
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/assessment/results', TEST_HOUSEHOLD_JOB_ID]);
    expect(
      TestBed.inject(HouseholdAnalysisStore).get(TEST_HOUSEHOLD_JOB_ID)!.result,
    ).not.toBeNull();
    http.expectNone(householdJobUrl());
  });

  it('refuses a cached result whose scenario does not echo the submission', async () => {
    await create();
    runButton().click();
    await settle();
    const req = expectPost();
    req.flush(householdAccepted({ status: 'succeeded', cached: true, result: householdResult() }));
    await settle();
    expect(navigate).not.toHaveBeenCalled();
    expect(el('simulation-error').getAttribute('data-code')).toBe('malformed_response');
  });

  it('clears a previous error when answers change but does not resubmit automatically', async () => {
    await create();
    runButton().click();
    await settle();
    expectPost().flush(
      { error: { code: 'provenance_unavailable', message: 'x' } },
      { status: 503, statusText: 'Service Unavailable' },
    );
    await settle();
    expect(maybe('simulation-error')).toBeTruthy();

    TestBed.inject(AssessmentStore).patch({ conversionCost: 0.005 });
    await settle();
    expect(maybe('simulation-error')).toBeNull();
    expect(runButton().disabled).toBe(false);
    http.expectNone((req) => req.method === 'POST');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not associate a response with answers revised while it was pending', async () => {
    await create();
    runButton().click();
    await settle();
    const req = expectPost();
    TestBed.inject(AssessmentStore).patch({ monthlyContribution: '1' });
    await settle();
    req.flush(householdAccepted(), { status: 202, statusText: 'Accepted' });
    await settle();
    expect(navigate).not.toHaveBeenCalled();
    expect(el('simulation-stale').textContent).toContain(sim.changedWhilePending);
    const link = el('simulation-stale').querySelector('a')!;
    expect(link.getAttribute('href')).toBe(`/assessment/results/${TEST_HOUSEHOLD_JOB_ID}`);
  });

  it('lists every reason for a zero reserve without calling it unsafe', async () => {
    await create(eligibleDraft({ noReserve: true, reserveCurrencies: [], reserves: {} }));
    expect(runButton().disabled).toBe(true);
    expect(el('simulation-run-status').textContent).toContain(sim.runUnavailable.ineligible);
    expect(runButton().getAttribute('aria-describedby')).toBe('simulation-run-status');
    runButton().click();
    await settle();
    http.expectNone((req) => req.method === 'POST');
    const reasons = Array.from(host().querySelectorAll('[data-testid="simulation-reason"]'));
    expect(reasons.map((r) => r.getAttribute('data-reason'))).toEqual(['no_current_reserve']);
    expect(text()).toContain('outside the model’s supported range');
    expect(text()).toContain(sim.ineligibleNote);
    expect(el('reserve-coverage').textContent).toContain('0.00 months');

    el('simulation-reason-edit-no_current_reserve').click();
    await settle();
    expect(el('assessment-step-heading').textContent).toContain(
      EN_STRINGS.assessment.steps[2].label,
    );
  });

  it('shows the out-of-range values with the supported ranges and keeps them unchanged', async () => {
    await create(
      eligibleDraft({ expenses: { KZT: '100000', EUR: '0' }, reserves: { USD: '4000', EUR: '0' } }),
    );
    const reasons = Array.from(host().querySelectorAll('[data-testid="simulation-reason"]'));
    expect(reasons.map((r) => r.getAttribute('data-reason'))).toEqual([
      'expense_income_ratio_out_of_supported_range',
      'buffer_months_out_of_supported_range',
    ]);
    expect(text()).toContain('12.5%');
    expect(text()).toContain('80% to 105%');
    expect(text()).toContain('20.00 months');
    const stored = JSON.parse(sessionStorage.getItem(ASSESSMENT_DRAFT_STORAGE_KEY)!);
    expect(stored.expenses).toEqual({ KZT: '100000', EUR: '0' });
  });

  it('requires loaded model settings', async () => {
    await create(eligibleDraft(), 'fail');
    const reasons = Array.from(host().querySelectorAll('[data-testid="simulation-reason"]'));
    expect(reasons.map((r) => r.getAttribute('data-reason'))).toContain(
      'model_settings_unavailable',
    );
    expect(runButton().disabled).toBe(true);
    expect(el('simulation-run-status').textContent).toContain(sim.runUnavailable.ineligible);
    runButton().click();
    await settle();
    http.expectNone((req) => req.method === 'POST');
  });

  it('keeps the button visible but disabled while settings load, then enables it without submitting', async () => {
    sessionStorage.setItem(ASSESSMENT_DRAFT_STORAGE_KEY, JSON.stringify(eligibleDraft()));
    fixture = TestBed.createComponent(AssessmentPage);
    fixture.detectChanges();
    const optionsReq = http.expectOne(OPTIONS_URL);
    expect(runButton().disabled).toBe(true);
    expect(el('simulation-run-status').textContent).toContain(sim.runUnavailable.loading);
    expect(runButton().getAttribute('aria-describedby')).toBe('simulation-run-status');
    expect(maybe('simulation-ineligible')).toBeNull();
    runButton().click();
    http.expectNone((req) => req.method === 'POST');

    optionsReq.flush(MODEL_OPTIONS);
    await settle();
    expect(runButton().disabled).toBe(false);
    expect(maybe('simulation-run-status')).toBeNull();
    http.expectNone((req) => req.method === 'POST');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('enables the button automatically once answers become eligible, but never submits by itself', async () => {
    await create(eligibleDraft({ reserves: { USD: '20000', EUR: '0' } }));
    const reasons = Array.from(host().querySelectorAll('[data-testid="simulation-reason"]'));
    expect(reasons.map((r) => r.getAttribute('data-reason'))).toEqual([
      'buffer_months_out_of_supported_range',
    ]);
    expect(el('simulation-reason-edit-buffer_months_out_of_supported_range')).toBeTruthy();
    expect(runButton().disabled).toBe(true);

    TestBed.inject(AssessmentStore).patch({ reserves: { USD: '2000', EUR: '500' } });
    await settle();
    expect(maybe('simulation-ineligible')).toBeNull();
    expect(runButton().disabled).toBe(false);
    http.expectNone((req) => req.method === 'POST');
    expect(navigate).not.toHaveBeenCalled();

    runButton().click();
    await settle();
    expectPost().flush(householdAccepted(), { status: 202, statusText: 'Accepted' });
    await settle();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('refuses to POST from the guard itself while requirements are unmet', async () => {
    await create(eligibleDraft({ noReserve: true, reserveCurrencies: [], reserves: {} }));
    (fixture.componentInstance as unknown as { runSimulation(): void }).runSimulation();
    await settle();
    http.expectNone((req) => req.method === 'POST');
  });

  async function failWith(body: object, status: number, headers: Record<string, string> = {}) {
    await create();
    runButton().click();
    await settle();
    expectPost().flush(body, { status, statusText: 'x', headers });
    await settle();
  }

  it('explains disabled submissions and keeps the answers', async () => {
    await failWith(
      { error: { code: 'submissions_disabled', message: 'Personal simulations are disabled.' } },
      503,
    );
    expect(el('simulation-error').getAttribute('data-code')).toBe('submissions_disabled');
    expect(text()).toContain(sim.errors.disabledTitle);
    expect(navigate).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(ASSESSMENT_DRAFT_STORAGE_KEY)!).income).toEqual({
      KZT: '300000',
      USD: '1000',
    });
    expect(host().querySelector('[role="alert"]')).toBeTruthy();
  });

  it('distinguishes provenance and queue failures, linking the failed job record', async () => {
    await failWith(
      {
        job_id: OTHER_HOUSEHOLD_JOB_ID,
        status: 'failed',
        cached: false,
        status_url: householdJobUrl(OTHER_HOUSEHOLD_JOB_ID),
        contract_version: 'household_analysis_v1',
        error: { code: 'queue_unavailable', message: 'Queue unavailable.' },
      },
      503,
    );
    expect(text()).toContain(sim.errors.queueTitle);
    expect(el('simulation-failed-job').querySelector('a')!.getAttribute('href')).toBe(
      `/assessment/results/${OTHER_HOUSEHOLD_JOB_ID}`,
    );
    expect(navigate).not.toHaveBeenCalled();
    // Resubmitting is an explicit action.
    http.expectNone((req) => req.method === 'POST');
    expect(runButton().disabled).toBe(false);
  });

  it('shows provenance_unavailable with its own copy', async () => {
    await failWith({ error: { code: 'provenance_unavailable', message: 'x' } }, 503);
    expect(text()).toContain(sim.errors.provenanceTitle);
  });

  it('lists server 422 reasons with edit links', async () => {
    await failWith(
      {
        error: {
          code: 'unsupported_scenario',
          message: 'Outside the range.',
          reasons: [
            {
              code: 'conversion_cost_out_of_supported_range',
              field: 'conversion_cost',
              supported: { min: 0, max: 0.01 },
            },
          ],
        },
      },
      422,
    );
    expect(text()).toContain(sim.errors.unsupportedTitle);
    const list = el('simulation-server-reasons');
    expect(list.textContent).toContain('0.25%');
    list.querySelector('button')!.click();
    await settle();
    expect(el('assessment-step-heading').textContent).toContain(
      EN_STRINGS.assessment.steps[3].label,
    );
  });

  it('respects Retry-After on 429 before allowing another explicit submission', async () => {
    vi.useFakeTimers();
    try {
      await failWith({ detail: 'Request was throttled.' }, 429, { 'Retry-After': '30' });
      expect(text()).toContain(sim.errors.rateLimitTitle);
      expect(el('simulation-retry-after').textContent).toContain('30');
      expect(runButton().disabled).toBe(true);
      expect(runButton().getAttribute('aria-describedby')).toBe('simulation-retry-after');
      runButton().click();
      fixture.detectChanges();
      http.expectNone((req) => req.method === 'POST');
      await vi.advanceTimersByTimeAsync(30_000);
      fixture.detectChanges();
      expect(runButton().disabled).toBe(false);
      http.expectNone((req) => req.method === 'POST');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows network and malformed responses safely', async () => {
    await create();
    runButton().click();
    await settle();
    expectPost().error(new ProgressEvent('error'));
    await settle();
    expect(text()).toContain(sim.errors.networkTitle);
    expect(text()).not.toMatch(/http failure/i);

    runButton().click();
    await settle();
    expectPost().flush({ job_id: 'nope' }, { status: 202, statusText: 'Accepted' });
    await settle();
    expect(text()).toContain(sim.errors.malformedTitle);
  });
});
