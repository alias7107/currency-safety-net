import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import type { ApiError } from '../../../core/api/models';
import { EN_STRINGS } from '../../../core/i18n/en';

interface ErrorCopy {
  title: string;
  body: string;
}

/**
 * Single error surface for every failure mode. Copy is chosen from the HTTP
 * status so that a rate limit never reads like a validation failure.
 */
@Component({
  selector: 'app-error-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="error-panel" role="alert" [attr.aria-labelledby]="titleId">
      <span class="error-panel__icon" aria-hidden="true">
        <svg viewBox="0 0 20 20" width="20" height="20" focusable="false">
          <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6" />
          <path
            d="M10 5.8v5M10 13.6h.01"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
      </span>

      <div class="error-panel__body stack stack--3">
        <h2 class="error-panel__title" [id]="titleId">{{ copy().title }}</h2>
        <p>{{ copy().body }}</p>

        @if (serverMessage(); as message) {
          <p class="error-panel__server-message">{{ message }}</p>
        }

        @if (fieldMessages().length) {
          <ul class="error-panel__fields">
            @for (message of fieldMessages(); track message) {
              <li>{{ message }}</li>
            }
          </ul>
        }

        <div class="error-panel__actions">
          @if (showRetry()) {
            <button type="button" class="button button--secondary" (click)="retry.emit()">
              {{ retryLabel() ?? strings.common.retry }}
            </button>
          }
          <ng-content />
        </div>

        @if (hasDetails()) {
          <div class="error-panel__details">
            <button
              type="button"
              class="button-link"
              [attr.aria-expanded]="detailsOpen()"
              [attr.aria-controls]="detailsId"
              (click)="toggleDetails()"
            >
              {{ strings.errors.detailsToggle }}
            </button>
            @if (detailsOpen()) {
              <pre class="error-panel__pre" [id]="detailsId">{{ detailsText() }}</pre>
            }
          </div>
        }
      </div>
    </section>
  `,
})
export class ErrorPanel {
  readonly error = input<ApiError | null>(null);
  readonly showRetry = input<boolean>(true);
  readonly retryLabel = input<string | null>(null);

  readonly retry = output<void>();

  protected readonly strings = EN_STRINGS;
  protected readonly titleId = `error-panel-title-${nextId()}`;
  protected readonly detailsId = `error-panel-details-${nextId()}`;
  protected readonly detailsOpen = signal(false);

  protected readonly copy = computed<ErrorCopy>(() => {
    const status = this.error()?.status ?? 0;
    const e = EN_STRINGS.errors;
    switch (status) {
      case 0:
        return { title: e.networkTitle, body: e.networkBody };
      case 400:
      case 422:
        return { title: e.validationTitle, body: e.validationBody };
      case 404:
        return { title: e.notFoundTitle, body: e.notFoundBody };
      case 429:
        return { title: e.rateLimitTitle, body: e.rateLimitBody };
      case 502:
      case 503:
      case 504:
        return { title: e.unavailableTitle, body: e.unavailableBody };
      default:
        return status >= 500
          ? { title: e.serverTitle, body: e.serverBody }
          : { title: e.genericTitle, body: e.genericBody };
    }
  });

  protected readonly serverMessage = computed(() => {
    const error = this.error();
    if (!error?.message) {
      return null;
    }
    // Raw transport messages are noise; only show server-authored text.
    return error.status === 0 ? null : error.message;
  });

  /** Flatten DRF's `{field: [messages]}` details into a readable list. */
  protected readonly fieldMessages = computed<string[]>(() => {
    const details = this.error()?.details;
    if (!details || typeof details !== 'object') {
      return [];
    }
    const out: string[] = [];
    for (const [field, value] of Object.entries(details as Record<string, unknown>)) {
      const messages = Array.isArray(value) ? value : [value];
      for (const message of messages) {
        if (typeof message === 'string') {
          out.push(field === 'non_field_errors' ? message : `${humanizeField(field)}: ${message}`);
        }
      }
    }
    return out;
  });

  protected readonly hasDetails = computed(
    () => this.error()?.details !== undefined && this.fieldMessages().length === 0,
  );

  protected readonly detailsText = computed(() => {
    try {
      return JSON.stringify(this.error()?.details, null, 2);
    } catch {
      return String(this.error()?.details);
    }
  });

  protected toggleDetails(): void {
    this.detailsOpen.update((open) => !open);
  }
}

function humanizeField(field: string): string {
  return field.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

let idCounter = 0;
function nextId(): number {
  return ++idCounter;
}
