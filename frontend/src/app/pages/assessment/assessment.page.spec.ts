import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { emptyAssessmentDraft } from '../../core/assessment/assessment.model';
import { EN_STRINGS } from '../../core/i18n/en';
import { ASSESSMENT_DRAFT_STORAGE_KEY } from '../../core/state/assessment.store';
import { MODEL_OPTIONS } from '../../testing/fixtures';
import { AssessmentPage } from './assessment.page';

const OPTIONS_URL = '/api/v1/model/options/';
const copy = EN_STRINGS.assessment;

describe('AssessmentPage', () => {
  let fixture: ComponentFixture<AssessmentPage>;
  let http: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    sessionStorage.clear();
    localStorage.clear();
  });

  async function create(options: 'ok' | 'fail' | 'pending' = 'ok'): Promise<void> {
    fixture = TestBed.createComponent(AssessmentPage);
    fixture.detectChanges();
    const request = http.expectOne(OPTIONS_URL);
    expect(request.request.method).toBe('GET');
    if (options === 'ok') {
      request.flush(MODEL_OPTIONS);
    } else if (options === 'fail') {
      request.flush(
        { error: { code: 'unavailable', message: 'down' } },
        { status: 503, statusText: 'Service Unavailable' },
      );
    }
    await settle();
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return (host().textContent ?? '').replace(/\s+/g, ' ');
  }

  function el<T extends HTMLElement = HTMLElement>(testId: string): T {
    const found = host().querySelector<T>(`[data-testid="${testId}"]`);
    if (!found) {
      throw new Error(`Missing [data-testid="${testId}"]`);
    }
    return found;
  }

  async function type(testId: string, value: string): Promise<void> {
    const input = el<HTMLInputElement>(testId);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    await settle();
  }

  async function click(testId: string): Promise<void> {
    el(testId).click();
    await settle();
  }

  async function chooseRadio(groupName: string, value: string): Promise<void> {
    const radio = host().querySelector<HTMLInputElement>(
      `input[name="${groupName}"][value="${value}"]`,
    )!;
    radio.click();
    await settle();
  }

  function stepHeading(): string {
    return el('assessment-step-heading').textContent?.trim() ?? '';
  }

  /** Mixed-currency household with an arbitrary composition (not P1–P4). */
  async function completeMixedQuestionnaire(): Promise<void> {
    await click('incomeCurrencies-KZT');
    await click('incomeCurrencies-USD');
    await click('expenseCurrencies-KZT');
    await click('expenseCurrencies-EUR');
    await click('reserveCurrencies-USD');
    await click('assessment-next');

    await type('income-KZT', '300000');
    await type('income-USD', '1000');
    await type('expense-KZT', '200000');
    await type('expense-EUR', '100');
    await type('rate-USD', '500');
    await type('rate-EUR', '550');
    await type('valuation-date', '2026-01-15');
    await click('assessment-next');

    await type('reserve-USD', '1020');
    await chooseRadio('assessment-horizon', '3');
    await click('assessment-next');
  }

  it('introduces the assessment without promising risk results', async () => {
    await create();
    expect(text()).toContain(copy.intro);
    expect(text()).toContain(copy.phaseNote);
    expect(text()).toContain(copy.privacyNote);
    expect(host().querySelectorAll('h1').length).toBe(1);
    expect(stepHeading()).toBe(copy.steps[0].label);
  });

  it('offers Kazakhstan and KZT as the only supported choices', async () => {
    await create();
    const country = host().querySelector<HTMLSelectElement>('#assessment-country')!;
    const base = host().querySelector<HTMLSelectElement>('#assessment-base-currency')!;
    expect(Array.from(country.options).map((o) => o.value)).toEqual(['KZ']);
    expect(Array.from(base.options).map((o) => o.value)).toEqual(['KZT']);
    expect(host().querySelector('label[for="assessment-country"]')).toBeTruthy();
  });

  it('requires income and expense currencies before continuing', async () => {
    await create();
    await click('assessment-next');

    expect(stepHeading()).toBe(copy.steps[0].label);
    expect(text()).toContain(copy.errors.income_currency_required);
    expect(text()).toContain(copy.errors.expense_currency_required);
    expect(text()).toContain(copy.errors.reserve_currency_required);
    const group = host().querySelector('[data-group="incomeCurrencies"]')!;
    expect(group.getAttribute('aria-describedby')).toContain('incomeCurrencies-error');
    expect(document.activeElement?.id).toBe('incomeCurrencies-KZT');
  });

  it('completes the mixed-currency flow and shows converted totals and shares', async () => {
    await create();
    await completeMixedQuestionnaire();
    expect(stepHeading()).toBe(copy.steps[3].label);

    await chooseRadio('assessment-rebalance', 'quarterly');
    await chooseRadio('assessment-conversion-cost', '0.0025');
    await click('assessment-view-overview');

    expect(el('assessment-overview')).toBeTruthy();
    expect(el('total-income').textContent).toContain('800,000 KZT');
    expect(el('total-expenses').textContent).toContain('255,000 KZT');
    expect(el('expense-share-of-income').textContent).toContain('31.9%');
    expect(el('income-remaining').textContent).toContain('545,000 KZT');
    expect(el('reserve-total').textContent).toContain('510,000 KZT');
    expect(el('reserve-coverage').textContent).toContain('2.00 months');
    expect(el('reserve-composition').textContent).toContain('100%');
    expect(el('overview-contribution').textContent).toContain(copy.overview.notProvided);
    expect(el('overview-valuation').textContent).toContain('1 USD = 500 KZT');
    expect(el('overview-valuation').textContent).toContain('2026-01-15');
    expect(el('overview-settings').textContent).toContain('3 years');
    expect(el('overview-settings').textContent).toContain('Quarterly');
    expect(el('overview-settings').textContent).toContain('0.25%');
    expect(el('assessment-overview').textContent).toContain(copy.overview.body);
    expect(text().toLowerCase()).not.toMatch(/shortfall probability|resilience score/);
    // The overview describes the optional simulation but shows no simulated figures.
    expect(host().querySelector('[data-testid="personal-results"]')).toBeNull();
    expect(text()).not.toMatch(/CVaR95 \(sole objective\)|months of initial monthly income/);
  });

  it('never submits an optimization or buffer-sensitivity job', async () => {
    await create();
    await completeMixedQuestionnaire();
    await click('assessment-view-overview');

    http.expectNone((req) => req.method === 'POST');
    http.expectNone((req) => req.url.includes('optimization-jobs'));
    http.expectNone((req) => req.url.includes('buffer-sensitivity-jobs'));
  });

  it('keeps financial answers out of the URL and localStorage', async () => {
    await create();
    await completeMixedQuestionnaire();
    const router = TestBed.inject(Router);
    expect(router.url).not.toMatch(/300000|500|income/);
    expect(localStorage.length).toBe(0);
    const stored = JSON.parse(sessionStorage.getItem(ASSESSMENT_DRAFT_STORAGE_KEY)!);
    expect(stored.income).toEqual({ KZT: '300000', USD: '1000' });
    expect(stored).not.toHaveProperty('overview');
  });

  it('updates totals when a valuation rate changes', async () => {
    await create();
    await completeMixedQuestionnaire();
    await click('assessment-back');
    await click('assessment-back');
    expect(stepHeading()).toBe(copy.steps[1].label);

    await type('rate-USD', '400');
    expect(el('total-income').textContent).toContain('700,000 KZT');
  });

  it('preserves answers when moving back and forward', async () => {
    await create();
    await completeMixedQuestionnaire();
    await click('assessment-back');
    await click('assessment-back');
    await click('assessment-back');
    expect(el<HTMLInputElement>('incomeCurrencies-USD').checked).toBe(true);
    await click('assessment-next');
    expect(el<HTMLInputElement>('income-USD').value).toBe('1000');
  });

  it('supports an explicit no-reserve answer with zero contribution', async () => {
    await create();
    await click('incomeCurrencies-KZT');
    await click('expenseCurrencies-KZT');
    await click('assessment-no-reserve');
    expect(el<HTMLInputElement>('reserveCurrencies-KZT').disabled).toBe(true);
    await click('assessment-next');

    await type('income-KZT', '400000');
    await type('expense-KZT', '250000');
    expect(el('assessment-no-rates')).toBeTruthy();
    await click('assessment-next');

    expect(el('assessment-no-reserve-note')).toBeTruthy();
    await type('monthly-contribution', '0');
    await chooseRadio('assessment-horizon', '1');
    await click('assessment-next');
    await click('assessment-view-overview');

    expect(el('reserve-none').textContent).toContain(copy.overview.noReserve);
    expect(host().querySelector('[data-testid="reserve-composition"]')).toBeNull();
    expect(el('reserve-coverage').textContent).toContain('0.00 months');
    expect(el('overview-contribution').textContent).toContain('0 KZT');
  });

  it('shows inline errors for invalid amounts and blocks the step', async () => {
    await create();
    await click('incomeCurrencies-KZT');
    await click('expenseCurrencies-KZT');
    await click('assessment-no-reserve');
    await click('assessment-next');

    await type('income-KZT', '-100');
    await type('expense-KZT', '');
    await click('assessment-next');

    expect(stepHeading()).toBe(copy.steps[1].label);
    const income = el<HTMLInputElement>('income-KZT');
    expect(income.getAttribute('aria-invalid')).toBe('true');
    expect(income.getAttribute('aria-describedby')).toContain('income-KZT-error');
    expect(text()).toContain(copy.errors.negative);
    expect(text()).toContain(copy.errors.required);
  });

  it('keeps answers and the overview usable when model options fail', async () => {
    await create('fail');
    await completeMixedQuestionnaire();

    expect(text()).toContain(copy.settings.optionsErrorTitle);
    await click('assessment-view-overview');
    expect(el('overview-settings').textContent).toContain(copy.overview.settingsUnavailable);
    expect(el('total-income').textContent).toContain('800,000 KZT');

    await click('edit-step-3');
    const retry = Array.from(host().querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === EN_STRINGS.common.retry,
    )!;
    retry.click();
    http.expectOne(OPTIONS_URL).flush(MODEL_OPTIONS);
    await settle();
    expect(host().querySelector('input[name="assessment-rebalance"]')).toBeTruthy();
  });

  it('returns to the relevant step from an overview Edit action', async () => {
    await create();
    await completeMixedQuestionnaire();
    await click('assessment-view-overview');
    const edit = el<HTMLButtonElement>('edit-step-2');
    expect(edit.getAttribute('aria-label')).toContain(copy.overview.reserveHeading);
    edit.click();
    await settle();
    expect(stepHeading()).toBe(copy.steps[2].label);
    expect(document.activeElement?.id).toBe('assessment-step-heading');
  });

  it('restores a draft and never trusts persisted totals', async () => {
    sessionStorage.setItem(
      ASSESSMENT_DRAFT_STORAGE_KEY,
      JSON.stringify({
        ...emptyAssessmentDraft(),
        step: 1,
        incomeCurrencies: ['KZT'],
        expenseCurrencies: ['KZT'],
        noReserve: true,
        income: { KZT: '100000' },
        expenses: { KZT: '50000' },
        totalIncome: 999999999,
      }),
    );
    await create();
    expect(stepHeading()).toBe(copy.steps[1].label);
    expect(el('total-income').textContent).toContain('100,000 KZT');
    expect(text()).not.toContain('999,999,999');
  });

  it('sends an incomplete restored overview back to the first invalid step', async () => {
    sessionStorage.setItem(
      ASSESSMENT_DRAFT_STORAGE_KEY,
      JSON.stringify({ ...emptyAssessmentDraft(), step: 4, incomeCurrencies: ['KZT'] }),
    );
    await create();
    expect(host().querySelector('[data-testid="assessment-overview"]')).toBeNull();
    expect(stepHeading()).toBe(copy.steps[0].label);
  });

  it('recovers from corrupted storage', async () => {
    sessionStorage.setItem(ASSESSMENT_DRAFT_STORAGE_KEY, '{"version":1,"step":');
    await create();
    expect(stepHeading()).toBe(copy.steps[0].label);
  });

  it('clears answers through an accessible confirmation dialog', async () => {
    await create();
    await click('incomeCurrencies-USD');
    const opener = el<HTMLButtonElement>('assessment-clear');
    opener.focus();
    opener.click();
    await settle();

    const dialog = el('assessment-clear-dialog');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement?.id).toBe('assessment-clear-title');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(host().querySelector('[data-testid="assessment-clear-dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(el<HTMLInputElement>('incomeCurrencies-USD').checked).toBe(true);

    opener.click();
    await settle();
    await click('assessment-clear-confirm');
    expect(host().querySelector('[data-testid="assessment-clear-dialog"]')).toBeNull();
    expect(el<HTMLInputElement>('incomeCurrencies-USD').checked).toBe(false);
    expect(sessionStorage.getItem(ASSESSMENT_DRAFT_STORAGE_KEY)).toBeNull();
    expect(document.activeElement?.id).toBe('assessment-title');
    expect(el('assessment-live').textContent).toContain(copy.clearDialog.clearedLive);
  });

  function pressTab(shiftKey = false): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
    return event;
  }

  async function openClearDialog(): Promise<HTMLButtonElement> {
    const opener = el<HTMLButtonElement>('assessment-clear');
    opener.focus();
    opener.click();
    await settle();
    return opener;
  }

  it('wraps Shift+Tab and Tab inside the dialog immediately after opening', async () => {
    await create();
    await openClearDialog();
    const confirm = el<HTMLButtonElement>('assessment-clear-confirm');
    const cancel = el<HTMLButtonElement>('assessment-clear-cancel');
    expect(document.activeElement?.id).toBe('assessment-clear-title');

    const shiftFromHeading = pressTab(true);
    expect(shiftFromHeading.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);

    pressTab(true);
    expect(document.activeElement).toBe(confirm);
    pressTab(true);
    expect(document.activeElement).toBe(cancel);
    pressTab();
    expect(document.activeElement).toBe(confirm);
    pressTab();
    expect(document.activeElement).toBe(cancel);

    host().querySelector<HTMLElement>('#assessment-clear-title')!.focus();
    pressTab();
    expect(document.activeElement).toBe(confirm);
  });

  it('pulls focus back into the dialog if it escapes', async () => {
    await create();
    await openClearDialog();
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    pressTab();
    expect(document.activeElement).toBe(el('assessment-clear-confirm'));
  });

  it('makes the background inert while the dialog is open', async () => {
    await create();
    await openClearDialog();
    const dialog = el('assessment-clear-dialog');

    const inert = Array.from(document.querySelectorAll('[inert]'));
    expect(inert.length).toBeGreaterThan(0);
    expect(inert.some((node) => node.contains(dialog))).toBe(false);
    expect(el('assessment-clear').closest('[inert]')).not.toBeNull();
    expect(el('assessment-form').closest('[inert]')).not.toBeNull();
    expect(dialog.closest('[inert]')).toBeNull();
  });

  it('cancels with the Cancel button, keeps answers and restores focus and interaction', async () => {
    await create();
    await click('incomeCurrencies-EUR');
    const opener = await openClearDialog();

    await click('assessment-clear-cancel');
    expect(host().querySelector('[data-testid="assessment-clear-dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.querySelectorAll('[inert]').length).toBe(0);
    expect(el<HTMLInputElement>('incomeCurrencies-EUR').checked).toBe(true);
    expect(sessionStorage.getItem(ASSESSMENT_DRAFT_STORAGE_KEY)).toContain('EUR');
  });

  it('restores page interaction after Escape and after confirming', async () => {
    await create();
    await openClearDialog();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(document.querySelectorAll('[inert]').length).toBe(0);

    await openClearDialog();
    await click('assessment-clear-confirm');
    expect(document.querySelectorAll('[inert]').length).toBe(0);
    expect(document.activeElement?.id).toBe('assessment-title');
  });

  it('restores page interaction when destroyed with the dialog open', async () => {
    await create();
    await openClearDialog();
    expect(document.querySelectorAll('[inert]').length).toBeGreaterThan(0);
    fixture.destroy();
    expect(document.querySelectorAll('[inert]').length).toBe(0);
  });

  it('edits the horizon on the reserve step and focuses the selected option', async () => {
    await create();
    await completeMixedQuestionnaire();
    await click('assessment-view-overview');

    const editHorizon = el<HTMLButtonElement>('edit-horizon');
    expect(editHorizon.textContent?.trim()).toBe(copy.actions.editHorizon);
    editHorizon.click();
    await settle();

    expect(stepHeading()).toBe(copy.steps[2].label);
    const active = document.activeElement as HTMLInputElement;
    expect(active.name).toBe('assessment-horizon');
    expect(active.value).toBe('3');
    expect(active.checked).toBe(true);
  });

  it('keeps model-settings editing on the settings step', async () => {
    await create();
    await completeMixedQuestionnaire();
    await click('assessment-view-overview');

    const editSettings = el<HTMLButtonElement>('edit-step-3');
    expect(editSettings.getAttribute('aria-label')).toBe('Edit model settings');
    editSettings.click();
    await settle();
    expect(stepHeading()).toBe(copy.steps[3].label);
    expect(host().querySelector('input[name="assessment-rebalance"]')).toBeTruthy();
    expect(host().querySelector('input[name="assessment-horizon"]')).toBeNull();
  });

  it('accepts grouped thousands and rejects malformed spacing in the form', async () => {
    await create();
    await click('incomeCurrencies-KZT');
    await click('expenseCurrencies-KZT');
    await click('assessment-no-reserve');
    await click('assessment-next');

    await type('income-KZT', '1 250 000.50');
    await type('expense-KZT', '12 34');
    expect(el('total-income').textContent).toContain('1,250,000.5 KZT');
    expect(el<HTMLInputElement>('expense-KZT').getAttribute('aria-invalid')).toBe('true');
    expect(text()).toContain(copy.errors.invalid_number);
  });

  it('links to the research calculator as a separate exploration', async () => {
    await create();
    const link = el('assessment-research-link').querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/research/calculator');
    expect(el('assessment-research-link').textContent).toContain(copy.researchLinkNote);
  });
});
