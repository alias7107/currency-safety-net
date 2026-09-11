import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { EN_STRINGS } from '../../core/i18n/en';
import { DEFAULT_SCENARIO, ScenarioFormStore } from '../../core/state/scenario-form.store';
import {
  CACHED_JOB,
  MODEL_OPTIONS,
  OPTIMIZATION_RESULT,
  QUEUED_JOB,
  TEST_JOB_ID,
  errorBody,
} from '../../testing/fixtures';
import { CalculatorPage } from './calculator.page';

const OPTIONS_URL = '/api/v1/model/options/';
const JOBS_URL = '/api/v1/optimization-jobs/';

describe('CalculatorPage', () => {
  let fixture: ComponentFixture<CalculatorPage>;
  let component: CalculatorPage;
  let http: HttpTestingController;
  let router: Router;
  let store: ScenarioFormStore;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sessionStorage.clear();

    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });

    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    store = TestBed.inject(ScenarioFormStore);
    navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  /** Creates the page at `step`, optionally answering the options request. */
  function createAt(step: number, { flushOptions = true } = {}): void {
    store.setStep(step);
    fixture = TestBed.createComponent(CalculatorPage);
    component = fixture.componentInstance;
    fixture.detectChanges();

    if (flushOptions) {
      http.expectOne(OPTIONS_URL).flush(MODEL_OPTIONS);
      fixture.detectChanges();
    }
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return (host().textContent ?? '').replace(/\s+/g, ' ');
  }

  function runButton(): HTMLButtonElement {
    const button = host().querySelector<HTMLButtonElement>('[data-testid="run-scenario"]');
    expect(button).toBeTruthy();
    return button!;
  }

  function submitForm(): void {
    const form = host().querySelector<HTMLFormElement>('form');
    form!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    fixture.detectChanges();
  }

  // Scenario 2: options are loaded from the API
  it('loads documented options from the API on init', () => {
    createAt(0, { flushOptions: false });

    const request = http.expectOne(OPTIONS_URL);
    expect(request.request.method).toBe('GET');
    request.flush(MODEL_OPTIONS);
    fixture.detectChanges();

    const cards = host().querySelectorAll('app-profile-card');
    expect(cards.length).toBe(MODEL_OPTIONS.profiles.length);
  });

  // Scenario 3: form defaults
  it('starts from the research baseline defaults', () => {
    createAt(0);

    expect(component.form.getRawValue()).toEqual({
      profile: 'P2',
      horizon_years: 3,
      expense_income_ratio: 0.95,
      buffer_months: 1,
      rebalance_frequency: 'monthly',
      conversion_cost: 0,
    });
    expect(component.form.getRawValue()).toEqual({ ...DEFAULT_SCENARIO });
  });

  // Scenario 4: validation against the documented grid
  it('rejects values outside the documented option lists', () => {
    createAt(1);

    expect(component.form.valid).toBe(true);

    component.form.controls.horizon_years.setValue(2);
    expect(component.form.controls.horizon_years.valid).toBe(false);
    expect(component.form.valid).toBe(false);

    component.form.controls.horizon_years.setValue(5);
    expect(component.form.valid).toBe(true);

    component.form.controls.expense_income_ratio.setValue(0.99);
    expect(component.form.controls.expense_income_ratio.valid).toBe(false);

    component.form.controls.buffer_months.setValue(2);
    expect(component.form.controls.buffer_months.valid).toBe(false);
  });

  it('disables the run button while the form is invalid', () => {
    createAt(2);
    expect(runButton().disabled).toBe(false);

    component.form.controls.buffer_months.setValue(7);
    fixture.detectChanges();
    expect(runButton().disabled).toBe(true);
  });

  // Scenario 5: profile selection
  it('records the selected profile and persists it for the next step', () => {
    createAt(0);

    const radios = host().querySelectorAll<HTMLInputElement>(
      'app-profile-card input[type="radio"]',
    );
    expect(radios.length).toBe(4);

    const p4 = Array.from(radios).find((radio) => radio.value === 'P4');
    p4!.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(component.form.controls.profile.value).toBe('P4');
    expect(store.scenario().profile).toBe('P4');
    expect(sessionStorage.getItem('csn.scenario-form.v1')).toContain('P4');
  });

  it('shows the localized profile title rather than the internal engine name', () => {
    createAt(0);

    expect(text()).toContain(EN_STRINGS.profiles.P2.title);
    expect(text()).not.toContain('P2_foreign_income_mismatch');
  });

  // Scenario 6: payload construction
  it('builds the exact snake_case request body the API expects', () => {
    createAt(2);

    component.form.setValue({
      profile: 'P4',
      horizon_years: 5,
      expense_income_ratio: 1.05,
      buffer_months: 6,
      rebalance_frequency: 'quarterly',
      conversion_cost: 0.005,
    });
    fixture.detectChanges();

    expect(component.buildRequest()).toEqual({
      profile: 'P4',
      horizon_years: 5,
      expense_income_ratio: 1.05,
      buffer_months: 6,
      rebalance_frequency: 'quarterly',
      conversion_cost: 0.005,
    });

    submitForm();

    const request = http.expectOne(JOBS_URL);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      profile: 'P4',
      horizon_years: 5,
      expense_income_ratio: 1.05,
      buffer_months: 6,
      rebalance_frequency: 'quarterly',
      conversion_cost: 0.005,
    });
    request.flush(QUEUED_JOB, { status: 202, statusText: 'Accepted' });
  });

  // Scenario 7: 202 accepted navigates to the results route
  it('navigates to the results route when the job is queued', () => {
    createAt(2);
    submitForm();

    http.expectOne(JOBS_URL).flush(QUEUED_JOB, { status: 202, statusText: 'Accepted' });
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith(['/results', TEST_JOB_ID], undefined);
  });

  // Scenario 8: cached 200 hands the result over in navigation state
  it('passes a cached result to the results route as navigation state', () => {
    createAt(2);
    submitForm();

    http.expectOne(JOBS_URL).flush(CACHED_JOB, { status: 200, statusText: 'OK' });
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith(['/results', TEST_JOB_ID], {
      state: { result: OPTIMIZATION_RESULT },
    });
  });

  // Scenario 13: 400
  it('shows the validation error panel on a 400 response', () => {
    createAt(2);
    submitForm();

    http.expectOne(JOBS_URL).flush(
      errorBody('validation_error', 'The request could not be processed.', {
        horizon_years: ['horizon_years must be one of [1, 3, 5].'],
      }),
      { status: 400, statusText: 'Bad Request' },
    );
    fixture.detectChanges();

    expect(text()).toContain(EN_STRINGS.errors.validationTitle);
    expect(text()).toContain('horizon_years must be one of [1, 3, 5].');
    expect(navigate).not.toHaveBeenCalled();
  });

  // Scenario 15: 429
  it('shows the rate-limit error panel on a 429 response', () => {
    createAt(2);
    submitForm();

    http
      .expectOne(JOBS_URL)
      .flush(errorBody('request_error', 'Too many requests.'), {
        status: 429,
        statusText: 'Too Many Requests',
      });
    fixture.detectChanges();

    expect(text()).toContain(EN_STRINGS.errors.rateLimitTitle);
    expect(navigate).not.toHaveBeenCalled();
  });

  // Scenario 16: 503
  it('shows the service-unavailable panel on a 503 response', () => {
    createAt(2);
    submitForm();

    http.expectOne(JOBS_URL).flush(errorBody('queue_unavailable', 'Queue is unavailable.'), {
      status: 503,
      statusText: 'Service Unavailable',
    });
    fixture.detectChanges();

    expect(text()).toContain(EN_STRINGS.errors.unavailableTitle);
    expect(navigate).not.toHaveBeenCalled();
  });

  // Scenario 17: transport failure
  it('shows the network error panel when the request never reaches the server', () => {
    createAt(2);
    submitForm();

    http.expectOne(JOBS_URL).error(new ProgressEvent('error'));
    fixture.detectChanges();

    expect(text()).toContain(EN_STRINGS.errors.networkTitle);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('surfaces an options failure with a retry that re-requests the options', () => {
    createAt(0, { flushOptions: false });

    http.expectOne(OPTIONS_URL).error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(text()).toContain(EN_STRINGS.errors.networkTitle);

    const retry = host().querySelector<HTMLButtonElement>('app-error-panel button.button');
    retry!.click();
    fixture.detectChanges();

    http.expectOne(OPTIONS_URL).flush(MODEL_OPTIONS);
    fixture.detectChanges();
    expect(host().querySelectorAll('app-profile-card').length).toBe(4);
  });

  it('keeps the scenario in session storage when returning to an earlier step', () => {
    createAt(1);

    component.form.controls.buffer_months.setValue(6);
    fixture.detectChanges();

    expect(store.scenario().buffer_months).toBe(6);
    expect(JSON.parse(sessionStorage.getItem('csn.scenario-form.v1')!).buffer_months).toBe(6);
  });

  it('offers a review step with edit links back to each input', () => {
    createAt(2);

    const editButtons = host().querySelectorAll('.summary__edit');
    expect(editButtons.length).toBeGreaterThan(0);

    (editButtons[1] as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(store.step()).toBe(1);
  });

  it('never offers a buy, invest or advice action', () => {
    createAt(2);
    const body = text().toLowerCase();
    expect(body).not.toContain('buy ');
    expect(body).not.toContain('invest');
    expect(body).not.toContain('we recommend');
    expect(body).not.toContain('guarantee');
  });
});
