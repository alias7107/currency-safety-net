import { Injectable } from '@angular/core';

import { isValidOriginJobId } from '../api/buffer-sensitivity.validation';
import type {
  HouseholdAnalysisRequest,
  HouseholdAnalysisResult,
} from './household-analysis.models';

export interface HouseholdJobEntry {
  /** Normalized request submitted from this tab; null when only the job id is known. */
  request: HouseholdAnalysisRequest | null;
  /** Validated result, when already available (for example a cached 200). */
  result: HouseholdAnalysisResult | null;
}


@Injectable({ providedIn: 'root' })
export class HouseholdAnalysisStore {
  private readonly entries = new Map<string, HouseholdJobEntry>();

  remember(
    jobId: string,
    request: HouseholdAnalysisRequest | null,
    result: HouseholdAnalysisResult | null = null,
  ): void {
    if (!isValidOriginJobId(jobId)) {
      return;
    }
    this.entries.set(jobId.toLowerCase(), { request, result });
  }

  recordResult(jobId: string, result: HouseholdAnalysisResult): void {
    const key = jobId.toLowerCase();
    const entry = this.entries.get(key);
    this.entries.set(key, { request: entry?.request ?? null, result });
  }

  get(jobId: string): HouseholdJobEntry | null {
    return this.entries.get(jobId.toLowerCase()) ?? null;
  }

  clear(): void {
    this.entries.clear();
  }
}
