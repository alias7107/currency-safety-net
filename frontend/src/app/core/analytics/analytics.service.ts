import { DOCUMENT, Injectable, inject } from '@angular/core';

import { ANALYTICS_CONFIG } from '../config/analytics.config';

export type AnalyticsEvent =
  | 'assessment_started'
  | 'assessment_step_completed'
  | 'assessment_overview_viewed'
  | 'personal_simulation_submitted'
  | 'personal_simulation_result_viewed'
  | 'research_calculator_opened';

type ClarityFunction = ((...args: unknown[]) => void) & { q?: unknown[] };
type ClarityWindow = Window & { clarity?: ClarityFunction };

export const CLARITY_SCRIPT_ID = 'csn-clarity-tag';
export const CLARITY_TAG_URL = 'https://www.clarity.ms/tag/';

/**
 * Microsoft Clarity starts on production hosts or with the development opt-in.
 * Clarity follows Angular router (History API) navigation by itself, so no
 * call is made on route changes.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly config = inject(ANALYTICS_CONFIG);
  private readonly document = inject(DOCUMENT);
  private readonly window = this.document.defaultView as ClarityWindow | null;

  /** True on a production host, or on another host with the development opt-in. */
  readonly enabled = this.isEnabledHost();

  private tagInserted = false;
  private active = false;
  private readonly sentOnce = new Set<string>();

  init(): void {
    if (this.enabled) {
      this.start();
    }
  }

  /**
   * Sends a named custom event with no properties. With `onceKey`, the event
   * is sent at most once per key while the app is open; the key itself is
   * never sent.
   */
  track(event: AnalyticsEvent, onceKey?: string): void {
    if (!this.active) {
      return;
    }
    if (onceKey !== undefined) {
      const key = `${event}\u0000${onceKey}`;
      if (this.sentOnce.has(key)) {
        return;
      }
      this.sentOnce.add(key);
    }
    this.call('event', event);
  }

  private start(): void {
    if (this.active) {
      return;
    }
    this.insertTag();
    this.active = true;
  }

  /** The official Clarity installation snippet, inserted at most once. */
  private insertTag(): void {
    const w = this.window;
    if (this.tagInserted || !w) {
      return;
    }
    this.tagInserted = true;
    try {
      w.clarity =
        w.clarity ||
        function () {
          const clarity = w.clarity as ClarityFunction;
          (clarity.q = clarity.q || []).push(arguments);
        };
      if (this.document.getElementById(CLARITY_SCRIPT_ID)) {
        return;
      }
      const tag = this.document.createElement('script');
      tag.id = CLARITY_SCRIPT_ID;
      tag.async = true;
      tag.src = CLARITY_TAG_URL + encodeURIComponent(this.config.clarityProjectId);
      const first = this.document.getElementsByTagName('script')[0];
      if (first?.parentNode) {
        first.parentNode.insertBefore(tag, first);
      } else {
        this.document.head.appendChild(tag);
      }
    } catch {
      // Blocked or unavailable: the application continues without analytics.
    }
  }

  private call(...args: unknown[]): void {
    try {
      this.window?.clarity?.(...args);
    } catch {
      // A failing tracker must never affect the application.
    }
  }

  private isEnabledHost(): boolean {
    const host = this.window?.location?.hostname ?? '';
    if (this.config.productionHosts.includes(host)) {
      return true;
    }
    return this.readStorage(this.config.devOptInStorageKey) === 'true';
  }

  private readStorage(key: string): string | null {
    try {
      return this.window?.localStorage.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
}
