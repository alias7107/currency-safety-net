import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { CurrencyCode } from '../../../core/api/models';
import { EN_STRINGS } from '../../../core/i18n/en';
import { formatWeight } from '../../../core/util/format.util';

/** Weights always arrive from the API in this order. */
export const ALLOCATION_CURRENCIES: readonly CurrencyCode[] = ['KZT', 'USD', 'EUR'] as const;

const DONUT_RADIUS = 56;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

export interface AllocationSegment {
  code: CurrencyCode;
  name: string;
  weight: number;
  percentText: string;
  /** Bar width and donut arc length, as a percentage of the whole. */
  widthPercent: number;
  dashArray: string;
  dashOffset: number;
  patternId: string;
}

/**
 * Model allocation shown three ways — a stacked bar, a donut and a text legend.
 * Colour is never the only carrier of meaning: each currency also has a
 * distinct fill pattern, and the legend spells out the code, the full currency
 * name and the share as text.
 */
@Component({
  selector: 'app-allocation-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="allocation">
      <div class="allocation__visuals">
        <svg
          class="allocation__donut"
          viewBox="0 0 140 140"
          role="img"
          [attr.aria-label]="ariaLabel()"
        >
          <defs>
            <pattern
              id="alloc-pattern-KZT"
              patternUnits="userSpaceOnUse"
              width="6"
              height="6"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="transparent" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#ffffff" stroke-width="2.4" />
            </pattern>
            <pattern id="alloc-pattern-USD" patternUnits="userSpaceOnUse" width="6" height="6">
              <rect width="6" height="6" fill="transparent" />
              <circle cx="3" cy="3" r="1.4" fill="#ffffff" />
            </pattern>
            <pattern
              id="alloc-pattern-EUR"
              patternUnits="userSpaceOnUse"
              width="6"
              height="6"
              patternTransform="rotate(-45)"
            >
              <rect width="6" height="6" fill="transparent" />
              <line x1="0" y1="0" x2="6" y2="0" stroke="#ffffff" stroke-width="2" />
            </pattern>
          </defs>

          <circle
            cx="70"
            cy="70"
            [attr.r]="radius"
            fill="none"
            stroke="var(--color-border)"
            stroke-width="20"
          />

          @for (segment of segments(); track segment.code) {
            @if (segment.weight > 0) {
              <g [attr.transform]="'rotate(-90 70 70)'">
                <circle
                  class="allocation__arc"
                  data-testid="allocation-donut-segment"
                  [attr.data-currency]="segment.code"
                  cx="70"
                  cy="70"
                  [attr.r]="radius"
                  fill="none"
                  [attr.stroke]="'var(--color-' + segment.code.toLowerCase() + ')'"
                  stroke-width="20"
                  [attr.stroke-dasharray]="segment.dashArray"
                  [attr.stroke-dashoffset]="segment.dashOffset"
                />
                <circle
                  cx="70"
                  cy="70"
                  [attr.r]="radius"
                  fill="none"
                  [attr.stroke]="'url(#' + segment.patternId + ')'"
                  stroke-width="20"
                  [attr.stroke-dasharray]="segment.dashArray"
                  [attr.stroke-dashoffset]="segment.dashOffset"
                  aria-hidden="true"
                />
              </g>
            }
          }
        </svg>

        <div class="allocation__bar-wrap">
          <div class="allocation__bar" aria-hidden="true">
            @for (segment of segments(); track segment.code) {
              @if (segment.weight > 0) {
                <span
                  class="allocation__bar-segment"
                  data-testid="allocation-bar-segment"
                  [attr.data-currency]="segment.code"
                  [style.width.%]="segment.widthPercent"
                  [style.background-color]="'var(--color-' + segment.code.toLowerCase() + ')'"
                >
                  <svg class="allocation__bar-pattern" aria-hidden="true" focusable="false">
                    <rect width="100%" height="100%" [attr.fill]="'url(#' + segment.patternId + ')'" />
                  </svg>
                </span>
              }
            }
          </div>
        </div>
      </div>

      <div class="allocation__legend">
        <h3 class="allocation__legend-heading">{{ strings.results.allocationLegendHeading }}</h3>
        <ul class="allocation__legend-list">
          @for (segment of segments(); track segment.code) {
            <li
              class="allocation__legend-item"
              data-testid="allocation-legend-item"
              [attr.data-currency]="segment.code"
            >
              <span
                class="allocation__swatch"
                [attr.data-currency]="segment.code"
                aria-hidden="true"
              ></span>
              <span class="allocation__legend-text">
                <span class="allocation__legend-code">{{ segment.code }}</span>
                <span class="allocation__legend-name">{{ segment.name }}</span>
              </span>
              <span class="allocation__legend-value" data-testid="allocation-legend-value">{{
                segment.percentText
              }}</span>
            </li>
          }
        </ul>
      </div>
    </div>
  `,
})
export class AllocationChart {
  /** Ordered [KZT, USD, EUR], exactly as returned by the optimizer. */
  readonly weights = input.required<readonly number[]>();
  readonly label = input<string | null>(null);

  protected readonly strings = EN_STRINGS;
  protected readonly radius = DONUT_RADIUS;

  readonly segments = computed<AllocationSegment[]>(() => {
    const weights = this.weights() ?? [];
    const total = ALLOCATION_CURRENCIES.reduce(
      (sum, _code, index) => sum + safeWeight(weights[index]),
      0,
    );
    let consumed = 0;

    return ALLOCATION_CURRENCIES.map((code, index) => {
      const weight = safeWeight(weights[index]);
      const share = total > 0 ? weight / total : 0;
      const dashOffset = -consumed * DONUT_CIRCUMFERENCE;
      consumed += share;

      return {
        code,
        name: EN_STRINGS.currencies[code].label,
        weight,
        percentText: formatWeight(weight),
        widthPercent: share * 100,
        dashArray: `${round(share * DONUT_CIRCUMFERENCE)} ${round(DONUT_CIRCUMFERENCE)}`,
        dashOffset: round(dashOffset),
        patternId: `alloc-pattern-${code}`,
      };
    });
  });

  /** Full spoken description so the graphic is not the only source of truth. */
  readonly ariaLabel = computed(() => {
    const parts = this.segments().map(
      (segment) => `${segment.name} ${segment.percentText}`,
    );
    const prefix = this.label() ?? EN_STRINGS.results.allocationChartLabel;
    return `${prefix}: ${parts.join(', ')}`;
  });
}

function safeWeight(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
