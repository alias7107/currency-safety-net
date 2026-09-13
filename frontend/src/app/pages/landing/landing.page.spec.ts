import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { routes } from '../../app.routes';
import { EN_STRINGS } from '../../core/i18n/en';
import { MODEL_METADATA } from '../../testing/fixtures';
import { CalculatorPage } from '../calculator/calculator.page';
import { ResearchPage } from '../research/research.page';

describe('Product experience routes', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('loads the existing calculator at /assessment', async () => {
    const harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl('/assessment', CalculatorPage);
    expect(page).toBeTruthy();

    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/v1/model/options/').flush({
      profiles: [],
      horizons_years: [1, 3, 5],
      expense_income_ratio: {
        min: 0.8,
        max: 1.05,
        default: 0.95,
        documented_values: [0.8, 0.95, 1.05],
      },
      buffer_months: { min: 1, max: 12, default: 1, documented_values: [1, 3, 6, 12] },
      rebalance_frequencies: ['monthly', 'quarterly', 'none'],
      conversion_cost: {
        min: 0,
        max: 0.01,
        default: 0,
        documented_values: [0, 0.0025, 0.005, 0.01],
      },
      currencies: ['KZT', 'USD', 'EUR'],
    });
    http.verify();
  });

  it('redirects /calculator to /assessment', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/calculator');
    const router = TestBed.inject(Router);
    expect(router.url).toBe('/assessment');
  });

  it('loads the research page at /research', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/research', ResearchPage);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/v1/model/metadata/').flush(MODEL_METADATA);
    http.verify();
    expect(harness.routeNativeElement?.textContent).toContain(EN_STRINGS.research.title);
  });

  it('lazy-loads the buffer sensitivity explorer route', async () => {
    expect(
      routes.some((route) => route.path === 'buffer-sensitivity/:jobId' && !!route.loadComponent),
    ).toBe(true);
    const harness = await RouterTestingHarness.create();
    const { BufferSensitivityPage } = await import('../buffer-sensitivity/buffer-sensitivity.page');
    const page = await harness.navigateByUrl(
      '/buffer-sensitivity/c3a91e2b-4d55-4f10-9a77-1e8c0b2d6f44',
      BufferSensitivityPage,
    );
    expect(page).toBeTruthy();
    const http = TestBed.inject(HttpTestingController);
    const pending = http.match(
      '/api/v1/buffer-sensitivity-jobs/c3a91e2b-4d55-4f10-9a77-1e8c0b2d6f44/',
    );
    for (const request of pending) {
      request.flush({
        job_id: 'c3a91e2b-4d55-4f10-9a77-1e8c0b2d6f44',
        status: 'queued',
        created_at: '2026-09-12T12:00:00Z',
        started_at: null,
        contract_version: 'buffer_sensitivity_batch_v1',
        tested_buffers: [1, 3, 6, 12],
      });
    }
    http.verify();
  });

  it('redirects /methodology to /research', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/methodology');
    const router = TestBed.inject(Router);
    expect(router.url).toBe('/research');
  });
});

describe('LandingPage product experience', () => {
  let fixture: ComponentFixture<import('./landing.page').LandingPage>;
  let http: HttpTestingController;

  beforeEach(async () => {
    const { LandingPage } = await import('./landing.page');
    await TestBed.configureTestingModule({
      imports: [LandingPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(LandingPage);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  function text(): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  it('routes primary and secondary hero CTAs to assessment and research', async () => {
    fixture.detectChanges();
    http.expectOne('/api/v1/model/metadata/').flush(MODEL_METADATA);
    fixture.detectChanges();

    const primary = fixture.debugElement.query(By.css('[data-testid="landing-primary-cta"]'));
    const secondary = fixture.debugElement.query(By.css('[data-testid="landing-secondary-cta"]'));
    expect(
      primary.attributes['ng-reflect-router-link'] ?? primary.nativeElement.getAttribute('href'),
    ).toBeTruthy();
    expect(primary.nativeElement.getAttribute('href') || '').toContain('/assessment');
    expect(secondary.nativeElement.getAttribute('href') || '').toContain('/research');
  });

  it('shows live research metadata and never hard-codes data-as-of', async () => {
    fixture.detectChanges();
    http.expectOne('/api/v1/model/metadata/').flush(MODEL_METADATA);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="data-as-of"]')
        ?.textContent,
    ).toContain(MODEL_METADATA.data_as_of);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="model-version"]')
        ?.textContent,
    ).toContain(MODEL_METADATA.model_version);
  });

  it('shows unavailable metadata state without a hard-coded date', async () => {
    fixture.detectChanges();
    http
      .expectOne('/api/v1/model/metadata/')
      .flush(
        { error: { code: 'unavailable', message: 'down' } },
        { status: 503, statusText: 'Service Unavailable' },
      );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(text()).toContain(EN_STRINGS.common.unavailable);
    expect(text()).not.toContain('2025-12-31');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="metadata-unavailable-note"]',
      ),
    ).toBeTruthy();
  });

  it('does not advertise unsupported later-phase product claims', async () => {
    fixture.detectChanges();
    http.expectOne('/api/v1/model/metadata/').flush(MODEL_METADATA);
    fixture.detectChanges();

    const copy = text().toLowerCase();
    for (const forbidden of [
      'resilience score',
      'recommended buffer',
      'personalized action plan',
      'ai assistant',
      'multilingual',
      'guaranteed',
      'proven household impact',
      'must invest',
      'validated research profiles',
      'no personal data stored',
    ]) {
      expect(copy).not.toContain(forbidden);
    }
    expect(copy).toContain('four predefined profiles evaluated in the research');
  });
});
