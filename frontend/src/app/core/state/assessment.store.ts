import { Injectable, signal } from '@angular/core';

import { restoreAssessmentDraft } from '../assessment/assessment-normalization';
import {
  ASSESSMENT_OVERVIEW_STEP,
  type AssessmentDraft,
  emptyAssessmentDraft,
} from '../assessment/assessment.model';

/** Versioned sessionStorage key for the Phase 5A household assessment draft. */
export const ASSESSMENT_DRAFT_STORAGE_KEY = 'csn.assessment-draft.v1';

/**
 * Holds the raw household assessment answers for the current browser tab.
 * Only sessionStorage is used, so the draft disappears when the tab closes.
 * Totals and shares are never persisted; they are recomputed from raw entries.
 */
@Injectable({ providedIn: 'root' })
export class AssessmentStore {
  private readonly draftState = signal<AssessmentDraft>(this.readDraft());

  readonly draft = this.draftState.asReadonly();

  patch(partial: Partial<Omit<AssessmentDraft, 'version'>>): void {
    this.commit({ ...this.draftState(), ...partial, version: 1 });
  }

  setStep(step: number): void {
    const clamped = Math.min(Math.max(Math.trunc(step), 0), ASSESSMENT_OVERVIEW_STEP);
    this.patch({ step: clamped });
  }

  clear(): void {
    this.draftState.set(emptyAssessmentDraft());
    try {
      this.storage()?.removeItem(ASSESSMENT_DRAFT_STORAGE_KEY);
    } catch {
      // Storage unavailable: the in-memory draft is already cleared.
    }
  }

  private commit(next: AssessmentDraft): void {
    this.draftState.set(next);
    try {
      this.storage()?.setItem(ASSESSMENT_DRAFT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage disabled or full: the in-memory signal remains authoritative.
    }
  }

  private readDraft(): AssessmentDraft {
    let raw: string | null = null;
    try {
      raw = this.storage()?.getItem(ASSESSMENT_DRAFT_STORAGE_KEY) ?? null;
    } catch {
      return emptyAssessmentDraft();
    }
    if (!raw) {
      return emptyAssessmentDraft();
    }
    try {
      return restoreAssessmentDraft(JSON.parse(raw));
    } catch {
      return emptyAssessmentDraft();
    }
  }

  private storage(): Storage | null {
    try {
      return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    } catch {
      return null;
    }
  }
}
