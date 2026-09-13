import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  BUFFER_SENSITIVITY_RESULT,
  CACHED_BATCH_JOB,
  QUEUED_BATCH_JOB,
  TEST_BATCH_JOB_ID,
  batchJobStatus,
} from '../../testing/buffer-sensitivity.fixtures';
import { errorBody } from '../../testing/fixtures';
import {
  BUFFER_SENSITIVITY_CONTRACT_VERSION,
  validateBufferSensitivityJobAccepted,
  validateBufferSensitivityJobStatus,
  validateBufferSensitivityResult,
} from './buffer-sensitivity.validation';
import type { ApiError, BufferSensitivityRequest } from './models';
import { OptimizationApiService } from './optimization-api.service';

describe('OptimizationApiService buffer sensitivity', () => {
  let service: OptimizationApiService;
  let http: HttpTestingController;

  const request = (): BufferSensitivityRequest => ({
    profile: 'P2',
    horizon_years: 3,
    expense_income_ratio: 0.95,
    rebalance_frequency: 'monthly',
    conversion_cost: 0,
  });

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

  it('POSTs only scenario fields and excludes buffer/target controls', () => {
    service.createBufferSensitivityJob(request()).subscribe();

    const req = http.expectOne('/api/v1/buffer-sensitivity-jobs/');
    expect(req.request.method).toBe('POST');
    const body = req.request.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'conversion_cost',
      'expense_income_ratio',
      'horizon_years',
      'profile',
      'rebalance_frequency',
    ]);
    for (const forbidden of [
      'buffer_months',
      'tested_buffers',
      'target',
      'n_paths',
      'seed',
      '_fx_bundle',
      'weights',
    ]) {
      expect(body[forbidden]).toBeUndefined();
    }
    req.flush(QUEUED_BATCH_JOB, { status: 202, statusText: 'Accepted' });
  });

  it('reports 202 queued submissions', () => {
    let httpStatus: number | undefined;
    service.createBufferSensitivityJob(request()).subscribe((submission) => {
      httpStatus = submission.httpStatus;
    });
    http
      .expectOne('/api/v1/buffer-sensitivity-jobs/')
      .flush(QUEUED_BATCH_JOB, { status: 202, statusText: 'Accepted' });
    expect(httpStatus).toBe(202);
  });

  it('reports 200 cached success with validated result', () => {
    let httpStatus: number | undefined;
    let result: unknown;
    service.createBufferSensitivityJob(request()).subscribe((submission) => {
      httpStatus = submission.httpStatus;
      result = submission.body.result;
    });
    http
      .expectOne('/api/v1/buffer-sensitivity-jobs/')
      .flush(CACHED_BATCH_JOB, { status: 200, statusText: 'OK' });
    expect(httpStatus).toBe(200);
    expect(result).toEqual(BUFFER_SENSITIVITY_RESULT);
  });

  it('GETs a batch job by id', () => {
    let received: unknown;
    service.getBufferSensitivityJob(TEST_BATCH_JOB_ID).subscribe((value) => (received = value));
    const req = http.expectOne(`/api/v1/buffer-sensitivity-jobs/${TEST_BATCH_JOB_ID}/`);
    expect(req.request.method).toBe('GET');
    req.flush(batchJobStatus('running'));
    expect(received).toEqual(batchJobStatus('running'));
  });

  it('rejects malformed succeeded payloads', () => {
    let error: ApiError | undefined;
    service.getBufferSensitivityJob(TEST_BATCH_JOB_ID).subscribe({
      error: (err: ApiError) => (error = err),
    });
    http.expectOne(`/api/v1/buffer-sensitivity-jobs/${TEST_BATCH_JOB_ID}/`).flush(
      batchJobStatus('succeeded', {
        result: {
          ...BUFFER_SENSITIVITY_RESULT,
          contract_version: 'wrong',
        } as typeof BUFFER_SENSITIVITY_RESULT,
      }),
    );
    expect(error?.code).toBe('malformed_response');
  });

  it('normalizes 400, 404, 429, and both 503 cases', () => {
    const cases: Array<{
      call: () => void;
      url: string;
      status: number;
      body: unknown;
      code: string;
    }> = [
      {
        call: () =>
          service.createBufferSensitivityJob(request()).subscribe({ error: () => undefined }),
        url: '/api/v1/buffer-sensitivity-jobs/',
        status: 400,
        body: errorBody('validation_error', 'Rejected.'),
        code: 'validation_error',
      },
      {
        call: () =>
          service.getBufferSensitivityJob('missing').subscribe({ error: () => undefined }),
        url: '/api/v1/buffer-sensitivity-jobs/missing/',
        status: 404,
        body: errorBody('not_found', 'Missing.'),
        code: 'not_found',
      },
      {
        call: () =>
          service.createBufferSensitivityJob(request()).subscribe({ error: () => undefined }),
        url: '/api/v1/buffer-sensitivity-jobs/',
        status: 429,
        body: errorBody('request_error', 'Slow down.'),
        code: 'request_error',
      },
      {
        call: () =>
          service.createBufferSensitivityJob(request()).subscribe({ error: () => undefined }),
        url: '/api/v1/buffer-sensitivity-jobs/',
        status: 503,
        body: errorBody('queue_unavailable', 'Queue down.'),
        code: 'queue_unavailable',
      },
      {
        call: () =>
          service.createBufferSensitivityJob(request()).subscribe({ error: () => undefined }),
        url: '/api/v1/buffer-sensitivity-jobs/',
        status: 503,
        body: errorBody('submissions_disabled', 'Disabled.'),
        code: 'submissions_disabled',
      },
    ];

    for (const item of cases) {
      let error: ApiError | undefined;
      if (item.url.includes('missing')) {
        service
          .getBufferSensitivityJob('missing')
          .subscribe({ error: (e: ApiError) => (error = e) });
      } else {
        service.createBufferSensitivityJob(request()).subscribe({
          error: (e: ApiError) => (error = e),
        });
      }
      http.expectOne(item.url).flush(item.body as object, {
        status: item.status,
        statusText: 'Error',
      });
      expect(error?.status).toBe(item.status);
      expect(error?.code).toBe(item.code);
    }
  });

  it('normalizes network and HTML failures without leaking transport text', () => {
    let networkError: ApiError | undefined;
    service.createBufferSensitivityJob(request()).subscribe({
      error: (e: ApiError) => (networkError = e),
    });
    http.expectOne('/api/v1/buffer-sensitivity-jobs/').error(new ProgressEvent('error'));
    expect(networkError?.status).toBe(0);
    expect(networkError?.message.toLowerCase()).not.toContain('http failure');

    let htmlError: ApiError | undefined;
    service.createBufferSensitivityJob(request()).subscribe({
      error: (e: ApiError) => (htmlError = e),
    });
    http.expectOne('/api/v1/buffer-sensitivity-jobs/').flush('<html>boom</html>', {
      status: 502,
      statusText: 'Bad Gateway',
    });
    expect(htmlError?.message.toLowerCase()).not.toContain('<html');
  });
});

