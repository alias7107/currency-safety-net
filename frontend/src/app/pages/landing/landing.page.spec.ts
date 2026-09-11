import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { MODEL_METADATA } from '../../testing/fixtures';
import { EN_STRINGS } from '../../core/i18n/en';
import { LandingPage } from './landing.page';

describe('LandingPage', () => {
  let fixture: ComponentFixture<LandingPage>;
  let http: HttpTestingController;

  beforeEach(async () => {
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

  function dataAsOfText(): string {
    return (
      (fixture.nativeElement as HTMLElement)
        .querySelector('[data-testid="data-as-of"]')
        ?.textContent?.trim() ?? ''
    );
  }

  it('shows the data-as-of date from live metadata when the request succeeds', async () => {
    fixture.detectChanges();
    http.expectOne('/api/v1/model/metadata/').flush(MODEL_METADATA);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(dataAsOfText()).toBe(MODEL_METADATA.data_as_of);
  });

  it('does not display a hard-coded data-as-of date when metadata fails to load', async () => {
    fixture.detectChanges();
    http.expectOne('/api/v1/model/metadata/').flush(
      { error: { code: 'unavailable', message: 'down' } },
      { status: 503, statusText: 'Service Unavailable' },
    );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(dataAsOfText()).toBe(EN_STRINGS.common.unavailable);
    expect(dataAsOfText()).not.toContain('2025-12-31');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('2025-12-31');

    const note = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="metadata-unavailable-note"]',
    );
    expect(note?.textContent).toContain(EN_STRINGS.landing.metadataUnavailableNote);
  });
});
