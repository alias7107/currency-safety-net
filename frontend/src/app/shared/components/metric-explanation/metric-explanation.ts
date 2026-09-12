import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { EN_STRINGS } from '../../../core/i18n/en';

@Component({
  selector: 'app-metric-explanation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="metric-explanation"
      [attr.data-metric]="metricKey()"
      data-testid="metric-explanation"
    >
      <h3 class="metric-explanation__label">{{ label() }}</h3>
      <p class="metric-explanation__value" data-testid="metric-explanation-value">
        {{ value() }}
        @if (unit()) {
          <span class="metric-explanation__unit">{{ unit() }}</span>
        }
      </p>
      <p class="metric-explanation__definition">{{ definition() }}</p>
      @if (note()) {
        <p class="metric-explanation__note" data-testid="metric-explanation-note">{{ note() }}</p>
      }
      @if (howToRead()) {
        @if (alwaysExpanded()) {
          <div class="metric-explanation__expanded" data-testid="metric-explanation-expanded">
            <p class="metric-explanation__how-label">{{ strings.results.phase2b.howToRead }}</p>
            <p>{{ howToRead() }}</p>
          </div>
        } @else {
          <details class="metric-explanation__details">
            <summary>{{ strings.results.phase2b.howToRead }}</summary>
            <p>{{ howToRead() }}</p>
          </details>
        }
      }
    </article>
  `,
})
export class MetricExplanation {
  readonly metricKey = input.required<string>();
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly definition = input.required<string>();
  readonly unit = input<string | null>(null);
  readonly howToRead = input<string | null>(null);
  readonly note = input<string | null>(null);
  /** When true, show “How to read this” inline (print / report). */
  readonly alwaysExpanded = input(false);

  protected readonly strings = EN_STRINGS;
}
