import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { BufferSensitivityResult } from '../../../core/api/models';
import { BUFFER_SENSITIVITY_RESULT } from '../../../testing/buffer-sensitivity.fixtures';
import { DiscreteBufferChart, computeDiscreteBarHeights } from './discrete-buffer-chart';

describe('computeDiscreteBarHeights', () => {
  it('maps zero to exactly zero and scales positives linearly', () => {
    expect(computeDiscreteBarHeights([0.12, 0, 0.06, 0.03])).toEqual([100, 0, 50, 25]);
  });

  it('keeps all-zero series at zero height', () => {
    expect(computeDiscreteBarHeights([0, 0, 0, 0])).toEqual([0, 0, 0, 0]);
  });
});

describe('DiscreteBufferChart', () => {
  let fixture: ComponentFixture<DiscreteBufferChart>;

  function create(result: BufferSensitivityResult = BUFFER_SENSITIVITY_RESULT): void {
    fixture = TestBed.createComponent(DiscreteBufferChart);
    fixture.componentRef.setInput('result', result);
    fixture.detectChanges();
  }

  function barHeights(): number[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.discrete-chart__bar')).map((node) =>
      Number((node as HTMLElement).getAttribute('data-height')),
    );
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DiscreteBufferChart],
    }).compileComponents();
  });

  it('renders mixed positive and zero values with truthful heights and labels', () => {
    const mixed: BufferSensitivityResult = {
      ...BUFFER_SENSITIVITY_RESULT,
      results: BUFFER_SENSITIVITY_RESULT.results.map((row, index) => ({
        ...row,
        shortfall_probability: [0.12, 0, 0.06, 0.03][index]!,
        cvar95_cumulative_shortfall: [1.2, 0, 0.6, 0.3][index]!,
      })),
    };
    create(mixed);
    expect(barHeights()).toEqual([100, 0, 50, 25]);
    const zeroBar = fixture.nativeElement.querySelectorAll(
      '.discrete-chart__bar',
    )[1] as HTMLElement;
    expect(zeroBar.style.height).toBe('0%');
    expect(fixture.nativeElement.textContent).toContain('12%');
    expect(fixture.nativeElement.textContent).toContain('0%');
  });

  it('renders all-zero values with zero bar height for both metrics', () => {
    const zeros: BufferSensitivityResult = {
      ...BUFFER_SENSITIVITY_RESULT,
      results: BUFFER_SENSITIVITY_RESULT.results.map((row) => ({
        ...row,
        shortfall_probability: 0,
        cvar95_cumulative_shortfall: 0,
      })),
    };
    create(zeros);
    expect(barHeights().every((height) => height === 0)).toBe(true);

    const radios = fixture.nativeElement.querySelectorAll(
      'input[name="buffer-sensitivity-metric"]',
    ) as NodeListOf<HTMLInputElement>;
    radios[1]!.checked = true;
    radios[1]!.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(barHeights().every((height) => height === 0)).toBe(true);
  });

  it('switches metrics and keeps an accessible table alternative', () => {
    create();
    expect(
      fixture.nativeElement.querySelector('[data-testid="discrete-chart-sr-wrap"]'),
    ).toBeTruthy();
    expect(
      fixture.nativeElement.querySelector('[data-testid="discrete-chart-sr-table"]'),
    ).toBeTruthy();
    expect(
      fixture.nativeElement
        .querySelector('[data-testid="discrete-chart-sr-table"]')
        ?.classList.contains('visually-hidden'),
    ).toBe(false);

    const radios = fixture.nativeElement.querySelectorAll(
      'input[name="buffer-sensitivity-metric"]',
    ) as NodeListOf<HTMLInputElement>;
    radios[1]!.checked = true;
    radios[1]!.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('months of income');
  });
});
