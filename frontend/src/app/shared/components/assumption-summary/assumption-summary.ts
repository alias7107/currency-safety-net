import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import type { OptimizationRequest } from '../../../core/api/models';
import { EN_STRINGS } from '../../../core/i18n/en';
import {
  formatBufferMonths,
  formatConversionCost,
  formatHorizon,
  formatRatio,
  formatRebalanceFrequency,
} from '../../../core/util/format.util';

interface SummaryRow {
  key: string;
  label: string;
  value: string;
  /** Calculator step that owns this input, used for the inline edit link. */
  step: number;
}

/** Read-only recap of the scenario inputs, reused by the sidebar and review step. */
@Component({
  selector: 'app-assumption-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dl class="summary">
      @for (row of rows(); track row.key) {
        <div class="summary__row">
          <dt class="summary__term">{{ row.label }}</dt>
          <dd class="summary__value">
            <span>{{ row.value }}</span>
            @if (showEditLinks()) {
              <button type="button" class="button-link summary__edit" (click)="edit.emit(row.step)">
                {{ strings.common.edit }}
                <span class="visually-hidden">{{ row.label }}</span>
              </button>
            }
          </dd>
        </div>
      }
    </dl>
  `,
})
export class AssumptionSummary {
  readonly scenario = input.required<OptimizationRequest>();
  readonly profileTitle = input<string | null>(null);
  readonly showEditLinks = input<boolean>(false);

  readonly edit = output<number>();

  protected readonly strings = EN_STRINGS;

  protected readonly rows = computed<SummaryRow[]>(() => {
    const scenario = this.scenario();
    const labels = EN_STRINGS.results.detailLabels;
    return [
      {
        key: 'profile',
        label: labels.profile,
        value: this.profileTitle() ?? String(scenario.profile),
        step: 0,
      },
      {
        key: 'horizon',
        label: labels.horizon,
        value: formatHorizon(scenario.horizon_years),
        step: 1,
      },
      {
        key: 'ratio',
        label: labels.ratio,
        value: formatRatio(scenario.expense_income_ratio),
        step: 1,
      },
      {
        key: 'buffer',
        label: labels.buffer,
        value: formatBufferMonths(scenario.buffer_months),
        step: 1,
      },
      {
        key: 'rebalance',
        label: labels.rebalance,
        value: formatRebalanceFrequency(scenario.rebalance_frequency),
        step: 1,
      },
      {
        key: 'conversion',
        label: labels.conversionCost,
        value: formatConversionCost(scenario.conversion_cost),
        step: 1,
      },
    ];
  });
}
