import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { vi } from 'vitest';

import { AnalyticsService } from '../core/analytics/analytics.service';
import { emptyAssessmentDraft, type AssessmentDraft } from '../core/assessment/assessment.model';
import { ASSESSMENT_DRAFT_STORAGE_KEY, AssessmentStore } from '../core/state/assessment.store';
import { MODEL_OPTIONS } from '../testing/fixtures';
import {
  HOUSEHOLD_JOBS_URL,
  TEST_HOUSEHOLD_JOB_ID,
  householdAccepted,
  householdJobStatus,
  householdJobUrl,
  householdResult,
} from '../testing/household-analysis.fixtures';
import {
  AssessmentResultsPage,
  HOUSEHOLD_ANALYSIS_POLL_INTERVAL_MS,
} from './assessment-results/assessment-results.page';
import { AssessmentPage } from './assessment/assessment.page';
import { CalculatorPage } from './calculator/calculator.page';

const OPTIONS_URL = '/api/v1/model/options/';

function completeDraft(overrides: Partial<AssessmentDraft> = {}): AssessmentDraft {
  return {
    ...emptyAssessmentDraft(),
    incomeCurrencies: ['KZT'],
    expenseCurrencies: ['KZT'],
    reserveCurrencies: ['KZT'],
    income: { KZT: '1000000' },
    expenses: { KZT: '900000' },
    reserves: { KZT: '2700000' },
    horizonYears: 3,
    rebalanceFrequency: 'quarterly',
    conversionCost: 0.0025,
    ...overrides,
  };
}

