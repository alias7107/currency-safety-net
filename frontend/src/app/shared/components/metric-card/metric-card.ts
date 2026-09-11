import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** One model output with its unit and a plain-language explanation. */
@Component({
  selector: 'app-metric-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="metric-card" [class.metric-card--primary]="emphasis()">
      <p class="metric-card__label">{{ label() }}</p>
      <p class="metric-card__value" data-testid="metric-value">
        {{ value() }}
        @if (unit()) {
          <span class="metric-card__unit">{{ unit() }}</span>
        }
      </p>
      <p class="metric-card__explanation">{{ explanation() }}</p>
    </div>
  `,
})
export class MetricCard {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly explanation = input.required<string>();
  readonly unit = input<string | null>(null);
  readonly emphasis = input<boolean>(false);
}
