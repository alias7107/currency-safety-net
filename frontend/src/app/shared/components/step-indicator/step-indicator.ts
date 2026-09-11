import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { EN_STRINGS } from '../../../core/i18n/en';

export interface StepDescriptor {
  id: string;
  label: string;
  short: string;
}

@Component({
  selector: 'app-step-indicator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="step-indicator" [attr.aria-label]="ariaLabel()">
      <p class="step-indicator__counter">
        {{ strings.common.step }} {{ currentIndex() + 1 }} {{ strings.common.of }}
        {{ steps().length }}
      </p>
      <ol class="step-indicator__list">
        @for (step of steps(); track step.id; let i = $index) {
          <li
            class="step-indicator__item"
            [class.is-current]="i === currentIndex()"
            [class.is-complete]="i < currentIndex()"
            [attr.aria-current]="i === currentIndex() ? 'step' : null"
          >
            <span class="step-indicator__marker" aria-hidden="true">
              @if (i < currentIndex()) {
                <svg viewBox="0 0 16 16" width="12" height="12" focusable="false">
                  <path
                    d="M3 8.5l3.2 3.2L13 5"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.4"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              } @else {
                {{ i + 1 }}
              }
            </span>
            <span class="step-indicator__label">{{ step.short }}</span>
          </li>
        }
      </ol>
    </nav>
  `,
})
export class StepIndicator {
  readonly steps = input.required<readonly StepDescriptor[]>();
  readonly currentIndex = input<number>(0);
  readonly label = input<string | null>(null);

  protected readonly strings = EN_STRINGS;
  protected readonly ariaLabel = computed(() => this.label() ?? EN_STRINGS.calculator.title);
}
