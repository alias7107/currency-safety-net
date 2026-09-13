import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

import type { BufferSensitivityResult } from '../../../core/api/models';
import { EN_STRINGS } from '../../../core/i18n/en';
import {
  formatBufferMonths,
  formatMonthsOfIncome,
  formatPercent,
  interpolate,
} from '../../../core/util/format.util';
import { SegmentedControl } from '../segmented-control/segmented-control';

export type DiscreteMetricKey = 'shortfall_probability' | 'cvar95_cumulative_shortfall';

export interface DiscreteBar {
  bufferMonths: number;
  bufferLabel: string;
  value: number;
  display: string;
  /** Linear share of the series max; exactly 0 when the value is 0. */
  heightPercent: number;
}

/** Pure bar heights: zero maps to 0; positives scale linearly to the series max. */
export function computeDiscreteBarHeights(values: readonly number[]): number[] {
  const max = Math.max(0, ...values.map((value) => (Number.isFinite(value) ? value : 0)));
  if (max <= 0) {
    return values.map(() => 0);
  }
  return values.map((value) => {
    if (!Number.isFinite(value) || value <= 0) {
      return 0;
    }
    return (value / max) * 100;
  });
}

/** Discrete bars only — never draws a connecting or smoothed line between buffers. */
@Component({
  selector: 'app-discrete-buffer-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SegmentedControl],
  template: `
    <div class="discrete-chart stack stack--4" data-testid="discrete-buffer-chart">
      <app-segmented-control
        groupName="buffer-sensitivity-metric"
        [options]="metricOptions"
        [value]="metric()"
        (valueChange)="onMetricChange($event)"
      />

      <div
        class="discrete-chart__plot"
        role="img"
        [attr.aria-label]="chartAria()"
        data-testid="discrete-chart-plot"
      >
        @for (bar of bars(); track bar.bufferMonths) {
          <div class="discrete-chart__column">
            <div class="discrete-chart__value">{{ bar.display }}</div>
            <div class="discrete-chart__bar-track" aria-hidden="true">
              <div
                class="discrete-chart__bar"
                [attr.data-height]="bar.heightPercent"
                [style.height.%]="bar.heightPercent"
              ></div>
            </div>
            <div class="discrete-chart__label">{{ bar.bufferLabel }}</div>
          </div>
        }
      </div>

      <div class="visually-hidden visually-hidden--rich" data-testid="discrete-chart-sr-wrap">
        <table data-testid="discrete-chart-sr-table">
          <caption>
            {{
              chartAria()
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ strings.bufferSensitivity.colBuffer }}</th>
              <th scope="col">{{ metricLabel() }}</th>
            </tr>
          </thead>
          <tbody>
            @for (bar of bars(); track bar.bufferMonths) {
              <tr>
                <th scope="row">{{ bar.bufferLabel }}</th>
                <td>{{ bar.display }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class DiscreteBufferChart {
  readonly result = input.required<BufferSensitivityResult>();

  protected readonly strings = EN_STRINGS;
  protected readonly metric = signal<DiscreteMetricKey>('shortfall_probability');

  protected readonly metricOptions = [
    { value: 'shortfall_probability', label: EN_STRINGS.bufferSensitivity.metricShortfall },
    { value: 'cvar95_cumulative_shortfall', label: EN_STRINGS.bufferSensitivity.metricCvar },
  ];

  protected onMetricChange(value: string | number): void {
    if (value === 'shortfall_probability' || value === 'cvar95_cumulative_shortfall') {
      this.metric.set(value);
    }
  }

  protected readonly metricLabel = computed(() =>
    this.metric() === 'shortfall_probability'
      ? EN_STRINGS.bufferSensitivity.metricShortfall
      : EN_STRINGS.bufferSensitivity.metricCvar,
  );

  protected readonly chartAria = computed(() =>
    interpolate(EN_STRINGS.bufferSensitivity.chartAria, { metric: this.metricLabel() }),
  );

  protected readonly bars = computed<DiscreteBar[]>(() => {
    const rows = this.result().results;
    const metric = this.metric();
    const values = rows.map((row) =>
      metric === 'shortfall_probability'
        ? row.shortfall_probability
        : row.cvar95_cumulative_shortfall,
    );
    const heights = computeDiscreteBarHeights(values);
    return rows.map((row, index) => {
      const value = values[index]!;
      return {
        bufferMonths: row.buffer_months,
        bufferLabel: formatBufferMonths(row.buffer_months),
        value,
        display:
          metric === 'shortfall_probability'
            ? formatPercent(value, 2)
            : `${formatMonthsOfIncome(value)} ${EN_STRINGS.resilienceProfile.units.monthsOfIncome}`,
        heightPercent: heights[index]!,
      };
    });
  });
}
