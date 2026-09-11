import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Non-semantic placeholder; the accessible status lives in LoadingIndicator. */
@Component({
  selector: 'app-skeleton-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="skeleton-card" aria-hidden="true">
      @for (line of lineArray(); track $index) {
        <span class="skeleton-card__line" [style.width.%]="line"></span>
      }
    </div>
  `,
})
export class SkeletonCard {
  readonly lines = input<number>(3);

  protected lineArray(): number[] {
    const widths = [92, 74, 60, 84, 48];
    return Array.from({ length: Math.max(1, this.lines()) }, (_, i) => widths[i % widths.length]);
  }
}
