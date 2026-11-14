import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { emptyAssessmentDraft, type AssessmentDraft } from '../../core/assessment/assessment.model';
import { EN_STRINGS } from '../../core/i18n/en';
import { ASSESSMENT_DRAFT_STORAGE_KEY, AssessmentStore } from '../../core/state/assessment.store';
import { MODEL_OPTIONS } from '../../testing/fixtures';
import { AssessmentPage } from './assessment.page';

const OPTIONS_URL = '/api/v1/model/options/';
const sim = EN_STRINGS.assessment.simulation;

/** KZT-only answers: 90% of income and 3 months of coverage. */
function draft(overrides: Partial<AssessmentDraft> = {}): AssessmentDraft {
  return {
    ...emptyAssessmentDraft(),
    step: 1,
    incomeCurrencies: ['KZT'],
    expenseCurrencies: ['KZT'],
    reserveCurrencies: ['KZT'],
    income: { KZT: '1000000' },
    expenses: { KZT: '900000' },
    reserves: { KZT: '2700000' },
    horizonYears: 3,
    rebalanceFrequency: 'quarterly',
    conversionCost: 0.0025,
    ...overrides,
  };
}

describe('AssessmentPage inline simulation feedback', () => {
  let fixture: ComponentFixture<AssessmentPage>;
  let http: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.expectNone((req) => req.method === 'POST');
    http.verify();
    sessionStorage.clear();
  });

  async function create(d: AssessmentDraft = draft()): Promise<void> {
    sessionStorage.setItem(ASSESSMENT_DRAFT_STORAGE_KEY, JSON.stringify(d));
    fixture = TestBed.createComponent(AssessmentPage);
    fixture.detectChanges();
    http.expectOne(OPTIONS_URL).flush(MODEL_OPTIONS);
    await settle();
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const maybe = (id: string) => host().querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const found = host().querySelector<T>(`[data-testid="${id}"]`);
    if (!found) {
      throw new Error(`Missing [data-testid="${id}"]`);
    }
    return found;
  };
  const patch = async (p: Partial<AssessmentDraft>) => {
    TestBed.inject(AssessmentStore).patch(p);
    await settle();
  };
  const heading = () => el('assessment-step-heading').textContent!.trim();

  async function type(id: string, value: string): Promise<void> {
    const input = el<HTMLInputElement>(id);
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  }

  async function leave(id: string): Promise<void> {
    el<HTMLInputElement>(id).dispatchEvent(new Event('blur'));
    await settle();
  }

  it('shows essential expenses as a share of income with the supported range', async () => {
    await create();
    const note = el('ratio-simulation-feedback');
    expect(note.getAttribute('data-state')).toBe('supported');
    expect(note.textContent).toContain('Your essential expenses are 90% of your income.');
    expect(note.textContent).toContain('Personal simulations currently support 80%–105%');
    expect(note.getAttribute('role')).toBeNull();
    expect(note.closest('[aria-live]')).toBeNull();
    expect(note.querySelector('[role="alert"]')).toBeNull();
  });

  it('explains an unsupported ratio calmly and still allows continuing', async () => {
    await create(draft({ expenses: { KZT: '500000' } }));
    const note = el('ratio-simulation-feedback');
    expect(note.getAttribute('data-state')).toBe('outside');
    expect(note.textContent).toContain('are 50% of your income');
    expect(note.textContent).toContain('You can still continue to your household overview.');
    expect(note.textContent).toContain(sim.inline.modelLimit);
    expect(note.textContent).not.toMatch(/unsafe|risky|change your|adjust/i);

    el('assessment-next').click();
    await settle();
    expect(heading()).toBe(EN_STRINGS.assessment.steps[2].label);
    expect(maybe('assessment-step-errors')).toBeNull();
  });

  it('shows guidance instead of a value while inputs are incomplete or invalid', async () => {
    await create(draft({ expenses: {} }));
    const pending = () => el('ratio-simulation-feedback');
    expect(pending().getAttribute('data-state')).toBe('pending');
    expect(pending().textContent).not.toMatch(/are \d|not available/);

    await patch({ expenses: { KZT: '12,5' } });
    expect(pending().getAttribute('data-state')).toBe('pending');

    await patch({ expenses: { KZT: '1050000' } });
    expect(pending().getAttribute('data-state')).toBe('supported');
    expect(pending().textContent).toContain('are 105% of your income');
  });

  it('recalculates when income, currencies and exchange rates change', async () => {
    await create();
    const note = () => el('ratio-simulation-feedback');
    await patch({ income: { KZT: '857100' } });
    expect(note().getAttribute('data-state')).toBe('outside');
    expect(note().textContent).toContain('just over 105%');

    await patch({ incomeCurrencies: ['KZT', 'USD'], income: { KZT: '500000', USD: '1000' } });
    expect(note().getAttribute('data-state')).toBe('pending');

    await patch({ rates: { USD: '500' }, valuationDate: '2026-01-15' });
    expect(note().getAttribute('data-state')).toBe('supported');
    expect(note().textContent).toContain('are 90% of your income');

    await patch({ rates: { USD: '1000' } });
    expect(note().textContent).toContain('are 60% of your income');
  });

  it('does not change feedback on every keystroke; it settles when the field is left', async () => {
    await create();
    const note = () => el('ratio-simulation-feedback');
    await type('expense-KZT', '5');
    expect(note().getAttribute('data-state')).toBe('supported');
    expect(note().textContent).toContain('are 90% of your income');
    await type('expense-KZT', '50000');
    expect(note().textContent).toContain('are 90% of your income');

    await leave('expense-KZT');
    expect(note().getAttribute('data-state')).toBe('outside');
    expect(note().textContent).toContain('are 5% of your income');
  });

  it('shows reserve coverage with the supported range on the reserve step', async () => {
    await create(draft({ step: 2 }));
    const note = el('coverage-simulation-feedback');
    expect(note.getAttribute('data-state')).toBe('supported');
    expect(note.textContent).toContain('Your reserve covers 3 months of essential expenses.');
    expect(note.textContent).toContain('support 1–12 months');

    await patch({ reserves: { KZT: '10800000' } });
    expect(note.getAttribute('data-state')).toBe('supported');
    expect(note.textContent).toContain('covers 12 months');

    await patch({ reserves: { KZT: '10800001' } });
    expect(el('coverage-simulation-feedback').getAttribute('data-state')).toBe('outside');
    expect(el('coverage-simulation-feedback').textContent).toContain('just over 12 months');

    await patch({ reserves: {} });
    expect(el('coverage-simulation-feedback').getAttribute('data-state')).toBe('pending');
    expect(el('coverage-simulation-feedback').textContent).not.toMatch(/covers \d|not available/);
  });

  it('recalculates coverage when essential expenses change', async () => {
    await create(draft({ step: 2 }));
    await patch({ expenses: { KZT: '100000' } });
    const note = el('coverage-simulation-feedback');
    expect(note.getAttribute('data-state')).toBe('outside');
    expect(note.textContent).toContain('covers 27 months');
  });

  it('explains that the simulation needs an existing reserve', async () => {
    await create(draft({ step: 2, noReserve: true, reserveCurrencies: [], reserves: {} }));
    const note = el('coverage-simulation-feedback');
    expect(note.getAttribute('data-state')).toBe('none');
    expect(note.textContent).toContain('need an existing reserve');
    expect(note.textContent).toContain('Your household overview is still available.');
  });

  it('keeps the overview reachable for an unsupported scenario, with the button disabled and every reason listed', async () => {
    await create(draft({ step: 2, expenses: { KZT: '500000' }, reserves: { KZT: '10000000' } }));
    el('assessment-next').click();
    await settle();
    el('assessment-view-overview').click();
    await settle();

    expect(el('assessment-overview')).toBeTruthy();
    expect(el('total-income')).toBeTruthy();
    const button = el<HTMLButtonElement>('run-simulation');
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-describedby')).toBe('simulation-run-status');
    expect(el('simulation-run-status').textContent).toContain(sim.runUnavailable.ineligible);
    expect(button.contains(el('simulation-run-status'))).toBe(false);
    const reasons = Array.from(host().querySelectorAll('[data-testid="simulation-reason"]'));
    expect(reasons.map((r) => r.getAttribute('data-reason'))).toEqual([
      'expense_income_ratio_out_of_supported_range',
      'buffer_months_out_of_supported_range',
    ]);
    expect(el('simulation-reason-edit-expense_income_ratio_out_of_supported_range')).toBeTruthy();
    button.click();
    await settle();

    const stored = JSON.parse(sessionStorage.getItem(ASSESSMENT_DRAFT_STORAGE_KEY)!);
    expect(stored.expenses).toEqual({ KZT: '500000' });
    expect(stored.reserves).toEqual({ KZT: '10000000' });
  });

  it('describes a just-outside boundary value without rounding it onto the boundary in the final reasons', async () => {
    await create(draft({ step: 4, expenses: { KZT: '1050001' } }));
    const reason = host().querySelector(
      '[data-reason="expense_income_ratio_out_of_supported_range"]',
    )!;
    expect(reason.textContent).toContain('just over 105%');
  });

  it('still blocks malformed or missing answers with the normal validation', async () => {
    await create(draft({ expenses: { KZT: 'abc' } }));
    el('assessment-next').click();
    await settle();
    expect(heading()).toBe(EN_STRINGS.assessment.steps[1].label);
    expect(el('assessment-step-errors')).toBeTruthy();
    expect(el('ratio-simulation-feedback').getAttribute('data-state')).toBe('pending');
  });
});
