import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';

import type {
  ApiError,
  ModelMetadata,
  ModelOptions,
  OptimizationJobAccepted,
  OptimizationJobStatus,
  OptimizationRequest,
} from './models';

/** Relative base path; the dev server proxies `/api` to the Django backend. */
export const API_BASE_URL = '/api/v1';

/**
 * Result of submitting a scenario. `httpStatus` is 202 when the job was queued
 * and 200 when an identical scenario had already been computed and is returned
 * from the server-side cache.
 */
export interface OptimizationJobSubmission {
  httpStatus: number;
  body: OptimizationJobAccepted;
}

@Injectable({ providedIn: 'root' })
export class OptimizationApiService {
  private readonly http = inject(HttpClient);

  getMetadata(): Observable<ModelMetadata> {
    return this.http
      .get<ModelMetadata>(`${API_BASE_URL}/model/metadata/`)
      .pipe(catchError(toApiError));
  }

  getOptions(): Observable<ModelOptions> {
    return this.http
      .get<ModelOptions>(`${API_BASE_URL}/model/options/`)
      .pipe(catchError(toApiError));
  }

  createOptimizationJob(request: OptimizationRequest): Observable<OptimizationJobSubmission> {
    return this.http
      .post<OptimizationJobAccepted>(`${API_BASE_URL}/optimization-jobs/`, request, {
        observe: 'response',
      })
      .pipe(
        map((response) => ({
          httpStatus: response.status,
          body: response.body as OptimizationJobAccepted,
        })),
        catchError(toApiError),
      );
  }

  getOptimizationJob(jobId: string): Observable<OptimizationJobStatus> {
    return this.http
      .get<OptimizationJobStatus>(
        `${API_BASE_URL}/optimization-jobs/${encodeURIComponent(jobId)}/`,
      )
      .pipe(catchError(toApiError));
  }
}

const CODE_BY_STATUS: Record<number, string> = {
  0: 'network_error',
  400: 'validation_error',
  404: 'not_found',
  429: 'rate_limited',
  500: 'internal_error',
  503: 'queue_unavailable',
};

/** Collapse every failure mode into one predictable shape for the UI. */
export function normalizeApiError(error: HttpErrorResponse): ApiError {
  const status = error.status ?? 0;
  const body = error.error;
  const serverError = extractStructuredServerError(body);
  const safeMessage = sanitizeUserFacingMessage(serverError?.message);

  return {
    status,
    code: serverError?.code ?? CODE_BY_STATUS[status] ?? 'request_failed',
    // Never fall back to HttpErrorResponse.message — it embeds URLs and status text.
    message: safeMessage ?? 'The request could not be completed.',
    details: serverError?.details,
  };
}

function extractStructuredServerError(
  body: unknown,
): { code?: string; message?: string; details?: unknown } | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return undefined;
  }
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    return undefined;
  }
  const record = error as { code?: unknown; message?: unknown; details?: unknown };
  return {
    code: typeof record.code === 'string' ? record.code : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
    details: record.details,
  };
}

/** Drop transport/HTML/stack noise; keep deliberate backend copy. */
export function sanitizeUserFacingMessage(message: string | undefined | null): string | null {
  if (!message) {
    return null;
  }
  const trimmed = message.trim();
  if (!trimmed) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  if (lower.includes('http failure response')) {
    return null;
  }
  if (lower.includes('/api/')) {
    return null;
  }
  if (/https?:\/\//i.test(trimmed)) {
    return null;
  }
  if (/\blocalhost\b|\b127\.0\.0\.1\b/i.test(trimmed)) {
    return null;
  }
  if (/\b\d{3}\s+(bad gateway|service unavailable|gateway timeout)\b/i.test(trimmed)) {
    return null;
  }
  if (lower.includes('traceback') || /<\/?[a-z][\s\S]*>/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function toApiError(error: HttpErrorResponse): Observable<never> {
  return throwError(() => normalizeApiError(error));
}
