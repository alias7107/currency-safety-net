import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EN_STRINGS } from '../../../core/i18n/en';
import { OPTIMIZATION_RESULT } from '../../../testing/fixtures';
import { ResilienceProfile } from './resilience-profile';

describe('ResilienceProfile', () => {
  let fixture: ComponentFixture<ResilienceProfile>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ResilienceProfile],
    }).compileComponents();
    fixture = TestBed.createComponent(ResilienceProfile);
    fixture.componentRef.setInput('result', OPTIMIZATION_RESULT);
    fixture.detectChanges();
  });

  function text(): string {
    return fixture.nativeElement.textContent ?? '';
  }

  it('renders every displayed number from the supplied result', () => {
    expect(
      fixture.nativeElement.querySelector('[data-testid="resilience-objective-value"]')
        ?.textContent,
    ).toContain('0.86');
    expect(text()).toContain('7.34%');
    expect(text()).toContain('1.25%');
    expect(text()).toContain('0.42');
    expect(text()).toContain('0.05');
    expect(text()).toContain('31');
    expect(text()).toContain('2.1%');
  });

  it('identifies CVaR95 as the only objective and keeps diagnostics separate', () => {
    expect(text()).toContain(EN_STRINGS.resilienceProfile.objective.badge);
    expect(text()).toContain(EN_STRINGS.resilienceProfile.notScoreNote);
    expect(
      fixture.nativeElement.querySelector('[data-testid="resilience-not-score"]'),
    ).toBeTruthy();
    expect(text().toLowerCase()).not.toContain('jointly optimized combination');
    expect(text().toLowerCase()).not.toMatch(/\byour resilience score\b|\brecommended buffer\b/);
  });

  it('marks depletion as implementation-only and end-of-horizon', () => {
    const depletion = fixture.nativeElement.querySelector(
      '[data-testid="resilience-depletion"]',
    ) as HTMLElement;
    expect(depletion.textContent).toContain(EN_STRINGS.resilienceProfile.depletion.badge);
    expect(depletion.textContent?.toLowerCase()).toContain('end of the selected horizon');
  });

  it('does not expose unknown identification class names', () => {
    fixture.componentRef.setInput('result', {
      ...OPTIMIZATION_RESULT,
      identification_class: 'Z_INTERNAL_UNKNOWN_CLASS',
    });
    fixture.detectChanges();
    expect(text()).not.toContain('Z_INTERNAL_UNKNOWN_CLASS');
    expect(
      fixture.nativeElement.querySelector('[data-testid="resilience-identification-label"]')
        ?.textContent,
    ).toContain(EN_STRINGS.common.notAvailable);
  });

  it('shows the zero-VaR note when VaR95 is zero and CVaR remains positive', () => {
    fixture.componentRef.setInput('result', {
      ...OPTIMIZATION_RESULT,
      var95_cumulative_shortfall: 0,
    });
    fixture.detectChanges();
    expect(text()).toContain(EN_STRINGS.results.phase2b.diagnostics.var95.zeroNote);
  });
});
