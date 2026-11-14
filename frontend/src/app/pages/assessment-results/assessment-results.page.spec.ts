import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { vi } from 'vitest';

import { HouseholdAnalysisStore } from '../../core/household/household-analysis.store';
import { AssessmentStore } from '../../core/state/assessment.store';
import { validateHouseholdResult } from '../../core/household/household-analysis.validation';
import { EN_STRINGS } from '../../core/i18n/en';
import {
  HOUSEHOLD_REQUEST,
  OTHER_HOUSEHOLD_JOB_ID,
  TEST_HOUSEHOLD_JOB_ID,
  householdJobStatus,
  householdJobUrl,
  householdResult,
} from '../../testing/household-analysis.fixtures';
import {
  AssessmentResultsPage,
  HOUSEHOLD_ANALYSIS_POLL_INTERVAL_MS,
  personalSimulationStage,
} from './assessment-results.page';

const copy = EN_STRINGS.assessmentResults;

describe('AssessmentResultsPage', () => {
  let fixture: ComponentFixture<AssessmentResultsPage>;
  let http: HttpTestingController;
  let store: HouseholdAnalysisStore;
  let paramMap$: BehaviorSubject<{ get: (key: string) => string | null }>;

  function params(jobId: string | null) {
    return { get: (key: string) => (key === 'jobId' ? jobId : null) };
  }

  async function tick(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    fixture.detectChanges();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return (host().textContent ?? '').replace(/\s+/g, ' ');
  }

  function el(testId: string): HTMLElement | null {
    return host().querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    // Align the clock with householdJobStatus fixture timestamps.
    vi.setSystemTime(new Date('2026-11-10T10:00:10.000Z'));
    paramMap$ = new BehaviorSubject(params(TEST_HOUSEHOLD_JOB_ID));
    TestBed.configureTestingModule({
      imports: [AssessmentResultsPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { paramMap: paramMap$.asObservable() } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(HouseholdAnalysisStore);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  function create(): void {
    fixture = TestBed.createComponent(AssessmentResultsPage);
    fixture.detectChanges();
  }

  it('polls a direct URL through queued and running to success, then stops', async () => {
    create();
    await tick(0);
    http.expectOne(householdJobUrl()).flush(householdJobStatus('queued'));
    fixture.detectChanges();
    expect(el('personal-results-processing')).toBeTruthy();
    expect(text()).toContain(copy.processingBody);
    expect(text()).toContain(copy.statusQueued);
    expect(text()).toContain(copy.processingExpected);
    expect(el('personal-results-elapsed')!.textContent).toContain('10 seconds');
    expect(el('personal-results-stage')!.textContent).toContain(copy.processingStages.queued);
    expect(text().toLowerCase()).not.toMatch(/\d+% complete|progress: \d/);

    await tick(HOUSEHOLD_ANALYSIS_POLL_INTERVAL_MS);
    http.expectOne(householdJobUrl()).flush(householdJobStatus('running'));
    fixture.detectChanges();
    expect(text()).toContain(copy.statusRunning);
    expect(el('personal-results-elapsed')!.textContent).toContain('9 seconds');
    expect(el('personal-results-stage')!.textContent).toContain(copy.processingStages.preparing);

    await tick(HOUSEHOLD_ANALYSIS_POLL_INTERVAL_MS);
    http
      .expectOne(householdJobUrl())
      .flush(householdJobStatus('succeeded', { result: householdResult() }));
    fixture.detectChanges();
    expect(el('personal-results')).toBeTruthy();
    expect(el('personal-results-progress')).toBeNull();
    expect(host().querySelectorAll('h1').length).toBe(1);
    expect(el('personal-results-live')!.textContent).toContain(copy.completedLive);

    await tick(HOUSEHOLD_ANALYSIS_POLL_INTERVAL_MS * 3);
    http.expectNone(householdJobUrl());
  });

  it('advances staged copy with elapsed time while running, without a fake percentage', async () => {
    create();
    await tick(0);
    http.expectOne(householdJobUrl()).flush(householdJobStatus('running'));
    fixture.detectChanges();
    expect(el('personal-results-stage')!.textContent).toContain(copy.processingStages.preparing);

    await tick(50_000);
    http.expectOne(householdJobUrl()).flush(householdJobStatus('running'));
    fixture.detectChanges();
    expect(el('personal-results-stage')!.textContent).toContain(copy.processingStages.coarse);
    expect(el('personal-results-elapsed')!.textContent).toContain('55 seconds');

    await tick(120_000);
    http.expectOne(householdJobUrl()).flush(householdJobStatus('running'));
    fixture.detectChanges();
    expect(el('personal-results-stage')!.textContent).toContain(copy.processingStages.refining);
    expect(text().toLowerCase()).not.toMatch(/\d+% complete|progress: \d/);

    fixture.destroy();
    await tick(HOUSEHOLD_ANALYSIS_POLL_INTERVAL_MS * 2);
    http.expectNone(householdJobUrl());
  });

  it('maps elapsed thresholds to stages without claiming completion fraction', () => {
    expect(personalSimulationStage('queued', 999)).toBe('queued');
    expect(personalSimulationStage('running', 10)).toBe('preparing');
    expect(personalSimulationStage('running', 60)).toBe('coarse');
    expect(personalSimulationStage('running', 200)).toBe('refining');
    expect(personalSimulationStage('running', 400)).toBe('extended');
  });

  it('does not overlap poll requests', async () => {
    create();
    await tick(0);
    const first = http.expectOne(householdJobUrl());
    await tick(HOUSEHOLD_ANALYSIS_POLL_INTERVAL_MS * 2);
    http.expectNone(householdJobUrl());
    first.flush(householdJobStatus('running'));
    await tick(HOUSEHOLD_ANALYSIS_POLL_INTERVAL_MS);
    http.expectOne(householdJobUrl()).flush(
      householdJobStatus('failed', {
        error_code: 'soft_time_limit',
        error_message: 'The household analysis job failed.',
      }),
    );
    fixture.detectChanges();
  });

  it('stops on failure and shows safe, mapped copy only', async () => {
    create();
    await tick(0);
    http.expectOne(householdJobUrl()).flush(
      householdJobStatus('failed', {
        error_code: 'provenance_changed',
        error_message: 'Traceback (most recent call last): secret',
      }),
    );
    fixture.detectChanges();
    expect(el('personal-results-failed')).toBeTruthy();
    expect(text()).toContain(copy.failedCodes.provenance_changed);
    expect(text()).not.toContain('Traceback');
    await tick(HOUSEHOLD_ANALYSIS_POLL_INTERVAL_MS);
    http.expectNone(householdJobUrl());
  });

  it('stops polling on destroy', async () => {
    create();
    await tick(0);
    http.expectOne(householdJobUrl()).flush(householdJobStatus('running'));
    fixture.destroy();
    await tick(HOUSEHOLD_ANALYSIS_POLL_INTERVAL_MS * 2);
    http.expectNone(householdJobUrl());
  });

  it('switches jobs on route change and ignores the previous job', async () => {
    create();
    await tick(0);
    const stale = http.expectOne(householdJobUrl());
    paramMap$.next(params(OTHER_HOUSEHOLD_JOB_ID));
    await tick(0);
    const fresh = http.expectOne(householdJobUrl(OTHER_HOUSEHOLD_JOB_ID));
    expect(stale.cancelled).toBe(true);
    fresh.flush(householdJobStatus('running', {}, OTHER_HOUSEHOLD_JOB_ID));
    await tick(HOUSEHOLD_ANALYSIS_POLL_INTERVAL_MS);
    http.expectNone(householdJobUrl());
    http
      .expectOne(householdJobUrl(OTHER_HOUSEHOLD_JOB_ID))
      .flush(
        householdJobStatus('succeeded', { result: householdResult() }, OTHER_HOUSEHOLD_JOB_ID),
      );
    fixture.detectChanges();
    expect(el('personal-results')).toBeTruthy();
  });

  it('shows a cached result from this tab without polling', async () => {
    const checked = validateHouseholdResult(householdResult('current_lower'), HOUSEHOLD_REQUEST);
    if (!checked.ok) {
      throw new Error('fixture');
    }
    store.remember(TEST_HOUSEHOLD_JOB_ID, HOUSEHOLD_REQUEST, checked.value);
    create();
    await tick(HOUSEHOLD_ANALYSIS_POLL_INTERVAL_MS * 2);
    http.expectNone(householdJobUrl());
    expect(el('personal-comparison')!.getAttribute('data-outcome')).toBe('current_lower');
  });

  it('rejects a result that does not echo the request submitted from this tab', async () => {
    store.remember(TEST_HOUSEHOLD_JOB_ID, { ...HOUSEHOLD_REQUEST, horizon_years: 5 });
    create();
    await tick(0);
    http
      .expectOne(householdJobUrl())
      .flush(householdJobStatus('succeeded', { result: householdResult() }));
    fixture.detectChanges();
    expect(el('personal-results')).toBeNull();
    expect(el('personal-results-error')!.getAttribute('data-code')).toBe('malformed_response');
    expect(text()).toContain(copy.malformedTitle);
  });

  it('rejects a malformed result without rendering partial figures', async () => {
    const broken = householdResult();
    broken['comparison'].outcome = 'current_lower';
    create();
    await tick(0);
    http.expectOne(householdJobUrl()).flush(householdJobStatus('succeeded', { result: broken }));
    fixture.detectChanges();
    expect(el('personal-results')).toBeNull();
    expect(text()).toContain(copy.malformedTitle);
  });

  it('shows a not-found state for 404 without a retry', async () => {
    create();
    await tick(0);
    http
      .expectOne(householdJobUrl())
      .flush(
        { error: { code: 'not_found', message: 'Household analysis job not found.' } },
        { status: 404, statusText: 'Not Found' },
      );
    fixture.detectChanges();
    expect(text()).toContain(copy.notFoundTitle);
    expect(el('personal-results-check-again')).toBeNull();
  });

  it('retries a failed GET only on request, respecting Retry-After', async () => {
    create();
    await tick(0);
    http
      .expectOne(householdJobUrl())
      .flush(
        { detail: 'Request was throttled.' },
        { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '10' } },
      );
    fixture.detectChanges();
    const button = el('personal-results-check-again') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(el('personal-results-retry-after')!.textContent).toContain('10');
    await tick(HOUSEHOLD_ANALYSIS_POLL_INTERVAL_MS);
    http.expectNone(householdJobUrl());

    await tick(10_000);
    expect(button.disabled).toBe(false);
    button.click();
    await tick(0);
    http.expectOne(householdJobUrl()).flush(householdJobStatus('running'));
    fixture.detectChanges();
    expect(el('personal-results-processing')).toBeTruthy();
    fixture.destroy();
  });

  it('retries a network failure by refetching the same job', async () => {
    create();
    await tick(0);
    http.expectOne(householdJobUrl()).error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(text()).toContain(copy.loadErrorTitle);
    (el('personal-results-check-again') as HTMLButtonElement).click();
    await tick(0);
    const req = http.expectOne(householdJobUrl());
    expect(req.request.method).toBe('GET');
    req.flush(householdJobStatus('succeeded', { result: householdResult() }));
    fixture.detectChanges();
    expect(el('personal-results')).toBeTruthy();
    http.expectNone((r) => r.method === 'POST');
  });

  it('refuses an invalid job id without requesting anything', async () => {
    paramMap$.next(params('not-a-uuid'));
    create();
    await tick(HOUSEHOLD_ANALYSIS_POLL_INTERVAL_MS);
    http.expectNone(() => true);
    expect(text()).toContain(copy.invalidIdTitle);
  });

  describe('result presentation', () => {
    async function showResult(
      outcome: 'optimized_lower' | 'current_lower' | 'equal_within_tolerance',
    ) {
      create();
      await tick(0);
      http
        .expectOne(householdJobUrl())
        .flush(householdJobStatus('succeeded', { result: householdResult(outcome) }));
      fixture.detectChanges();
    }

    it('shows assumptions, both allocations with CVaR95, the signed difference and outcome', async () => {
      await showResult('optimized_lower');
      const assumptions = el('personal-assumptions')!.textContent!;
      expect(assumptions).toContain('KZT 60%, USD 40%, EUR 0%');
      expect(assumptions).toContain('90%');
      expect(assumptions).toContain('3.00 months');
      expect(assumptions).toContain('Quarterly');
      expect(el('personal-current-cvar')!.textContent).toContain('0.42');
      expect(el('personal-optimized-cvar')!.textContent).toContain('0.31');
      expect(el('personal-difference')!.textContent).toContain('−0.1100');
      expect(el('personal-outcome')!.textContent).toContain(copy.outcomes.optimized_lower);
      expect(text()).toContain(copy.comparisonNote);
      expect(text()).toContain(copy.cvarBody);
      const charts = host().querySelectorAll('app-allocation-chart svg[role="img"]');
      const labels = Array.from(charts).map((c) => c.getAttribute('aria-label') ?? '');
      expect(labels.length).toBe(2);
      expect(labels[0]).toContain(`${copy.currentChartLabel}: Kazakhstani tenge 50%`);
      expect(labels[1]).toContain(`${copy.optimizedChartLabel}: Kazakhstani tenge 30%`);
    });

    it('presents an off-grid current mix that wins honestly', async () => {
      await showResult('current_lower');
      expect(el('personal-difference')!.textContent).toContain('+0.0500');
      expect(el('personal-outcome')!.textContent).toContain(copy.outcomes.current_lower);
    });

    it('presents a tie within tolerance without rounding a non-zero difference to zero', async () => {
      await showResult('equal_within_tolerance');
      expect(el('personal-difference')!.textContent).toContain('+less than 0.0001');
      expect(el('personal-outcome')!.textContent).toContain(copy.outcomes.equal_within_tolerance);
    });

    it('separates diagnostics, implementation-only figures, identification and provenance', async () => {
      await showResult('optimized_lower');
      expect(el('personal-diagnostics')).toBeTruthy();
      expect(el('personal-implementation')).toBeTruthy();
      expect(text()).toContain(copy.implementationHeading);
      expect(el('personal-identification')!.textContent).toContain(copy.identificationNote);
      expect(el('personal-identification')!.textContent).toContain('8 (8%)');
      const provenance = el('personal-provenance')!.textContent!;
      expect(provenance).toContain('a'.repeat(64));
      expect(provenance).toContain('10,000');
      expect(provenance).toContain('42');
      expect(provenance).toContain(TEST_HOUSEHOLD_JOB_ID);
      for (const item of copy.limitations) {
        expect(text()).toContain(item);
      }
    });

    it('contains no score, risk band, guarantee or trading instruction', async () => {
      await showResult('optimized_lower');
      const disclaimer = copy.limitations[copy.limitations.length - 1]!;
      expect(text()).toContain(disclaimer);
      const lower = text().replace(disclaimer, '').toLowerCase();
      for (const forbidden of [
        'resilience score',
        'risk band',
        'recommended buffer',
        'you should buy',
        'you should sell',
        'guaranteed',
        'target finder',
      ]) {
        expect(lower).not.toContain(forbidden);
      }
    });

    it('adds a plain-language conclusion after the technical sections and before the links', async () => {
      await showResult('optimized_lower');
      const plain = el('personal-plain-language')!;
      expect(plain.getAttribute('data-outcome')).toBe('optimized_lower');
      expect(plain.querySelector('h2')!.textContent).toContain(copy.plainLanguage.heading);
      const headings = Array.from(plain.querySelectorAll('h3')).map((h) => h.textContent!.trim());
      expect(headings).toEqual([
        copy.plainLanguage.startingHeading,
        copy.plainLanguage.simulationHeading,
        copy.plainLanguage.comparisonHeading,
      ]);
      const order = Array.from(
        host().querySelectorAll(
          '[data-testid="personal-limitations"], [data-testid="personal-plain-language"], [data-testid="personal-results-links"]',
        ),
      ).map((n) => n.getAttribute('data-testid'));
      expect(order).toEqual([
        'personal-limitations',
        'personal-plain-language',
        'personal-results-links',
      ]);
      expect(el('plain-starting-point')!.textContent).toContain('90% of your income');
      expect(el('plain-starting-point')!.textContent).toContain('3 months');
      expect(el('plain-simulation')!.textContent).toContain('In 12% of simulated scenarios');
      expect(el('plain-comparison')!.textContent).toContain(
        copy.plainLanguage.outcomes.optimized_lower,
      );
      expect(el('plain-interpretation')!.textContent).toContain(copy.plainLanguage.interpretation);
      expect(host().querySelector('input[type="checkbox"]')).toBeNull();
      for (const item of copy.limitations) {
        expect(el('personal-limitations')!.textContent).toContain(item);
      }
    });

    it('shows the matching comparison wording for each validated outcome', async () => {
      await showResult('current_lower');
      expect(el('personal-plain-language')!.getAttribute('data-outcome')).toBe('current_lower');
      expect(el('plain-comparison')!.textContent).toContain(
        copy.plainLanguage.outcomes.current_lower,
      );
      expect(el('plain-comparison')!.textContent).not.toContain(copy.plainLanguage.notIdentified);
    });

    it('presents a tie as essentially the same result', async () => {
      await showResult('equal_within_tolerance');
      expect(el('plain-comparison')!.textContent).toContain(
        copy.plainLanguage.outcomes.equal_within_tolerance,
      );
    });

    it('describes the submitted scenario for this job, not the questionnaire draft in this tab', async () => {
      TestBed.inject(AssessmentStore).patch({
        incomeCurrencies: ['KZT'],
        income: { KZT: '1000000' },
        expenseCurrencies: ['KZT'],
        expenses: { KZT: '500000' },
        reserveCurrencies: ['KZT'],
        reserves: { KZT: '5000000' },
        horizonYears: 5,
      });
      const submitted = {
        ...HOUSEHOLD_REQUEST,
        expense_income_ratio: 1.025,
        buffer_months: 7.5,
        horizon_years: 1,
      };
      const raw = householdResult('current_lower', submitted);
      raw['current_policy'].diagnostics.shortfall_probability = 0.004;
      store.remember(TEST_HOUSEHOLD_JOB_ID, submitted);
      create();
      await tick(0);
      http.expectOne(householdJobUrl()).flush(householdJobStatus('succeeded', { result: raw }));
      fixture.detectChanges();

      const starting = el('plain-starting-point')!.textContent!;
      expect(starting).toContain('102.5% of your income, which means they were higher');
      expect(starting).toContain('equal to 7.5 months');
      expect(starting).not.toMatch(/50%|10 months/);
      const simulation = el('plain-simulation')!.textContent!;
      expect(simulation).toContain('In 0.4% of simulated scenarios');
      expect(simulation).toContain('over 1 year.');
      expect(simulation).not.toContain('5 years');
      http.expectNone((r) => r.method === 'POST');
    });

    it('describes class C without presenting the selected mix as uniquely preferred', async () => {
      const raw = householdResult('optimized_lower');
      raw['optimized_policy'].identification.identification_class = 'C_NOT_IDENTIFIED';
      create();
      await tick(0);
      http.expectOne(householdJobUrl()).flush(householdJobStatus('succeeded', { result: raw }));
      fixture.detectChanges();
      expect(el('plain-comparison')!.textContent).toContain(copy.plainLanguage.notIdentified);
      expect(el('plain-comparison')!.textContent).not.toContain('C_NOT_IDENTIFIED');
    });

    it('shows no conclusion while processing or when the result fails validation', async () => {
      create();
      await tick(0);
      http.expectOne(householdJobUrl()).flush(householdJobStatus('running'));
      fixture.detectChanges();
      expect(el('personal-plain-language')).toBeNull();
      await tick(HOUSEHOLD_ANALYSIS_POLL_INTERVAL_MS);
      const broken = householdResult();
      broken['comparison'].outcome = 'current_lower';
      http.expectOne(householdJobUrl()).flush(householdJobStatus('succeeded', { result: broken }));
      fixture.detectChanges();
      expect(el('personal-results-error')).toBeTruthy();
      expect(el('personal-plain-language')).toBeNull();
    });

    it('links back to the assessment and to the research calculator only', async () => {
      await showResult('optimized_lower');
      const hrefs = Array.from(host().querySelectorAll('a')).map((a) => a.getAttribute('href'));
      expect(hrefs).toContain('/assessment');
      expect(hrefs).toContain('/research/calculator');
      expect(hrefs.some((h) => h?.startsWith('/report') || h?.startsWith('/compare'))).toBe(false);
      expect(hrefs.some((h) => h?.startsWith('/buffer-sensitivity'))).toBe(false);
    });
  });
});
