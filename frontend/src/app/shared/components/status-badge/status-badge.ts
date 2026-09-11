import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

/**
 * Status is conveyed by an explicit text label and a shape glyph in addition to
 * colour, so the meaning survives without colour perception.
 */
@Component({
  selector: 'app-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="status-badge" [class]="'status-badge status-badge--' + tone()">
      <span class="status-badge__glyph" aria-hidden="true">
        <svg viewBox="0 0 12 12" width="10" height="10" focusable="false">
          @switch (tone()) {
            @case ('success') {
              <path
                d="M2 6.4l2.6 2.6L10 3.4"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            }
            @case ('error') {
              <path
                d="M3 3l6 6M9 3l-6 6"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              />
            }
            @case ('warning') {
              <path
                d="M6 2.5v4M6 9h.01"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              />
            }
            @default {
              <circle cx="6" cy="6" r="3" fill="currentColor" />
            }
          }
        </svg>
      </span>
      <span class="status-badge__label">{{ label() }}</span>
    </span>
  `,
})
export class StatusBadge {
  readonly label = input.required<string>();
  readonly tone = input<StatusTone>('neutral');
}
