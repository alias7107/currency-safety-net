import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  CACHED_JOB,
  MODEL_METADATA,
  MODEL_OPTIONS,
  OPTIMIZATION_RESULT,
  QUEUED_JOB,
  TEST_JOB_ID,
  errorBody,
  jobStatus,
} from '../../testing/fixtures';
import type { ApiError } from './models';
import { OptimizationApiService } from './optimization-api.service';

describe('OptimizationApiService', () => {
  let service: OptimizationApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(OptimizationApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  // Scenario 1: model metadata
  it('loads model metadata from the relative metadata endpoint', () => {
    let received: unknown;
    service.getMetadata().subscribe((value) => (received = value));

    const request = http.expectOne('/api/v1/model/metadata/');
    expect(request.request.method).toBe('GET');
    request.flush(MODEL_METADATA);

    expect(received).toEqual(MODEL_METADATA);
  });

  // Scenario 2: model options
  it('loads documented model options including expense_income_ratio values', () => {
    let received: typeof MODEL_OPTIONS | undefined;
    service.getOptions().subscribe((value) => (received = value));

    const request = http.expectOne('/api/v1/model/options/');
    expect(request.request.method).toBe('GET');
    request.flush(MODEL_OPTIONS);

    expect(received?.expense_income_ratio.documented_values).toEqual([0.8, 0.95, 1.05]);
    expect(received?.profiles.map((p) => p.id)).toEqual(['P1', 'P2', 'P3', 'P4']);
  });

  it('never sends engine control fields the backend forbids', () => {
    service
      .createOptimizationJob({
        profile: 'P2',
        horizon_years: 3,
        expense_income_ratio: 0.95,
        buffer_months: 1,
        rebalance_frequency: 'monthly',
        conversion_cost: 0,
      })
      .subscribe();

    const request = http.expectOne('/api/v1/optimization-jobs/');
    const body = request.request.body as Record<string, unknown>;
    for (const forbidden of ['n_paths', 'seed', '_fx_bundle', 'model_version', 'dataset_path']) {
      expect(body[forbidden]).toBeUndefined();
    }
    expect(Object.keys(body).sort()).toEqual([
      'buffer_months',
      'conversion_cost',
      'expense_income_ratio',
      'horizon_years',
      'profile',
      'rebalance_frequency',
    ]);
    request.flush(QUEUED_JOB, { status: 202, statusText: 'Accepted' });
  });

  // Scenario 7: 202 Accepted
  it('reports the 202 status when a job is queued', () => {
    let httpStatus: number | undefined;
    let cached: boolean | undefined;

    service.createOptimizationJob(request()).subscribe((submission) => {
      httpStatus = submission.httpStatus;
      cached = submission.body.cached;
    });

    http
      .expectOne('/api/v1/optimization-jobs/')
      .flush(QUEUED_JOB, { status: 202, statusText: 'Accepted' });

    expect(httpStatus).toBe(202);
    expect(cached).toBe(false);
  });

  // Scenario 8: cached 200
  it('reports the 200 status and inline result when a job is served from cache', () => {
    let httpStatus: number | undefined;
    let result: unknown;

    service.createOptimizationJob(request()).subscribe((submission) => {
      httpStatus = submission.httpStatus;
      result = submission.body.result;
    });

    http.expectOne('/api/v1/optimization-jobs/').flush(CACHED_JOB, { status: 200, statusText: 'OK' });

    expect(httpStatus).toBe(200);
    expect(result).toEqual(OPTIMIZATION_RESULT);
  });

  it('polls a single job by id', () => {
    let received: unknown;
    service.getOptimizationJob(TEST_JOB_ID).subscribe((value) => (received = value));

    const req = http.expectOne(`/api/v1/optimization-jobs/${TEST_JOB_ID}/`);
    expect(req.request.method).toBe('GET');
    req.flush(jobStatus('running'));

    expect(received).toEqual(jobStatus('running'));
  });

  // Scenario 13: 400 validation error
  it('normalizes a 400 validation error and preserves field details', () => {
    let error: ApiError | undefined;
    service.createOptimizationJob(request()).subscribe({ error: (e: ApiError) => (error = e) });

    http.expectOne('/api/v1/optimization-jobs/').flush(
      errorBody('validation_error', 'The request could not be processed.', {
        horizon_years: ['horizon_years must be one of [1, 3, 5].'],
      }),
      { status: 400, statusText: 'Bad Request' },
    );

    expect(error?.status).toBe(400);
    expect(error?.code).toBe('validation_error');
    expect(error?.details).toEqual({
      horizon_years: ['horizon_years must be one of [1, 3, 5].'],
    });
  });

  // Scenario 14: 404 not found
  it('normalizes a 404 for an unknown job id', () => {
    let error: ApiError | undefined;
    service.getOptimizationJob('missing').subscribe({ error: (e: ApiError) => (error = e) });

    http
      .expectOne('/api/v1/optimization-jobs/missing/')
      .flush(errorBody('not_found', 'Optimization job not found.'), {
        status: 404,
        statusText: 'Not Found',
      });

    expect(error?.status).toBe(404);
    expect(error?.code).toBe('not_found');
  });

  // Scenario 15: 429 throttled
  it('normalizes a 429 throttle response', () => {
    let error: ApiError | undefined;
    service.createOptimizationJob(request()).subscribe({ error: (e: ApiError) => (error = e) });

    http
      .expectOne('/api/v1/optimization-jobs/')
      .flush(errorBody('request_error', 'The request could not be processed.', { detail: 'slow' }), {
        status: 429,
        statusText: 'Too Many Requests',
      });

    expect(error?.status).toBe(429);
  });

  // Scenario 16: 503 queue unavailable
  it('normalizes a 503 queue_unavailable response', () => {
    let error: ApiError | undefined;
    service.createOptimizationJob(request()).subscribe({ error: (e: ApiError) => (error = e) });

    http.expectOne('/api/v1/optimization-jobs/').flush(
      {
        job_id: TEST_JOB_ID,
        status: 'failed',
        cached: false,
        status_url: `/api/v1/optimization-jobs/${TEST_JOB_ID}/`,
        error: { code: 'queue_unavailable', message: 'The queue is not accepting work.' },
      },
      { status: 503, statusText: 'Service Unavailable' },
    );

    expect(error?.status).toBe(503);
    expect(error?.code).toBe('queue_unavailable');
  });

  // Scenario 17: transport failure
  it('normalizes a network failure to status 0', () => {
    let error: ApiError | undefined;
    service.getOptions().subscribe({ error: (e: ApiError) => (error = e) });

    http.expectOne('/api/v1/model/options/').error(new ProgressEvent('error'));

    expect(error?.status).toBe(0);
    expect(error?.code).toBe('network_error');
  });

  it('uses only relative /api/v1 URLs', () => {
    service.getMetadata().subscribe({ error: () => undefined });
    service.getOptions().subscribe({ error: () => undefined });
    service.getOptimizationJob(TEST_JOB_ID).subscribe({ error: () => undefined });

    for (const req of http.match(() => true)) {
      expect(req.request.url.startsWith('/api/v1/')).toBe(true);
      req.flush({});
    }
  });
});

function request() {
  return {
    profile: 'P2',
    horizon_years: 3,
    expense_income_ratio: 0.95,
    buffer_months: 1,
    rebalance_frequency: 'monthly',
    conversion_cost: 0,
  };
}
