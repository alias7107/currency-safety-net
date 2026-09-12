import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { EN_STRINGS } from '../../core/i18n/en';
import { OPTIMIZATION_RESULT, TEST_JOB_ID, errorBody, jobStatus } from '../../testing/fixtures';
import { ReportPage } from './report.page';

const JOB_URL = `/api/v1/optimization-jobs/${TEST_JOB_ID}/`;

describe('ReportPage', () => {
  let fixture: ComponentFixture<ReportPage>;
  let http: HttpTestingController;
  let router: Router;
  let paramMap: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  beforeEach(() => {
    sessionStorage.clear();
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
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  function create(): void {
    fixture = TestBed.createComponent(ReportPage);
    fixture.detectChanges();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return (host().textContent ?? '').replace(/\s+/g, ' ');
  }

  it('renders from navigation state without an unnecessary GET', () => {
    vi.spyOn(router, 'getCurrentNavigation').mockReturnValue({
      extras: { state: { result: OPTIMIZATION_RESULT } },
    } as unknown as ReturnType<Router['getCurrentNavigation']>);

    create();
    expect(host().querySelector('[data-testid="report-document"]')).toBeTruthy();
    http.expectNone(JOB_URL);
    http.verify();
  });

  it('retrieves the job once on a direct visit', () => {
    create();
    expect(host().querySelector('[data-testid="report-loading"]')).toBeTruthy();
    http.expectOne(JOB_URL).flush(jobStatus('succeeded', { result: OPTIMIZATION_RESULT }));
    fixture.detectChanges();
    expect(host().querySelector('[data-testid="report-document"]')).toBeTruthy();
    http.expectNone(JOB_URL);
    http.verify();
  });

  it('links queued jobs back to results without polling', () => {
    create();
    http.expectOne(JOB_URL).flush(jobStatus('queued'));
    fixture.detectChanges();
    expect(host().querySelector('[data-testid="report-not-ready"]')).toBeTruthy();
    const link = host().querySelector<HTMLAnchorElement>('[data-testid="report-open-results"]');
    expect(link?.getAttribute('href')).toContain(`/results/${TEST_JOB_ID}`);
    http.expectNone(JOB_URL);
    http.verify();
  });

  it('shows a safe failed state without backend internals', () => {
    create();
    http.expectOne(JOB_URL).flush(
      jobStatus('failed', {
        error_code: 'optimization_failed',
        error_message: 'The optimization could not be completed.',
      }),
    );
    fixture.detectChanges();
    expect(host().querySelector('[data-testid="report-failed"]')).toBeTruthy();
    expect(text()).toContain(EN_STRINGS.report.failedTitle);
    expect(text()).not.toContain('Traceback');
    expect(text()).not.toContain('/api/v1');
    http.verify();
  });

  it('sanitizes unsafe failed-job messages before rendering', () => {
    create();
    http.expectOne(JOB_URL).flush(
      jobStatus('failed', {
        error_code: 'optimization_failed',
        error_message:
          'Traceback (most recent call last):\nFailed at /api/v1/optimization-jobs/\nSee https://example.com/docs\n<html>boom</html>\n502 Bad Gateway',
      }),
    );
    fixture.detectChanges();

    expect(text()).toContain(EN_STRINGS.report.failedTitle);
    expect(text()).toContain(EN_STRINGS.report.failedBody);
    expect(host().querySelector('[data-testid="report-failure-message"]')?.textContent).toContain(
      EN_STRINGS.errors.serverBody,
    );
    expect(text()).not.toContain('Traceback');
    expect(text()).not.toContain('/api/v1');
    expect(text()).not.toContain('https://example.com');
    expect(text()).not.toContain('<html>');
    expect(text()).not.toContain('Bad Gateway');
    expect(text()).not.toContain('optimization_failed');
    http.verify();
  });

  it('renders one consolidated methodology list without duplicated limitations', () => {
    vi.spyOn(router, 'getCurrentNavigation').mockReturnValue({
      extras: { state: { result: OPTIMIZATION_RESULT } },
    } as unknown as ReturnType<Router['getCurrentNavigation']>);
    create();

    const items = host().querySelectorAll('[data-testid="report-methodology-list"] li');
    expect(items.length).toBe(EN_STRINGS.report.methodologyPoints.length);
    expect(items.length).toBe(5);
    const copy = text().toLowerCase();
    expect(copy).toContain('simulation-based');
    expect(copy).toContain('historical fx');
    expect(copy).toContain('does not forecast exchange rates');
    expect(copy).toContain('can differ from the simulated paths');
    expect(copy).toContain('not individualized financial advice');
  });

  it('normalizes API errors without exposing transport details', () => {
    create();
    http.expectOne(JOB_URL).flush('<html>gateway error</html>', {
      status: 502,
      statusText: 'Bad Gateway',
    });
    fixture.detectChanges();
    expect(host().querySelector('[data-testid="report-error"]')).toBeTruthy();
    expect(text()).not.toContain('<html>');
    expect(text()).not.toContain('gateway error');
    http.verify();
  });

  it('renders arbitrary non-canonical values and scientific copy', () => {
    create();
    http.expectOne(JOB_URL).flush(
      jobStatus('succeeded', {
        result: {
          ...OPTIMIZATION_RESULT,
          profile: 'P3_mixed_income',
          weights: [0.5, 0.5, 0],
          var95_cumulative_shortfall: 0,
          cvar95_cumulative_shortfall: 2.11,
          model_version: 'report-fixture-7',
          data_as_of: '2016-04-02',
          simulation_paths: 4321,
          simulation_seed: 77,
          n_coarse: 11,
          n_refined: 22,
          n_surface: undefined,
        },
      }),
    );
    fixture.detectChanges();

    expect(text()).toContain(EN_STRINGS.profiles.P3.title);
    expect(text()).not.toContain('P3_mixed_income');
    expect(text()).toContain('share the largest returned weight');
    expect(text()).toContain(EN_STRINGS.results.phase2b.objectiveHeading);
    expect(text()).toContain(EN_STRINGS.results.phase2b.diagnosticsBody);
    expect(text()).toContain('2.11');
    expect(text()).toContain('report-fixture-7');
    expect(text()).toContain('2016-04-02');
    expect(text()).toContain('4,321');
    expect(text()).toContain('77');
    expect(host().querySelector('[data-report-detail="n_coarse"]')?.textContent).toContain('11');
    expect(host().querySelector('[data-report-detail="n_refined"]')?.textContent).toContain('22');
    expect(host().querySelector('[data-report-detail="n_surface"]')).toBeNull();
    expect(host().querySelector('[data-testid="metric-explanation-note"]')?.textContent).toContain(
      EN_STRINGS.results.phase2b.diagnostics.var95.zeroNote,
    );
    expect(text()).toContain(EN_STRINGS.results.phase2b.diagnostics.depletion.definition);
    expect(text().toLowerCase()).not.toContain('before the horizon ended');
    expect(host().querySelectorAll('[data-testid="metric-explanation-expanded"]').length).toBe(4);
    expect(text().toLowerCase()).not.toContain('resilience score');
    http.verify();
  });

  it('invokes the native print function from the print control', () => {
    vi.spyOn(router, 'getCurrentNavigation').mockReturnValue({
      extras: { state: { result: OPTIMIZATION_RESULT } },
    } as unknown as ReturnType<Router['getCurrentNavigation']>);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);

    create();
    host().querySelector<HTMLButtonElement>('[data-testid="report-print"]')!.click();
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('does not expose unknown raw identification class identifiers', () => {
    create();
    http.expectOne(JOB_URL).flush(
      jobStatus('succeeded', {
        result: {
          ...OPTIMIZATION_RESULT,
          identification_class: 'Z_INTERNAL_UNKNOWN_CLASS',
        },
      }),
    );
    fixture.detectChanges();
    expect(text()).not.toContain('Z_INTERNAL_UNKNOWN_CLASS');
    expect(host().querySelector('[data-testid="report-identification"]')?.textContent).toContain(
      EN_STRINGS.common.notAvailable,
    );
    http.verify();
  });
});
