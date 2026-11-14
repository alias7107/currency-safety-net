import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import {
  HOUSEHOLD_JOBS_URL,
  HOUSEHOLD_REQUEST,
  OTHER_HOUSEHOLD_JOB_ID,
  TEST_HOUSEHOLD_JOB_ID,
  householdAccepted,
  householdJobStatus,
  householdJobUrl,
  householdResult,
} from '../../testing/household-analysis.fixtures';
import { HouseholdAnalysisApiService, parseRetryAfter } from './household-analysis-api.service';
import type { HouseholdApiError } from './household-analysis.models';

describe('HouseholdAnalysisApiService', () => {
  let service: HouseholdAnalysisApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(HouseholdAnalysisApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function submitError(
    body: string | object,
    status: number,
    headers: Record<string, string> = {},
  ): Promise<HouseholdApiError> {
    const promise = firstValueFrom(service.submit(HOUSEHOLD_REQUEST)).then(
      () => {
        throw new Error('expected an error');
      },
      (error: HouseholdApiError) => error,
    );
    http.expectOne(HOUSEHOLD_JOBS_URL).flush(body, { status, statusText: 'x', headers });
    return promise;
  }

  it('POSTs exactly the contracted body to the relative household endpoint', async () => {
    const promise = firstValueFrom(service.submit(HOUSEHOLD_REQUEST));
    const req = http.expectOne(HOUSEHOLD_JOBS_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.url).toBe('/api/v1/household-analysis-jobs/');
    expect(req.request.body).toEqual(HOUSEHOLD_REQUEST);
    expect(req.request.params.keys()).toEqual([]);
    req.flush(householdAccepted(), { status: 202, statusText: 'Accepted' });
    const submission = await promise;
    expect(submission.httpStatus).toBe(202);
    expect(submission.body.job_id).toBe(TEST_HOUSEHOLD_JOB_ID);
  });

  it('returns a validated cached result on 200', async () => {
    const promise = firstValueFrom(service.submit(HOUSEHOLD_REQUEST));
    http
      .expectOne(HOUSEHOLD_JOBS_URL)
      .flush(householdAccepted({ status: 'succeeded', cached: true, result: householdResult() }));
    const submission = await promise;
    expect(submission.httpStatus).toBe(200);
    expect(submission.body.result?.comparison.outcome).toBe('optimized_lower');
  });

  it('rejects a malformed accepted envelope', async () => {
    const error = await submitError({ job_id: TEST_HOUSEHOLD_JOB_ID, status: 'queued' }, 202).catch(
      (e: HouseholdApiError) => e,
    );
    expect(error.code).toBe('malformed_response');
  });

  it('keeps the three 503 codes distinct and preserves the failed job id', async () => {
    const disabled = await submitError(
      { error: { code: 'submissions_disabled', message: 'Personal simulations are disabled.' } },
      503,
    );
    expect(disabled.code).toBe('submissions_disabled');
    expect(disabled.failedJobId).toBeUndefined();

    const provenance = await submitError(
      { error: { code: 'provenance_unavailable', message: 'Unavailable.' } },
      503,
    );
    expect(provenance.code).toBe('provenance_unavailable');

    const queue = await submitError(
      {
        job_id: OTHER_HOUSEHOLD_JOB_ID,
        status: 'failed',
        cached: false,
        status_url: householdJobUrl(OTHER_HOUSEHOLD_JOB_ID),
        contract_version: 'household_analysis_v1',
        error: { code: 'queue_unavailable', message: 'Queue unavailable.' },
      },
      503,
      { 'Retry-After': '30' },
    );
    expect(queue.code).toBe('queue_unavailable');
    expect(queue.failedJobId).toBe(OTHER_HOUSEHOLD_JOB_ID);
    expect(queue.retryAfterSeconds).toBe(30);

    const proxy = await submitError('<html>502</html>', 503);
    expect(proxy.code).toBe('service_unavailable');
    expect(proxy.message).not.toContain('<html>');
  });

  it('parses 422 reasons and 429 Retry-After', async () => {
    const unsupported = await submitError(
      {
        error: {
          code: 'unsupported_scenario',
          message: 'Outside the supported range.',
          reasons: [
            {
              code: 'buffer_months_out_of_supported_range',
              field: 'buffer_months',
              supported: { min: 1, max: 12 },
            },
          ],
        },
      },
      422,
    );
    expect(unsupported.code).toBe('unsupported_scenario');
    expect(unsupported.reasons?.[0]?.field).toBe('buffer_months');

    const limited = await submitError({ detail: 'Request was throttled.' }, 429, {
      'Retry-After': '120',
    });
    expect(limited.status).toBe(429);
    expect(limited.retryAfterSeconds).toBe(120);
  });

  it('normalizes network and 400 errors without raw exception text', async () => {
    const promise = firstValueFrom(service.submit(HOUSEHOLD_REQUEST)).catch(
      (e: HouseholdApiError) => e,
    );
    http.expectOne(HOUSEHOLD_JOBS_URL).error(new ProgressEvent('error'));
    const network = (await promise) as HouseholdApiError;
    expect(network.status).toBe(0);
    expect(network.message).not.toMatch(/http failure/i);

    const invalid = await submitError(
      {
        error: {
          code: 'validation_error',
          message: 'The request could not be processed.',
          details: {},
        },
      },
      400,
    );
    expect(invalid.code).toBe('validation_error');
  });

  it('GETs a job by id and validates its association', async () => {
    const ok = firstValueFrom(service.getJob(TEST_HOUSEHOLD_JOB_ID));
    const req = http.expectOne(householdJobUrl());
    expect(req.request.method).toBe('GET');
    req.flush(householdJobStatus('running'));
    expect((await ok).status).toBe('running');

    const mismatch = firstValueFrom(service.getJob(TEST_HOUSEHOLD_JOB_ID)).catch(
      (e: HouseholdApiError) => e,
    );
    http
      .expectOne(householdJobUrl())
      .flush(householdJobStatus('running', {}, OTHER_HOUSEHOLD_JOB_ID));
    expect(((await mismatch) as HouseholdApiError).code).toBe('malformed_response');

    const missing = firstValueFrom(service.getJob(TEST_HOUSEHOLD_JOB_ID)).catch(
      (e: HouseholdApiError) => e,
    );
    http
      .expectOne(householdJobUrl())
      .flush(
        { error: { code: 'not_found', message: 'Household analysis job not found.' } },
        { status: 404, statusText: 'Not Found' },
      );
    expect(((await missing) as HouseholdApiError).status).toBe(404);
  });

  it('parses Retry-After seconds and HTTP dates, ignoring invalid values', () => {
    const now = Date.parse('2026-11-11T10:00:00Z');
    expect(parseRetryAfter('15', now)).toBe(15);
    expect(parseRetryAfter('Wed, 11 Nov 2026 10:01:00 GMT', now)).toBe(60);
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter('-5', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter('999999', now)).toBeUndefined();
  });
});
