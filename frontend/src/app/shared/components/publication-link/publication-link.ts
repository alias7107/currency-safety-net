import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { EN_STRINGS } from '../../../core/i18n/en';

/**
 * Renders either a safe external paper link or a placeholder.
 * Never emits a broken `<a href="">` when the URL is unset.
 */
@Component({
  selector: 'app-publication-link',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (safeUrl(); as href) {
      <a
        class="publication-link"
        data-testid="publication-link"
        [href]="href"
        target="_blank"
        rel="noopener noreferrer"
        >{{ strings.research.publication.linkLabel }}</a
      >
    } @else {
      <p class="publication-link publication-link--pending" data-testid="publication-placeholder">
        {{ strings.research.publication.placeholder }}
      </p>
    }
  `,
})
export class PublicationLink {
  /** Nullable HTTPS URL for the published paper. */
  readonly url = input<string | null>(null);

  protected readonly strings = EN_STRINGS;

  protected readonly safeUrl = computed(() => {
    const value = this.url()?.trim() ?? '';
    if (!value) {
      return null;
    }
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'https:') {
        return null;
      }
      return parsed.toString();
    } catch {
      return null;
    }
  });
}
