import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Consistent eyebrow + heading + lede block used at the top of every section. */
@Component({
  selector: 'app-section-heading',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="section-heading">
      @if (eyebrow()) {
        <p class="section-heading__eyebrow">{{ eyebrow() }}</p>
      }
      @if (level() === 1) {
        <h1 [id]="headingId()" class="section-heading__title">{{ heading() }}</h1>
      } @else if (level() === 2) {
        <h2 [id]="headingId()" class="section-heading__title">{{ heading() }}</h2>
      } @else {
        <h3 [id]="headingId()" class="section-heading__title">{{ heading() }}</h3>
      }
      @if (body()) {
        <p class="section-heading__body">{{ body() }}</p>
      }
    </div>
  `,
})
export class SectionHeading {
  readonly heading = input.required<string>();
  readonly headingId = input<string | null>(null);
  readonly eyebrow = input<string | null>(null);
  readonly body = input<string | null>(null);
  readonly level = input<1 | 2 | 3>(2);
}
