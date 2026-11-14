import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ANALYTICS_CONFIG, DEFAULT_ANALYTICS_CONFIG } from '../../../core/config/analytics.config';
import { EN_STRINGS } from '../../../core/i18n/en';
import { AppFooter } from './app-footer';

describe('AppFooter analytics notice', () => {
  beforeEach(() => localStorage.clear());

  function render(production: boolean): HTMLElement {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: ANALYTICS_CONFIG,
          useValue: {
            ...DEFAULT_ANALYTICS_CONFIG,
            productionHosts: production ? [window.location.hostname] : [],
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(AppFooter);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows a passive notice and privacy link without consent controls', () => {
    const host = render(true);
    const notice = host.querySelector('[data-testid="analytics-notice"]')!;
    expect(notice.textContent).toContain(EN_STRINGS.analytics.footerNotice);
    expect(notice.querySelector('a')?.getAttribute('href')).toBe(
      DEFAULT_ANALYTICS_CONFIG.microsoftPrivacyUrl,
    );
    expect(notice.querySelector('button')).toBeNull();
    expect(host.textContent).not.toMatch(/allow analytics|turn off analytics|decline/i);
  });

  it('does not show analytics controls or a notice on localhost', () => {
    expect(render(false).querySelector('[data-testid="analytics-notice"]')).toBeNull();
  });
});
