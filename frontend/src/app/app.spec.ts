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

  it('exposes an accessible, collapsible navigation menu', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    const toggle = element.querySelector<HTMLButtonElement>('.app-header__toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.getAttribute('aria-controls')).toBe('primary-navigation');

    toggle!.click();
    fixture.detectChanges();
    expect(toggle!.getAttribute('aria-expanded')).toBe('true');
  });

  it('states the scope of the results in the footer', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();

    const footer = (fixture.nativeElement as HTMLElement).querySelector('footer');
    const copy = (footer?.textContent ?? '').replace(/\s+/g, ' ');
    expect(copy).toContain('not exchange-rate forecasts');
    expect(copy).toContain('not investment advice');
  });
});
