import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type CalloutTone = 'neutral' | 'accent' | 'warning';

@Component({
  selector: 'app-info-callout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="callout" [class]="'callout callout--' + tone()">
      <span class="callout__icon" aria-hidden="true">
        <svg viewBox="0 0 20 20" width="18" height="18" focusable="false">
          <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6" />
          <path
            d="M10 9v5M10 6.2h.01"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linecap="round"
          />
        </svg>
      </span>
      <div class="callout__body">
        @if (heading()) {
          <p class="callout__heading">{{ heading() }}</p>
        }
        @if (body()) {
          <p>{{ body() }}</p>
        }
        <ng-content />
      </div>
    </aside>
  `,
})
export class InfoCallout {
  readonly heading = input<string | null>(null);
  readonly body = input<string | null>(null);
  readonly tone = input<CalloutTone>('neutral');
}
