import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';
import { EN_STRINGS } from './core/i18n/en';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('creates the application shell', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders semantic landmarks and a skip link', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('header')).toBeTruthy();
    expect(element.querySelector('nav')).toBeTruthy();
    expect(element.querySelector('main#main-content')).toBeTruthy();
    expect(element.querySelector('footer')).toBeTruthy();
    expect(element.querySelector('router-outlet')).toBeTruthy();

    const skipLink = element.querySelector('a.skip-link');
    expect(skipLink?.getAttribute('href')).toBe('#main-content');
    expect(skipLink?.textContent).toContain(EN_STRINGS.app.skipToContent);
  });

  it('exposes product navigation and an accessible mobile menu', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[data-testid="nav-how-it-works"]')).toBeTruthy();
    expect(element.querySelector('[data-testid="nav-who-it-helps"]')).toBeTruthy();
    expect(element.querySelector('[data-testid="nav-research"]')).toBeTruthy();
    expect(element.querySelector('[data-testid="nav-compare"]')).toBeTruthy();
    expect(element.querySelector('[data-testid="nav-primary-cta"]')?.textContent).toContain(
      EN_STRINGS.nav.primaryAction,
    );
    expect(
      element.querySelector('[data-testid="header-logo"]')?.getAttribute('href') || '',
    ).toContain('/');

    const toggle = element.querySelector<HTMLButtonElement>('.app-header__toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.getAttribute('aria-controls')).toBe('primary-navigation');
    expect(getComputedStyle(toggle!).minHeight || toggle!.style.minHeight).toBeDefined();

    toggle!.click();
    fixture.detectChanges();
    expect(toggle!.getAttribute('aria-expanded')).toBe('true');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');
  });

  it('states the scope of the results in the footer', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const footer = (fixture.nativeElement as HTMLElement).querySelector('footer');
    const copy = (footer?.textContent ?? '').replace(/\s+/g, ' ');
    expect(copy).toContain('not exchange-rate forecasts');
    expect(copy).toContain('not investment advice');
    expect(copy).toContain(EN_STRINGS.nav.assessment);
    expect(copy).toContain(EN_STRINGS.nav.compare);
    expect(copy).toContain(EN_STRINGS.nav.research);
    expect(copy).toContain('No account, bank connection, or transactions');
    expect(copy.toLowerCase()).not.toContain('no personal data stored');
  });
});
