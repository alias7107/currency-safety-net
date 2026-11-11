import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { EN_STRINGS } from '../../core/i18n/en';
import { MODEL_METADATA } from '../../testing/fixtures';
import { ResearchPage } from './research.page';

const SSRN_URL = 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7591999';

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

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return (host().textContent ?? '').replace(/\s+/g, ' ');
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
    expect(copy).toContain(EN_STRINGS.research.openAssessment);
  });

  it('keeps a single h1 for the research introduction', async () => {
    fixture.detectChanges();
    http.expectOne('/api/v1/model/metadata/').flush(MODEL_METADATA);
    fixture.detectChanges();
    await fixture.whenStable();

    const headings = host().querySelectorAll('h1');
    expect(headings.length).toBe(1);
    expect(headings[0].textContent).toContain(EN_STRINGS.research.title);
  });

  it('links the SSRN preprint in place of the publication placeholder', async () => {
    fixture.detectChanges();
    http.expectOne('/api/v1/model/metadata/').flush(MODEL_METADATA);
    fixture.detectChanges();
    await fixture.whenStable();

    const card = host().querySelector('[data-testid="preprint-card"]')!;
    expect(card).toBeTruthy();
    expect(card.querySelector('[data-testid="publication-placeholder"]')).toBeNull();

    const link = card.querySelector<HTMLAnchorElement>('[data-testid="publication-link"]')!;
    expect(link.getAttribute('href')).toBe(SSRN_URL);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toContain('Read the preprint on SSRN');
    expect(link.textContent).toContain(EN_STRINGS.common.opensInNewTab);
  });

  it('labels the work as a research preprint with the supplied metadata', async () => {
    fixture.detectChanges();
    http.expectOne('/api/v1/model/metadata/').flush(MODEL_METADATA);
    fixture.detectChanges();
    await fixture.whenStable();

    const card = host().querySelector('[data-testid="preprint-card"]')!;
    const copy = (card.textContent ?? '').replace(/\s+/g, ' ');
    expect(card.querySelector('[data-testid="preprint-badge"]')?.textContent).toContain(
      'SSRN preprint',
    );
    expect(card.querySelector('[data-testid="paper-title"]')?.textContent).toContain(
      'Currency Allocation of Household Liquid Savings under Multi-Currency Cash Flows',
    );
    expect(copy).toContain('Ali Ashkeyev');
    expect(copy).toContain('Kazakh-British Technical University');
    expect(copy).toContain('Research preprint');
    expect(copy).toContain('September 3, 2026');
    expect(copy).toContain('October 13, 2026');
    expect(copy).toContain('7591999');

    const lower = copy.toLowerCase();
    for (const forbidden of ['doi', 'journal', 'volume', 'issue', 'accepted', 'peer-reviewed']) {
      expect(lower).not.toContain(forbidden);
    }
  });

  it('keeps preprint dates separate from the model data cutoff', async () => {
    fixture.detectChanges();
    http.expectOne('/api/v1/model/metadata/').flush(MODEL_METADATA);
    fixture.detectChanges();
    await fixture.whenStable();

    const card = host().querySelector('[data-testid="preprint-card"]')!;
    expect(card.textContent).not.toContain(MODEL_METADATA.data_as_of);
    const table = host().querySelector('[data-testid="parameter-table"]')!;
    expect(table.textContent).not.toContain('October 13, 2026');
  });

  it('shows the conference card separately with the official website', async () => {
    fixture.detectChanges();
    http.expectOne('/api/v1/model/metadata/').flush(MODEL_METADATA);
    fixture.detectChanges();
    await fixture.whenStable();

    const card = host().querySelector('[data-testid="conference-card"]')!;
    expect(card).toBeTruthy();
    expect(host().querySelector('[data-testid="preprint-card"]')?.contains(card)).toBe(false);
    const copy = (card.textContent ?? '').replace(/\s+/g, ' ');
    expect(copy).toContain('Presented at ICOAEF XVII');
    expect(copy).toContain(EN_STRINGS.research.conference.body);
    expect(copy).toContain('November 20–21, 2026');

    const link = card.querySelector<HTMLAnchorElement>('[data-testid="publication-link"]')!;
    expect(link.getAttribute('href')).toBe('https://www.icoaef.com/');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toContain('Visit the conference website');

    const lower = copy.toLowerCase();
    for (const forbidden of ['verified', 'proceedings', 'award', 'keynote', 'peer']) {
      expect(lower).not.toContain(forbidden);
    }
  });

  it('summarises the study without static results or universal allocations', async () => {
    fixture.detectChanges();
    http.expectOne('/api/v1/model/metadata/').flush(MODEL_METADATA);
    fixture.detectChanges();
    await fixture.whenStable();

    const summary = host().querySelector('[data-testid="research-summary"]')!;
    const copy = (summary.textContent ?? '').replace(/\s+/g, ' ');
    expect(copy).toContain('KZT, USD, and EUR');
    expect(copy).toContain('one, three, and five years');
    expect(copy).toContain('worst 5% of simulated paths');
    expect(copy).toContain('CVaR95 is the sole optimisation objective');
    expect(copy).toContain('not jointly optimised');
    expect(copy).toContain('not observed individual households');
    expect(copy).toContain('not exchange-rate forecasts or guarantees');
    expect(copy).not.toMatch(/100\s?%/);
    expect(copy).not.toMatch(/\d\.\d{3,}/);
  });

  it('provides a selectable citation with an accessible SSRN link', async () => {
    fixture.detectChanges();
    http.expectOne('/api/v1/model/metadata/').flush(MODEL_METADATA);
    fixture.detectChanges();
    await fixture.whenStable();

    const citation = host().querySelector('[data-testid="citation"]')!;
    expect((citation.textContent ?? '').replace(/\s+/g, ' ')).toContain(
      'Ashkeyev, Ali (2026). Currency Allocation of Household Liquid Savings under Multi-Currency Cash Flows: A Simulation Study Using Kazakhstan Exchange-Rate Data. SSRN preprint.',
    );
    const link = citation.querySelector<HTMLAnchorElement>('[data-testid="citation-link"]')!;
    expect(link.getAttribute('href')).toBe(SSRN_URL);
    expect(link.textContent?.trim()).toBe(SSRN_URL);
  });

  it('points the calculator CTA to /research/calculator', async () => {
    fixture.detectChanges();
    http.expectOne('/api/v1/model/metadata/').flush(MODEL_METADATA);
    fixture.detectChanges();
    await fixture.whenStable();

    const cta = host().querySelector<HTMLAnchorElement>('[data-testid="research-assessment-cta"]')!;
    expect(cta.getAttribute('href')).toBe('/research/calculator');
  });

  it('keeps publication and conference content visible when metadata fails', async () => {
    fixture.detectChanges();
    http
      .expectOne('/api/v1/model/metadata/')
      .flush(
        { error: { code: 'unavailable', message: 'down' } },
        { status: 503, statusText: 'Service Unavailable' },
      );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(text()).toContain(EN_STRINGS.research.metadataUnavailableTitle);
    const preprint = host().querySelector('[data-testid="preprint-card"]');
    expect(preprint?.querySelector('[data-testid="publication-link"]')?.getAttribute('href')).toBe(
      SSRN_URL,
    );
    expect(host().querySelector('[data-testid="conference-card"]')).toBeTruthy();
    expect(host().querySelector('[data-testid="citation-link"]')).toBeTruthy();
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
    http
      .expectOne('/api/v1/model/metadata/')
      .flush(
        { error: { code: 'unavailable', message: 'down' } },
        { status: 503, statusText: 'Service Unavailable' },
      );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(text()).toContain(EN_STRINGS.research.metadataUnavailableTitle);
    expect(text()).toContain(EN_STRINGS.research.metadataUnavailableBody);
  });
});