describe('validateBufferSensitivityResult', () => {
  it('accepts the complete noncanonical fixture', () => {
    const validated = validateBufferSensitivityResult(BUFFER_SENSITIVITY_RESULT);
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(validated.result.contract_version).toBe(BUFFER_SENSITIVITY_CONTRACT_VERSION);
    }
  });

  it('rejects swapped, duplicate, missing, and extra rows', () => {
    const swapped = {
      ...BUFFER_SENSITIVITY_RESULT,
      results: [
        BUFFER_SENSITIVITY_RESULT.results[1],
        BUFFER_SENSITIVITY_RESULT.results[0],
        BUFFER_SENSITIVITY_RESULT.results[2],
        BUFFER_SENSITIVITY_RESULT.results[3],
      ],
    };
    expect(validateBufferSensitivityResult(swapped).ok).toBe(false);

    const duplicate = {
      ...BUFFER_SENSITIVITY_RESULT,
      tested_buffers: [1, 1, 6, 12],
      results: [
        BUFFER_SENSITIVITY_RESULT.results[0],
        { ...BUFFER_SENSITIVITY_RESULT.results[0], buffer_months: 1 },
        BUFFER_SENSITIVITY_RESULT.results[2],
        BUFFER_SENSITIVITY_RESULT.results[3],
      ],
    };
    expect(validateBufferSensitivityResult(duplicate).ok).toBe(false);

    const missing = {
      ...BUFFER_SENSITIVITY_RESULT,
      results: BUFFER_SENSITIVITY_RESULT.results.slice(0, 3),
    };
    expect(validateBufferSensitivityResult(missing).ok).toBe(false);

    const extra = {
      ...BUFFER_SENSITIVITY_RESULT,
      results: [...BUFFER_SENSITIVITY_RESULT.results, BUFFER_SENSITIVITY_RESULT.results[0]],
    };
    expect(validateBufferSensitivityResult(extra).ok).toBe(false);
  });

  it('rejects invalid weights and numeric ranges', () => {
    const badWeights = {
      ...BUFFER_SENSITIVITY_RESULT,
      results: BUFFER_SENSITIVITY_RESULT.results.map((row, index) =>
        index === 0 ? { ...row, weights: [0.5, 0.5, 0.5] } : row,
      ),
    };
    expect(validateBufferSensitivityResult(badWeights).ok).toBe(false);

    const badProbability = {
      ...BUFFER_SENSITIVITY_RESULT,
      results: BUFFER_SENSITIVITY_RESULT.results.map((row, index) =>
        index === 0 ? { ...row, shortfall_probability: 1.5 } : row,
      ),
    };
    expect(validateBufferSensitivityResult(badProbability).ok).toBe(false);
  });

  it('rejects newly enforced Phase 3C contract invariants', () => {
    expect(
      validateBufferSensitivityResult({
        ...BUFFER_SENSITIVITY_RESULT,
        tested_buffers: [1, 2, 3, 4],
      }).ok,
    ).toBe(false);

    expect(
      validateBufferSensitivityResult({
        ...BUFFER_SENSITIVITY_RESULT,
        units: { cumulative_shortfall: 'wrong_units' },
      }).ok,
    ).toBe(false);

    expect(
      validateBufferSensitivityResult({
        ...BUFFER_SENSITIVITY_RESULT,
        provenance: {
          ...BUFFER_SENSITIVITY_RESULT.provenance,
          dataset_sha256: 'not-64-hex',
        },
      }).ok,
    ).toBe(false);

    expect(
      validateBufferSensitivityResult({
        ...BUFFER_SENSITIVITY_RESULT,
        provenance: {
          ...BUFFER_SENSITIVITY_RESULT.provenance,
          simulation_paths: 999,
        },
      }).ok,
    ).toBe(false);

    expect(
      validateBufferSensitivityResult({
        ...BUFFER_SENSITIVITY_RESULT,
        provenance: {
          ...BUFFER_SENSITIVITY_RESULT.provenance,
          simulation_seed: 7,
        },
      }).ok,
    ).toBe(false);

    expect(
      validateBufferSensitivityResult({
        ...BUFFER_SENSITIVITY_RESULT,
        provenance: {
          ...BUFFER_SENSITIVITY_RESULT.provenance,
          fx_path_policy: 'other',
        },
      }).ok,
    ).toBe(false);

    expect(
      validateBufferSensitivityResult({
        ...BUFFER_SENSITIVITY_RESULT,
        results: BUFFER_SENSITIVITY_RESULT.results.map((row, index) =>
          index === 0 ? { ...row, identification_class: 'Z_UNKNOWN' } : row,
        ),
      }).ok,
    ).toBe(false);

    expect(
      validateBufferSensitivityResult({
        ...BUFFER_SENSITIVITY_RESULT,
        results: BUFFER_SENSITIVITY_RESULT.results.map((row, index) =>
          index === 0 ? { ...row, near_optimal_1pct_count: 9999, n_surface: 10 } : row,
        ),
      }).ok,
    ).toBe(false);

    expect(
      validateBufferSensitivityResult({
        ...BUFFER_SENSITIVITY_RESULT,
        results: BUFFER_SENSITIVITY_RESULT.results.map((row, index) =>
          index === 0
            ? {
                ...row,
                implementation_only: {
                  ...row.implementation_only,
                  mean_terminal_wealth: -1,
                },
              }
            : row,
        ),
      }).ok,
    ).toBe(false);
  });

  it('rejects malformed job envelopes', () => {
    expect(validateBufferSensitivityJobAccepted({ status: 'queued' }).ok).toBe(false);
    expect(
      validateBufferSensitivityJobAccepted({
        ...QUEUED_BATCH_JOB,
        status: 'weird',
      }).ok,
    ).toBe(false);
    expect(
      validateBufferSensitivityJobStatus({
        job_id: TEST_BATCH_JOB_ID,
        status: 'succeeded',
        created_at: '2026-09-12T12:00:00Z',
        started_at: null,
        contract_version: BUFFER_SENSITIVITY_CONTRACT_VERSION,
        tested_buffers: [1, 3, 6, 12],
      }).ok,
    ).toBe(false);
  });
});
