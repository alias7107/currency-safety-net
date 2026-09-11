import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { EN_STRINGS } from '../../core/i18n/en';
import {
  COMPARISON_STORAGE_KEY,
  ScenarioComparisonStore,
} from '../../core/state/scenario-comparison.store';
import { interpolate } from '../../core/util/format.util';
import { OPTIMIZATION_RESULT, TEST_JOB_ID } from '../../testing/fixtures';
import { ComparePage } from './compare.page';

describe('ComparePage', () => {
  let fixture: ComponentFixture<ComparePage>;
  let comparison: ScenarioComparisonStore;
  let router: Router;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'compare', component: ComparePage }])],
    });
    comparison = TestBed.inject(ScenarioComparisonStore);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  function create(): void {
    fixture = TestBed.createComponent(ComparePage);
    fixture.detectChanges();
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

  function expectedLabel(index: number, profileTitle: string): string {
    return interpolate(EN_STRINGS.compare.scenarioLabel, {
      number: index + 1,
      profile: profileTitle,
    });
  }

  it('shows the empty state with a CTA to assessment', async () => {
    create();
    expect(host().querySelector('[data-testid="compare-empty"]')).toBeTruthy();
    expect(text()).toContain(EN_STRINGS.compare.emptyBody);
    const cta = host().querySelector<HTMLAnchorElement>('[data-testid="compare-empty-cta"]');
    expect(cta?.getAttribute('href')).toContain('/assessment');
    expect(text()).toContain(EN_STRINGS.compare.scopeCallout);
  });

  it('explains that a second scenario is needed when only one is saved', () => {
    comparison.add(TEST_JOB_ID, OPTIMIZATION_RESULT);
    create();
    expect(host().querySelector('[data-testid="compare-one"]')).toBeTruthy();
    expect(text()).toContain(EN_STRINGS.compare.oneBody);
    expect(text()).toContain(expectedLabel(0, EN_STRINGS.profiles.P2.title));
    expect(text()).not.toContain('P2_foreign_income_mismatch');
  });

  it('gives unique labels to two scenarios that share a profile', () => {
    comparison.add('job-a', OPTIMIZATION_RESULT);
    comparison.add('job-b', {
      ...OPTIMIZATION_RESULT,
      horizon_years: 5,
      buffer_months: 6,
      weights: [0.5, 0.3, 0.2],
    });
    create();

    const label1 = expectedLabel(0, EN_STRINGS.profiles.P2.title);
    const label2 = expectedLabel(1, EN_STRINGS.profiles.P2.title);
    expect(label1).not.toBe(label2);

    const titles = Array.from(host().querySelectorAll('.compare-card__title')).map((node) =>
      (node.textContent ?? '').trim(),
    );
    expect(titles).toEqual([label1, label2]);

    const headers = Array.from(
      host().querySelectorAll('[data-testid="compare-column-header"]'),
    ).map((node) => (node.textContent ?? '').trim());
    expect(headers).toEqual([label1, label2]);

    const removeLabels = Array.from(
      host().querySelectorAll<HTMLButtonElement>('[data-testid="compare-remove"]'),
    ).map((button) => button.getAttribute('aria-label'));
    expect(removeLabels[0]).toContain(label1);
    expect(removeLabels[1]).toContain(label2);
    expect(text()).not.toContain('P2_foreign_income_mismatch');
  });

  it('uses neutral copy when the profile cannot be mapped', () => {
    comparison.add('job-x', {
      ...OPTIMIZATION_RESULT,
      profile: 'unknown_internal_name',
    });
    create();
    expect(text()).toContain(expectedLabel(0, EN_STRINGS.compare.profileUnavailable));
    expect(text()).not.toContain('unknown_internal_name');
  });

  it('renders a desktop comparison table with column headers', () => {
    comparison.add('job-a', OPTIMIZATION_RESULT);
    comparison.add('job-b', {
      ...OPTIMIZATION_RESULT,
      profile: 'P1_local_control',
      weights: [0.5, 0.3, 0.2],
      horizon_years: 5,
    });
    create();

    const table = host().querySelector('[data-testid="compare-metrics-table"]');
    expect(table).toBeTruthy();
    expect(table?.getAttribute('role')).toBe('table');

    const headerRow = table?.querySelector('.compare-metrics__row--header');
    expect(headerRow?.getAttribute('role')).toBe('row');
    const columnHeaders = headerRow?.querySelectorAll('[role="columnheader"]');
    expect(columnHeaders?.length).toBe(3);
    expect(columnHeaders?.[0]?.textContent?.trim()).toBe(EN_STRINGS.compare.metricColumn);
    expect(columnHeaders?.[1]?.textContent?.trim()).toBe(
      expectedLabel(0, EN_STRINGS.profiles.P2.title),
    );
    expect(columnHeaders?.[2]?.textContent?.trim()).toBe(
      expectedLabel(1, EN_STRINGS.profiles.P1.title),
    );
  });

  it('renders two and three scenarios with accessible allocation text', () => {
    comparison.add('job-a', OPTIMIZATION_RESULT);
    comparison.add('job-b', {
      ...OPTIMIZATION_RESULT,
      profile: 'P1_local_control',
      weights: [0.5, 0.3, 0.2],
      horizon_years: 5,
    });
    create();
    expect(host().querySelector('[data-testid="compare-multi"]')).toBeTruthy();
    const allocations = host().querySelectorAll('[data-testid="compare-allocation-text"]');
    expect(allocations.length).toBeGreaterThanOrEqual(2);
    expect(allocations[0]?.textContent).toMatch(/KZT/);
    expect(allocations[0]?.textContent).toMatch(/USD/);
    expect(allocations[0]?.textContent).toMatch(/EUR/);
    expect(text()).toContain(EN_STRINGS.profiles.P1.title);
    expect(text()).toContain(EN_STRINGS.profiles.P2.title);

    comparison.add('job-c', {
      ...OPTIMIZATION_RESULT,
      profile: 'P3_mixed_income',
      model_version: '1.0.0',
    });
    fixture.detectChanges();
    expect(host().querySelectorAll('[data-testid^="compare-card-"]').length).toBe(3);
  });

  it('removes a scenario from the comparison', () => {
    comparison.add('job-a', OPTIMIZATION_RESULT);
    comparison.add('job-b', { ...OPTIMIZATION_RESULT, profile: 'P1_local_control' });
    create();
    const remove = host().querySelectorAll<HTMLButtonElement>('[data-testid="compare-remove"]')[0];
    remove.click();
    fixture.detectChanges();
    expect(comparison.count()).toBe(1);
    expect(host().querySelector('[data-testid="compare-one"]')).toBeTruthy();
  });

  it('clears all scenarios through an in-app confirmation', async () => {
    comparison.add('job-a', OPTIMIZATION_RESULT);
    comparison.add('job-b', { ...OPTIMIZATION_RESULT, profile: 'P1_local_control' });
    create();
    const clearButton = host().querySelector<HTMLButtonElement>('[data-testid="compare-clear"]')!;
    clearButton.focus();
    clearButton.click();
    await settle();
    expect(host().querySelector('[data-testid="compare-clear-dialog"]')).toBeTruthy();
    host().querySelector<HTMLButtonElement>('[data-testid="compare-clear-confirm"]')!.click();
    await settle();
    expect(comparison.count()).toBe(0);
    expect(host().querySelector('[data-testid="compare-empty"]')).toBeTruthy();
  });

  it('moves focus into the clear dialog and restores it on Escape', async () => {
    comparison.add('job-a', OPTIMIZATION_RESULT);
    comparison.add('job-b', { ...OPTIMIZATION_RESULT, profile: 'P1_local_control' });
    create();

    const clearButton = host().querySelector<HTMLButtonElement>('[data-testid="compare-clear"]')!;
    clearButton.focus();
    clearButton.click();
    await settle();

    const confirm = host().querySelector<HTMLButtonElement>(
      '[data-testid="compare-clear-confirm"]',
    )!;
    expect(document.activeElement).toBe(confirm);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();

    expect(host().querySelector('[data-testid="compare-clear-dialog"]')).toBeNull();
    expect(comparison.count()).toBe(2);
    expect(document.activeElement).toBe(clearButton);
  });

  it('keeps Tab focus inside the clear dialog', async () => {
    comparison.add('job-a', OPTIMIZATION_RESULT);
    comparison.add('job-b', { ...OPTIMIZATION_RESULT, profile: 'P1_local_control' });
    create();

    host().querySelector<HTMLButtonElement>('[data-testid="compare-clear"]')!.click();
    await settle();

    const confirm = host().querySelector<HTMLButtonElement>(
      '[data-testid="compare-clear-confirm"]',
    )!;
    const cancel = host().querySelector<HTMLButtonElement>('[data-testid="compare-clear-cancel"]')!;
    confirm.focus();

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    // Native tab order is not fully simulated in jsdom; exercise the trap on the last control.
    cancel.focus();
    const tabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(tabEvent);
    await settle();
    expect(document.activeElement).toBe(confirm);

    confirm.focus();
    const shiftTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(shiftTab);
    await settle();
    expect(document.activeElement).toBe(cancel);
  });

  it('cancels the clear dialog without removing scenarios', async () => {
    comparison.add('job-a', OPTIMIZATION_RESULT);
    comparison.add('job-b', { ...OPTIMIZATION_RESULT, profile: 'P1_local_control' });
    create();
    const clearButton = host().querySelector<HTMLButtonElement>('[data-testid="compare-clear"]')!;
    clearButton.click();
    await settle();
    host().querySelector<HTMLButtonElement>('[data-testid="compare-clear-cancel"]')!.click();
    await settle();
    expect(comparison.count()).toBe(2);
    expect(host().querySelector('[data-testid="compare-clear-dialog"]')).toBeNull();
  });

  it('warns when saved scenarios have mismatched provenance', () => {
    comparison.add('job-a', OPTIMIZATION_RESULT);
    comparison.add('job-b', {
      ...OPTIMIZATION_RESULT,
      profile: 'P1_local_control',
      model_version: '9.9.9',
      data_as_of: '2010-01-01',
    });
    create();
    expect(host().querySelector('[data-testid="provenance-warning"]')).toBeTruthy();
    expect(text()).toContain(EN_STRINGS.compare.provenanceWarningHeading);
    expect(text()).toContain('9.9.9');
    expect(text()).toContain('2010-01-01');
  });

  it('does not claim a winner or personal recommendation', () => {
    comparison.add('job-a', OPTIMIZATION_RESULT);
    comparison.add('job-b', { ...OPTIMIZATION_RESULT, profile: 'P1_local_control' });
    create();
    const lowered = text().toLowerCase();
    expect(lowered).not.toContain('best for you');
    expect(lowered).not.toContain('recommended');
    expect(lowered).not.toContain('winner');
    expect(lowered).not.toContain('resilience score');
    expect(text()).toContain(EN_STRINGS.compare.scopeCallout);
  });

  it('loads via the compare route', async () => {
    await router.navigateByUrl('/compare');
    expect(router.url).toBe('/compare');
  });

  it('shows model provenance fields for saved scenarios', () => {
    comparison.add(TEST_JOB_ID, OPTIMIZATION_RESULT);
    create();
    expect(text()).toContain(OPTIMIZATION_RESULT.model_version);
    expect(text()).toContain(OPTIMIZATION_RESULT.data_as_of);
    expect(text()).toContain('10,000');
    expect(text()).toContain('42');
  });

  it('survives a refresh from session storage', () => {
    comparison.add(TEST_JOB_ID, OPTIMIZATION_RESULT);
    expect(sessionStorage.getItem(COMPARISON_STORAGE_KEY)).toBeTruthy();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'compare', component: ComparePage }])],
    });
    fixture = TestBed.createComponent(ComparePage);
    fixture.detectChanges();
    expect(host().querySelector('[data-testid="compare-one"]')).toBeTruthy();
  });
});
