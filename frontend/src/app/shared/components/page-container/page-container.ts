import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type PageContainerSize = 'default' | 'narrow' | 'wide';

/** Horizontal layout constraint shared by every page section. */
@Component({
  selector: 'app-page-container',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [class]="cssClass()">
      <ng-content />
    </div>
  `,
})
export class PageContainer {
  readonly size = input<PageContainerSize>('default');

  protected readonly cssClass = computed(() =>
    this.size() === 'default' ? 'page-container' : `page-container page-container--${this.size()}`,
  );
}
