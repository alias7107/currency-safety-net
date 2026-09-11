import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { EN_STRINGS } from '../../core/i18n/en';
import {
  OPTIMIZATION_RESULT,
  TEST_JOB_ID,
  errorBody,
  jobStatus,
} from '../../testing/fixtures';
import { POLL_INTERVAL_MS, ResultsPage } from './results.page';

const JOB_URL = `/api/v1/optimization-jobs/${TEST_JOB_ID}/`;

describe('ResultsPage', () => {
  let fixture: ComponentFixture<ResultsPage>;
  let http: HttpTestingController;
  let router: Router;
  let paramMap: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();

    paramMap = new BehaviorSubject(convertToParamMap({ jobId: TEST_JOB_ID }));

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: paramMap.asObservable(),
            snapshot: { paramMap: paramMap.value, params: { jobId: TEST_JOB_ID } },
          },
        },
      ],
    });

    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  function create(): void {
    fixture = TestBed.createComponent(ResultsPage);
    fixture.detectChanges();
  }

  /** Lets the polling timer fire, then renders whatever arrived. */
  async function tick(ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    fixture.detectChanges();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return (host().textContent ?? '').replace(/\s+/g, ' ');
  }

  // Scenario 9: polling until the job succeeds
  it('polls every 2 seconds until the job succeeds', async () => {
    create();

    await tick(0);
    http.expectOne(JOB_URL).flush(jobStatus('queued'));
    fixture.detectChanges();
    expect(host().querySelector('[data-testid="processing"]')).toBeTruthy();

    await tick(POLL_INTERVAL_MS);
    http.expectOne(JOB_URL).flush(jobStatus('running'));
    fixture.detectChanges();
    expect(host().querySelector('[data-testid="processing"]')).toBeTruthy();

    await tick(POLL_INTERVAL_MS);
    http.expectOne(JOB_URL).flush(jobStatus('succeeded', { result: OPTIMIZATION_RESULT }));
    fixture.detectChanges();

    expect(host().querySelector('[data-testid="result"]')).toBeTruthy();

    // No further polling once the terminal state is known.
    await tick(POLL_INTERVAL_MS * 3);
    http.expectNone(JOB_URL);
    http.verify();
  });

  it('shows an indeterminate status with no fabricated progress percentage', async () => {
    create();
    await tick(0);
    http.expectOne(JOB_URL).flush(jobStatus('running'));
    fixture.detectChanges();

    const live = host().querySelector('[data-testid="results-live"]');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(live?.textContent).toContain(EN_STRINGS.results.statusRunning);
    expect(text()).not.toMatch(/\b\d{1,3}%/);

    http.match(JOB_URL).forEach((request) => request.flush(jobStatus('running')));
  });

  // Scenario 10: polling stops when the job fails
  it('stops polling when the job fails and explains the failure', async () => {
    create();

    await tick(0);
    http
      .expectOne(JOB_URL)
      .flush(
        jobStatus('failed', {
          error_code: 'optimization_failed',
          error_message: 'The optimization could not be completed.',
        }),
      );
    fixture.detectChanges();

    expect(text()).toContain(EN_STRINGS.results.failedTitle);
    expect(host().querySelector('[data-testid="failure-message"]')?.textContent).toContain(
      'The optimization could not be completed.',
    );

    await tick(POLL_INTERVAL_MS * 3);
    http.expectNone(JOB_URL);
    http.verify();
  });

  // Scenario 11: polling stops when the component is destroyed
  it('stops polling when the component is destroyed', async () => {
    create();

    await tick(0);
    http.expectOne(JOB_URL).flush(jobStatus('running'));

    fixture.destroy();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4);
    http.expectNone(JOB_URL);
    http.verify();
  });

  // Scenario 12: a reload of /results/:jobId resumes the same scenario
  it('resumes from the route parameter after a page reload', async () => {
    create();

    await tick(0);
    const request = http.expectOne(JOB_URL);
    expect(request.request.url).toContain(TEST_JOB_ID);
    request.flush(jobStatus('succeeded', { result: OPTIMIZATION_RESULT }));
    fixture.detectChanges();

    expect(host().querySelector('[data-testid="result"]')).toBeTruthy();
    expect(text()).toContain(TEST_JOB_ID);
    http.verify();
  });

  // Scenario 8 (results side): a cached result arrives in navigation state
  it('renders a cached result from navigation state without polling', async () => {
    vi.spyOn(router, 'getCurrentNavigation').mockReturnValue({
      extras: { state: { result: OPTIMIZATION_RESULT } },
    } as unknown as ReturnType<Router['getCurrentNavigation']>);

    create();
    await tick(0);

    expect(host().querySelector('[data-testid="result"]')).toBeTruthy();
    http.expectNone(JOB_URL);
    http.verify();
  });

  // Scenario 14: unknown job id
  it('reports a 404 for an unknown scenario id and stops polling', async () => {
    create();

    await tick(0);
    http
      .expectOne(JOB_URL)
      .flush(errorBody('not_found', 'Optimization job not found.'), {
        status: 404,
        statusText: 'Not Found',
      });
    fixture.detectChanges();

    expect(text()).toContain(EN_STRINGS.errors.notFoundTitle);

    await tick(POLL_INTERVAL_MS * 3);
    http.expectNone(JOB_URL);
    http.verify();
  });

  describe('with a completed result', () => {
    beforeEach(async () => {
      create();
      await tick(0);
      http.expectOne(JOB_URL).flush(jobStatus('succeeded', { result: OPTIMIZATION_RESULT }));
      fixture.detectChanges();
    });

    afterEach(() => {
      http.verify();
    });

    // Scenario 18 (rendered side): metrics come from the payload
    it('renders every metric from the API payload', () => {
      const values = Array.from(
        host().querySelectorAll<HTMLElement>('[data-testid="metric-value"]'),
      ).map((node) => node.textContent!.replace(/\s+/g, ' ').trim());

      expect(values[0]).toContain('7.34%');
      expect(values[1]).toContain('0.86');
      expect(values[2]).toContain('0.42');
      expect(values[3]).toContain('0.05');
      expect(values[4]).toContain('1.25%');
    });

    // Scenario 19 (rendered side): the allocation legend matches the payload
    it('renders the allocation exactly as returned by the model', () => {
      const values = Array.from(
        host().querySelectorAll<HTMLElement>(
          '[data-testid="allocation-legend-value"]',
        ),
      ).map((node) => node.textContent!.trim());

      expect(values).toEqual(['62%', '27%', '11%']);
    });

    it('labels the normalization so shortfalls are read as months of income', () => {
      const note = host().querySelector('[data-testid="normalization-note"]');
      expect(note?.textContent).toContain(EN_STRINGS.results.normalizationLabel);
    });

    it('describes A_WELL_IDENTIFIED in specification-bounded language', () => {
      const identification = host().querySelector('[data-testid="identification"]');
      expect(identification?.textContent?.trim()).toBe(
        'Well identified within the evaluated model specification',
      );
    });

    it('shows the model provenance needed to reproduce the run', () => {
      const details = host().querySelector('[data-detail="simulation_paths"]');
      expect(details?.textContent).toContain('10,000');
      expect(text()).toContain('2025-12-31');
      expect(text()).toContain(EN_STRINGS.results.detailLabels.modelVersion);
    });

    it('offers only scenario actions, never a transaction', () => {
      const buttons = Array.from(
        host().querySelectorAll<HTMLElement>('button, a.button'),
      ).map((node) => node.textContent!.toLowerCase());

      expect(buttons.join(' ')).not.toContain('buy');
      expect(buttons.join(' ')).not.toContain('invest');
      expect(buttons.some((label) => label.includes('run another scenario'))).toBe(true);
    });
  });
});
