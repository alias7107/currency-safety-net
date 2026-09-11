import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { OptimizationResult } from '../../../core/api/models';
import { EN_STRINGS } from '../../../core/i18n/en';
import {
  formatBufferMonths,
  formatConversionCost,
  formatHorizon,
  formatRatio,
  formatRebalanceFrequency,
} from '../../../core/util/format.util';
import { expenseRatioObservation } from '../../../core/util/result-interpretation.util';
import { SectionHeading } from '../section-heading/section-heading';

interface OverviewRow {
  key: string;
  label: string;
  value: string;
}

@Component({
  selector: 'app-scenario-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SectionHeading],
  template: `
    <section
      class="panel stack stack--4"
      aria-labelledby="scenario-overview-title"
      data-testid="scenario-overview"
    >
      <app-section-heading
        headingId="scenario-overview-title"
        [heading]="strings.results.phase2b.scenarioOverviewHeading"
        [body]="strings.results.phase2b.scenarioOverviewBody"
      />
      <dl class="detail-grid">
        @for (row of rows(); track row.key) {
          <div class="detail-grid__row" [attr.data-overview]="row.key">
            <dt class="detail-grid__term">{{ row.label }}</dt>
            <dd class="detail-grid__value">{{ row.value }}</dd>
          </div>
        }
      </dl>
      <p class="scenario-overview__ratio" data-testid="ratio-observation">
        {{ ratioObservation() }}
      </p>
    </section>
  `,
})
export class ScenarioOverview {
  readonly result = input.required<OptimizationResult>();
  readonly profileTitle = input.required<string>();

  protected readonly strings = EN_STRINGS;

  protected readonly rows = computed<OverviewRow[]>(() => {
    const result = this.result();
    const labels = EN_STRINGS.results.detailLabels;
    return [
      { key: 'profile', label: labels.profile, value: this.profileTitle() },
      { key: 'horizon', label: labels.horizon, value: formatHorizon(result.horizon_years) },
      { key: 'ratio', label: labels.ratio, value: formatRatio(result.expense_income_ratio) },
      { key: 'buffer', label: labels.buffer, value: formatBufferMonths(result.buffer_months) },
      {
        key: 'rebalance',
        label: labels.rebalance,
        value: formatRebalanceFrequency(result.rebalance_frequency),
      },
      {
        key: 'conversion',
        label: labels.conversionCost,
        value: formatConversionCost(result.conversion_cost),
      },
    ];
  });

  protected readonly ratioObservation = computed(() => {
    const observation = expenseRatioObservation(this.result().expense_income_ratio);
    const copy = EN_STRINGS.results.phase2b;
    switch (observation) {
      case 'below':
        return copy.ratioObservationBelow;
      case 'above':
        return copy.ratioObservationAbove;
      default:
        return copy.ratioObservationEqual;
    }
  });
}
