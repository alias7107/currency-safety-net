import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { EN_STRINGS } from '../../core/i18n/en';
import { MODEL_METADATA } from '../../testing/fixtures';
import { ResearchPage } from './research.page';

describe('ResearchPage', () => {
  let fixture: ComponentFixture<ResearchPage>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ResearchPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ResearchPage);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  function text(): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  it('preserves plain-language and technical methodology content', async () => {
    fixture.detectChanges();
    http.expectOne('/api/v1/model/metadata/').flush(MODEL_METADATA);
    fixture.detectChanges();
    await fixture.whenStable();

    const copy = text();
    expect(copy).toContain(EN_STRINGS.methodology.plainHeading);
    expect(copy).toContain(EN_STRINGS.methodology.technicalHeading);
    expect(copy).toContain(EN_STRINGS.methodology.plainSections[0].title);
    expect(copy).toContain(EN_STRINGS.research.publication.placeholder);
    expect(copy).toContain(EN_STRINGS.research.openAssessment);
  });

  it('describes CVaR95 as the single optimisation objective', async () => {
    fixture.detectChanges();
    http.expectOne('/api/v1/model/metadata/').flush(MODEL_METADATA);
    fixture.detectChanges();
    await fixture.whenStable();

    const copy = text();
    expect(copy).toContain('lowest average cumulative shortfall among the worst 5%');
    expect(copy).toContain('CVaR95 of cumulative shortfall');
    expect(copy).toContain('additional diagnostics');
    expect(copy).toContain('not jointly optimised');
    expect(copy.toLowerCase()).not.toContain('least often and least severely');
  });

  it('loads live metadata into the parameter table', async () => {
    fixture.detectChanges();
    http.expectOne('/api/v1/model/metadata/').flush(MODEL_METADATA);
    fixture.detectChanges();
    await fixture.whenStable();

    const table = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="parameter-table"]',
    );
    expect(table?.textContent).toContain(MODEL_METADATA.model_version);
    expect(table?.textContent).toContain(MODEL_METADATA.data_as_of);
  });

  it('shows metadata-specific copy for a non-JSON 502 without transport details', async () => {
    fixture.detectChanges();
    http.expectOne('/api/v1/model/metadata/').flush('<html>Bad Gateway</html>', {
      status: 502,
      statusText: 'Bad Gateway',
    });
    fixture.detectChanges();
    await fixture.whenStable();

    const copy = text();
    expect(copy).toContain(EN_STRINGS.research.metadataUnavailableTitle);
    expect(copy).toContain(EN_STRINGS.research.metadataUnavailableBody);
    expect(copy).not.toContain('Http failure response');
    expect(copy).not.toContain('/api/v1/');
    expect(copy).not.toContain('502 Bad Gateway');
    expect(copy).not.toMatch(/localhost|127\.0\.0\.1/);
    expect(copy.toLowerCase()).not.toContain('scenario queue');
  });

  it('shows an error state when metadata cannot be loaded', async () => {
    fixture.detectChanges();
    http.expectOne('/api/v1/model/metadata/').flush(
      { error: { code: 'unavailable', message: 'down' } },
      { status: 503, statusText: 'Service Unavailable' },
    );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(text()).toContain(EN_STRINGS.research.metadataUnavailableTitle);
    expect(text()).toContain(EN_STRINGS.research.metadataUnavailableBody);
  });
});
