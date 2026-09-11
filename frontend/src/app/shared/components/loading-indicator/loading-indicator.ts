import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { EN_STRINGS } from '../../../core/i18n/en';

/**
 * Indeterminate progress only. No synthetic percentage is shown, because the
 * backend reports job state and not completion fraction.
 */
@Component({
  selector: 'app-loading-indicator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="loading" [class.loading--inline]="inline()">
      <span class="loading__spinner" aria-hidden="true"></span>
      <span [class.visually-hidden]="hideLabel()" class="loading__label">{{ resolvedLabel() }}</span>
    </div>
  `,
})
export class LoadingIndicator {
  readonly label = input<string | null>(null);
  readonly inline = input<boolean>(false);
  readonly hideLabel = input<boolean>(false);

  protected resolvedLabel(): string {
    return this.label() ?? EN_STRINGS.common.loading;
  }
}
