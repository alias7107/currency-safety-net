import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EN_STRINGS } from '../../../core/i18n/en';
import { PublicationLink } from './publication-link';

describe('PublicationLink', () => {
  let fixture: ComponentFixture<PublicationLink>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PublicationLink] }).compileComponents();
    fixture = TestBed.createComponent(PublicationLink);
  });

  it('shows a placeholder when the paper URL is null', () => {
    fixture.componentRef.setInput('url', null);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="publication-placeholder"]')?.textContent).toContain(
      EN_STRINGS.research.publication.placeholder,
    );
    expect(host.querySelector('[data-testid="publication-link"]')).toBeNull();
  });

  it('renders a safe external link for a valid HTTPS URL', () => {
    fixture.componentRef.setInput('url', 'https://example.org/paper');
    fixture.detectChanges();

    const anchor = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="publication-link"]',
    ) as HTMLAnchorElement;
    expect(anchor).toBeTruthy();
    expect(anchor.getAttribute('href')).toBe('https://example.org/paper');
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
    expect(anchor.textContent).toContain(EN_STRINGS.research.publication.linkLabel);
  });

  it('rejects non-HTTPS URLs and shows the placeholder instead', () => {
    fixture.componentRef.setInput('url', 'http://insecure.example/paper');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="publication-link"]')).toBeNull();
    expect(host.querySelector('[data-testid="publication-placeholder"]')).toBeTruthy();
  });
});
