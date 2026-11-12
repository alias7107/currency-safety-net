import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';

import { API_BASE_URL, normalizeApiError } from '../api/optimization-api.service';
import { isValidOriginJobId } from '../api/buffer-sensitivity.validation';
import type {
  HouseholdAnalysisRequest,
  HouseholdApiError,
  HouseholdJobStatus,
  HouseholdJobSubmission,
} from './household-analysis.models';
import {
  householdMalformedError,
  parseUnsupportedReasons,
  validateHouseholdJobAccepted,
  validateHouseholdJobStatus,
} from './household-analysis.validation';

const HOUSEHOLD_JOBS_URL = `${API_BASE_URL}/household-analysis-jobs/`;
const RETRY_AFTER_MAX_SECONDS = 24 * 60 * 60;
const STRUCTURED_503_CODES = [
  'submissions_disabled',
  'provenance_unavailable',
  'queue_unavailable',
];

/**
 * Personal household-analysis API. Separate from the research endpoints:
 * shares are never mapped to P1–P4 profiles.
 */
@Injectable({ providedIn: 'root' })
export class HouseholdAnalysisApiService {
  private readonly http = inject(HttpClient);

  submit(request: HouseholdAnalysisRequest): Observable<HouseholdJobSubmission> {
    return this.http.post<unknown>(HOUSEHOLD_JOBS_URL, request, { observe: 'response' }).pipe(
      map((response) => {
        const checked = validateHouseholdJobAccepted(response.status, response.body);
        if (!checked.ok) {
          throw checked.error;
        }
        return { httpStatus: response.status, body: checked.value };
      }),
      catchError((error: unknown) => throwError(() => toHouseholdApiError(error))),
    );
  }

  getJob(jobId: string): Observable<HouseholdJobStatus> {
    return this.http.get<unknown>(`${HOUSEHOLD_JOBS_URL}${encodeURIComponent(jobId)}/`).pipe(
      map((body) => {
        const checked = validateHouseholdJobStatus(body, jobId);
        if (!checked.ok) {
          throw checked.error;
        }
        return checked.value;
      }),
      catchError((error: unknown) => throwError(() => toHouseholdApiError(error))),
    );
  }
}

/** Seconds from a Retry-After header (delta-seconds or HTTP-date). */
export function parseRetryAfter(
  value: string | null,
  now: number = Date.now(),
): number | undefined {
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return seconds <= RETRY_AFTER_MAX_SECONDS ? seconds : undefined;
  }
  // HTTP-date only (for example "Wed, 21 Oct 2026 07:28:00 GMT"); bare numbers are not dates.
  if (!/^[A-Za-z]{3}, /.test(trimmed)) {
    return undefined;
  }
  const date = Date.parse(trimmed);
  if (!Number.isFinite(date)) {
    return undefined;
  }
  const seconds = Math.max(0, Math.ceil((date - now) / 1000));
  return seconds <= RETRY_AFTER_MAX_SECONDS ? seconds : undefined;
}

function isApiErrorLike(value: unknown): value is HouseholdApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { status?: unknown }).status === 'number'
  );
}

function structuredCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return undefined;
  }
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null || Array.isArray(error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export function toHouseholdApiError(error: unknown): HouseholdApiError {
  if (!(error instanceof HttpErrorResponse)) {
    return isApiErrorLike(error) ? error : householdMalformedError();
  }
  const normalized: HouseholdApiError = normalizeApiError(error);
  const code = structuredCode(error.error);
  if (error.status === 503 && (code === undefined || !STRUCTURED_503_CODES.includes(code))) {
    // An unstructured 503 (for example from a proxy) is not a known backend state.
    normalized.code = 'service_unavailable';
  }
  if (error.status === 503 && code === 'queue_unavailable') {
    const body = error.error as { job_id?: unknown };
    if (typeof body.job_id === 'string' && isValidOriginJobId(body.job_id)) {
      normalized.failedJobId = body.job_id;
    }
  }
  if (error.status === 422 && code === 'unsupported_scenario') {
    const reasons = parseUnsupportedReasons(
      (error.error as { error: { reasons?: unknown } }).error.reasons,
    );
    if (reasons) {
      normalized.reasons = reasons;
    }
  }
  if (error.status === 429 || error.status === 503) {
    const retryAfter = parseRetryAfter(error.headers?.get('Retry-After') ?? null);
    if (retryAfter !== undefined) {
      normalized.retryAfterSeconds = retryAfter;
    }
  }
  return normalized;
}