describe('analytics events', () => {
  let track: ReturnType<typeof vi.fn>;
  let http: HttpTestingController;
  let paramMap$: BehaviorSubject<{ get: (key: string) => string | null }>;

  const named = (event: string) => track.mock.calls.filter((call) => call[0] === event);

  beforeEach(() => {
    sessionStorage.clear();
    track = vi.fn();
    paramMap$ = new BehaviorSubject<{ get: (key: string) => string | null }>({
      get: (key: string) => (key === 'jobId' ? TEST_HOUSEHOLD_JOB_ID : null),
    });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: AnalyticsService,
          useValue: { track, enabled: false },
        },
        { provide: ActivatedRoute, useValue: { paramMap: paramMap$.asObservable() } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  describe('assessment', () => {
    async function createAssessment(draft: AssessmentDraft | null) {
      if (draft) {
        sessionStorage.setItem(ASSESSMENT_DRAFT_STORAGE_KEY, JSON.stringify(draft));
      }
      const fixture = TestBed.createComponent(AssessmentPage);
      fixture.detectChanges();
      http.expectOne(OPTIONS_URL).flush(MODEL_OPTIONS);
      await fixture.whenStable();
      fixture.detectChanges();
      const el = (id: string) =>
        (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
      const settle = async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
      };
      return { fixture, el, settle };
    }

    it('fires assessment_started once, on the first answer in a new assessment', async () => {
      const { el, settle } = await createAssessment(null);
      expect(named('assessment_started')).toHaveLength(0);
      el('incomeCurrencies-KZT').click();
      await settle();
      el('expenseCurrencies-KZT').click();
      await settle();
      expect(named('assessment_started')).toHaveLength(1);

      TestBed.inject(AssessmentStore).clear();
      await settle();
      expect(named('assessment_started')).toHaveLength(1);
      el('incomeCurrencies-USD').click();
      await settle();
      expect(named('assessment_started')).toHaveLength(2);
    });

    it('does not fire assessment_started when a saved draft is restored and edited', async () => {
      const { settle } = await createAssessment(completeDraft({ step: 1 }));
      TestBed.inject(AssessmentStore).patch({ income: { KZT: '1100000' } });
      await settle();
      expect(named('assessment_started')).toHaveLength(0);
    });

    it('fires assessment_step_completed only when Continue actually advances', async () => {
      const { el, settle } = await createAssessment(completeDraft({ step: 1, expenses: {} }));
      el('assessment-next').click();
      await settle();
      expect(named('assessment_step_completed')).toHaveLength(0);

      TestBed.inject(AssessmentStore).patch({ expenses: { KZT: '900000' } });
      await settle();
      el('assessment-next').click();
      await settle();
      expect(named('assessment_step_completed')).toHaveLength(1);
      expect(track.mock.calls.every((call) => call.length === 1)).toBe(true);
    });

    it('fires assessment_overview_viewed once per visit to the overview, not per render', async () => {
      const { fixture, el, settle } = await createAssessment(completeDraft({ step: 3 }));
      el('assessment-view-overview').click();
      await settle();
      expect(named('assessment_step_completed')).toHaveLength(1);
      expect(named('assessment_overview_viewed')).toHaveLength(1);
      fixture.detectChanges();
      await settle();
      expect(named('assessment_overview_viewed')).toHaveLength(1);

      el('assessment-back-to-questions').click();
      await settle();
      el('assessment-view-overview').click();
      await settle();
      expect(named('assessment_overview_viewed')).toHaveLength(2);
    });

    it('fires personal_simulation_submitted once per accepted submission, never for a failed one', async () => {
      const { el, settle } = await createAssessment(completeDraft({ step: 4 }));
      const run = () => el('run-simulation').click();

      run();
      await settle();
      http
        .expectOne(HOUSEHOLD_JOBS_URL)
        .flush(
          { error: { code: 'submissions_disabled', message: 'x' } },
          { status: 503, statusText: 'x' },
        );
      await settle();
      expect(named('personal_simulation_submitted')).toHaveLength(0);

      run();
      run();
      await settle();
      http
        .expectOne(HOUSEHOLD_JOBS_URL)
        .flush(householdAccepted(), { status: 202, statusText: 'Accepted' });
      await settle();
      expect(named('personal_simulation_submitted')).toEqual([['personal_simulation_submitted']]);
    });
  });

  it('fires personal_simulation_result_viewed once per validated result, not per poll', async () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(AssessmentResultsPage);
    fixture.detectChanges();
    const tick = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      fixture.detectChanges();
    };
    await tick(0);
    http.expectOne(householdJobUrl()).flush(householdJobStatus('queued'));
    await tick(HOUSEHOLD_ANALYSIS_POLL_INTERVAL_MS);
    http.expectOne(householdJobUrl()).flush(householdJobStatus('running'));
    expect(named('personal_simulation_result_viewed')).toHaveLength(0);

    await tick(HOUSEHOLD_ANALYSIS_POLL_INTERVAL_MS);
    http
      .expectOne(householdJobUrl())
      .flush(householdJobStatus('succeeded', { result: householdResult() }));
    await tick(HOUSEHOLD_ANALYSIS_POLL_INTERVAL_MS * 3);
    http.expectNone(householdJobUrl());
    expect(named('personal_simulation_result_viewed')).toEqual([
      ['personal_simulation_result_viewed', TEST_HOUSEHOLD_JOB_ID],
    ]);
    fixture.destroy();
  });

  it('does not fire personal_simulation_result_viewed for a result that fails validation', async () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(AssessmentResultsPage);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    const broken = householdResult();
    broken['comparison'].outcome = 'current_lower';
    http.expectOne(householdJobUrl()).flush(householdJobStatus('succeeded', { result: broken }));
    fixture.detectChanges();
    expect(named('personal_simulation_result_viewed')).toHaveLength(0);
    fixture.destroy();
  });

  it('fires research_calculator_opened once each time the calculator is opened', () => {
    const first = TestBed.createComponent(CalculatorPage);
    first.detectChanges();
    first.detectChanges();
    expect(named('research_calculator_opened')).toEqual([['research_calculator_opened']]);
    first.destroy();
    const second = TestBed.createComponent(CalculatorPage);
    second.detectChanges();
    expect(named('research_calculator_opened')).toHaveLength(2);
    http.match(() => true);
    second.destroy();
  });
});
