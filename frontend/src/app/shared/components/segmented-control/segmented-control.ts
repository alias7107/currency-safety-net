import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { EN_STRINGS } from '../../../core/i18n/en';

export interface SegmentedOption<T = string | number> {
  value: T;
  label: string;
  /** Marks the value used in the published research run. */
  baseline?: boolean;
}

/**
 * Single-choice control restricted to values documented by the research. Built
 * from native radios inside a fieldset so that arrow-key navigation, grouping
 * and labelling are handled by the browser.
 */
@Component({
  selector: 'app-segmented-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="segmented" role="group">
      @for (option of options(); track option.value) {
        <label
          class="segmented__option"
          [class.is-selected]="isSelected(option)"
          [class.is-baseline]="option.baseline"
        >
          <input
            class="segmented__input"
            type="radio"
            [name]="groupName()"
            [value]="option.value"
            [checked]="isSelected(option)"
            [disabled]="disabled()"
            (change)="valueChange.emit(option.value)"
          />
          <span class="segmented__label">{{ option.label }}</span>
          @if (option.baseline) {
            <span class="segmented__baseline" [title]="strings.common.baselineTitle">
              {{ strings.common.baseline }}
            </span>
          }
        </label>
      }
    </div>
  `,
})
export class SegmentedControl {
  readonly options = input.required<readonly SegmentedOption[]>();
  readonly value = input<string | number | null>(null);
  readonly groupName = input.required<string>();
  readonly disabled = input<boolean>(false);

  readonly valueChange = output<string | number>();

  protected readonly strings = EN_STRINGS;

  protected isSelected(option: SegmentedOption): boolean {
    return option.value === this.value();
  }
}
