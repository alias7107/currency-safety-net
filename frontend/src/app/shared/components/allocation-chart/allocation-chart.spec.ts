import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AllocationChart } from './allocation-chart';

describe('AllocationChart', () => {
  let fixture: ComponentFixture<AllocationChart>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AllocationChart] }).compileComponents();
    fixture = TestBed.createComponent(AllocationChart);
  });

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function render(weights: number[]): void {
    fixture.componentRef.setInput('weights', weights);
    fixture.detectChanges();
  }

  function legendRows(): { currency: string; value: string; text: string }[] {
    const items = host().querySelectorAll<HTMLElement>('[data-testid="allocation-legend-item"]');
    return Array.from(items).map((item) => ({
      currency: item.getAttribute('data-currency') ?? '',
      value:
        item
          .querySelector('[data-testid="allocation-legend-value"]')
          ?.textContent?.trim() ?? '',
      text: (item.textContent ?? '').replace(/\s+/g, ' ').trim(),
    }));
  }

  // Scenario 19: the allocation is readable without relying on colour
  it('lists every currency with its code, full name and share as text', () => {
    render([0.62, 0.27, 0.11]);

    const rows = legendRows();
    expect(rows.map((row) => row.currency)).toEqual(['KZT', 'USD', 'EUR']);
    expect(rows.map((row) => row.value)).toEqual(['62%', '27%', '11%']);

    expect(rows[0].text).toContain('KZT');
    expect(rows[0].text).toContain('Kazakhstani tenge');
    expect(rows[1].text).toContain('US dollar');
    expect(rows[2].text).toContain('Euro');
  });

  it('gives each currency a distinct fill pattern so colour is not the only cue', () => {
    render([0.5, 0.3, 0.2]);

    const patternIds = fixture.componentInstance.segments().map((s) => s.patternId);
    expect(new Set(patternIds).size).toBe(3);

    const defs = host().querySelectorAll('pattern');
    expect(defs.length).toBe(3);
  });

  it('describes the whole allocation in the accessible label', () => {
    render([0.62, 0.27, 0.11]);

    const label: string = fixture.componentInstance.ariaLabel();
    expect(label).toContain('Kazakhstani tenge 62%');
    expect(label).toContain('US dollar 27%');
    expect(label).toContain('Euro 11%');
  });

  it('keeps a zero-weight currency in the legend but draws no segment for it', () => {
    render([0.4, 0.35, 0.25]);

    const rows = legendRows();
    expect(rows.map((row) => row.value)).toEqual(['40%', '35%', '25%']);

    const bars = host().querySelectorAll('[data-testid="allocation-bar-segment"]');
    expect(bars.length).toBe(3);
  });

  it('omits zero-weight currencies from the bar while keeping them in the legend', () => {
    render([0.75, 0.25, 0]);

    const rows = legendRows();
    expect(rows.map((row) => row.value)).toEqual(['75%', '25%', '0%']);

    const bars = host().querySelectorAll('[data-testid="allocation-bar-segment"]');
    expect(bars.length).toBe(2);
    expect(bars[0].getAttribute('data-currency')).toBe('KZT');
    expect(bars[1].getAttribute('data-currency')).toBe('USD');
  });

  it('sizes the bar segments in proportion to the supplied weights', () => {
    render([0.5, 0.25, 0.25]);

    const bars = Array.from(
      host().querySelectorAll<HTMLElement>('[data-testid="allocation-bar-segment"]'),
    );
    expect(bars.map((bar) => bar.style.width)).toEqual(['50%', '25%', '25%']);
  });

  // Scenario 20 (behavioural): output tracks the input, so nothing is fixed
  it('re-renders entirely from the supplied weights', () => {
    render([0.62, 0.27, 0.11]);
    expect(legendRows().map((row) => row.value)).toEqual(['62%', '27%', '11%']);

    render([0.1, 0.2, 0.7]);
    expect(legendRows().map((row) => row.value)).toEqual(['10%', '20%', '70%']);
  });

  it('renders nothing but zeroes when given an empty weight vector', () => {
    render([]);
    expect(legendRows().map((row) => row.value)).toEqual(['0%', '0%', '0%']);
    expect(host().querySelectorAll('[data-testid="allocation-donut-segment"]').length).toBe(0);
  });
});
