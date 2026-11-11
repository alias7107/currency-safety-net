import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { emptyAssessmentDraft } from '../assessment/assessment.model';
import { ASSESSMENT_DRAFT_STORAGE_KEY, AssessmentStore } from './assessment.store';

describe('AssessmentStore', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  function createStore(): AssessmentStore {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    return TestBed.inject(AssessmentStore);
  }

  it('starts empty and persists raw answers to the versioned sessionStorage key', () => {
    const store = createStore();
    expect(store.draft()).toEqual(emptyAssessmentDraft());

    store.patch({ incomeCurrencies: ['USD'], income: { USD: '1200' } });

    const saved = JSON.parse(sessionStorage.getItem(ASSESSMENT_DRAFT_STORAGE_KEY)!);
    expect(saved.income).toEqual({ USD: '1200' });
    expect(saved.version).toBe(1);
    expect(Object.keys(saved)).not.toContain('totalKzt');
    expect(localStorage.length).toBe(0);
  });

  it('restores a draft after reload', () => {
    createStore().patch({ incomeCurrencies: ['KZT'], income: { KZT: '400000' }, step: 1 });
    const restored = createStore();
    expect(restored.draft().income).toEqual({ KZT: '400000' });
    expect(restored.draft().step).toBe(1);
  });

  it('falls back to an empty draft for corrupted storage', () => {
    sessionStorage.setItem(ASSESSMENT_DRAFT_STORAGE_KEY, '{not-json');
    expect(createStore().draft()).toEqual(emptyAssessmentDraft());

    sessionStorage.setItem(
      ASSESSMENT_DRAFT_STORAGE_KEY,
      JSON.stringify({ version: 1, incomeCurrencies: 'USD', income: 5 }),
    );
    expect(createStore().draft()).toEqual(emptyAssessmentDraft());
  });

  it('keeps working in memory when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    const store = createStore();
    expect(store.draft()).toEqual(emptyAssessmentDraft());
    expect(() => store.patch({ income: { KZT: '1' } })).not.toThrow();
    expect(store.draft().income).toEqual({ KZT: '1' });
    expect(() => store.clear()).not.toThrow();
    expect(store.draft()).toEqual(emptyAssessmentDraft());
  });

  it('clamps the step and clears the stored draft', () => {
    const store = createStore();
    store.setStep(99);
    expect(store.draft().step).toBe(4);
    store.setStep(-3);
    expect(store.draft().step).toBe(0);

    store.patch({ income: { KZT: '5' } });
    store.clear();
    expect(sessionStorage.getItem(ASSESSMENT_DRAFT_STORAGE_KEY)).toBeNull();
    expect(store.draft()).toEqual(emptyAssessmentDraft());
  });
});
