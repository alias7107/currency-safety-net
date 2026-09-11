import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import type { ApiError, ModelMetadata } from '../../core/api/models';
import { OptimizationApiService } from '../../core/api/optimization-api.service';
import { EN_STRINGS } from '../../core/i18n/en';
import { formatDate, formatInteger } from '../../core/util/format.util';
import { ErrorPanel } from '../../shared/components/error-panel/error-panel';
import { InfoCallout } from '../../shared/components/info-callout/info-callout';
import { LoadingIndicator } from '../../shared/components/loading-indicator/loading-indicator';
import { PageContainer } from '../../shared/components/page-container/page-container';
import { SectionHeading } from '../../shared/components/section-heading/section-heading';

interface ParameterRow {
  key: string;
  label: string;
  value: string;
}

@Component({
  selector: 'app-methodology-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageContainer, SectionHeading, InfoCallout, ErrorPanel, LoadingIndicator],
  templateUrl: './methodology.page.html',
})
export class MethodologyPage {
  private readonly api = inject(OptimizationApiService);

  protected readonly strings = EN_STRINGS;
  protected readonly metadata = signal<ModelMetadata | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<ApiError | null>(null);

  /** Live values from the metadata endpoint; nothing here is hard-coded. */
  protected readonly parameters = computed<ParameterRow[]>(() => {
    const metadata = this.metadata();
    if (!metadata) {
      return [];
    }
    const labels = EN_STRINGS.methodology.parameterLabels;
    const window = metadata.baseline_estimation_period;

    return [
      { key: 'model_version', label: labels.modelVersion, value: metadata.model_version },
      { key: 'data_as_of', label: labels.dataAsOf, value: formatDate(metadata.data_as_of) },
      {
        key: 'estimation_window',
        label: labels.estimationWindow,
        value:
          window?.start && window?.end
            ? `${window.start} — ${window.end}`
            : EN_STRINGS.common.notAvailable,
      },
      {
        key: 'simulation_method',
        label: labels.simulationMethod,
        value: metadata.simulation_method ?? EN_STRINGS.common.notAvailable,
      },
      {
        key: 'simulation_paths',
        label: labels.simulationPaths,
        value: formatInteger(metadata.simulation_paths),
      },
      {
        key: 'simulation_seed',
        label: labels.simulationSeed,
        value: formatInteger(metadata.simulation_seed),
      },
      {
        key: 'currencies',
        label: labels.currencies,
        value: (metadata.supported_currencies ?? []).join(', '),
      },
      {
        key: 'horizons',
        label: labels.horizons,
        value: (metadata.supported_horizons_years ?? []).join(', '),
      },
      {
        key: 'risk_metrics',
        label: labels.riskMetrics,
        value: (metadata.risk_metric_names ?? []).join(', '),
      },
      {
        key: 'specification',
        label: labels.specification,
        value: metadata.canonical_optimization_specification ?? EN_STRINGS.common.notAvailable,
      },
      {
        key: 'dataset_hash',
        label: labels.datasetHash,
        value: metadata.dataset_sha256 || EN_STRINGS.common.notAvailable,
      },
    ];
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.api
      .getMetadata()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (metadata) => {
          this.metadata.set(metadata);
          this.loading.set(false);
        },
        error: (error: ApiError) => {
          this.error.set(error);
          this.loading.set(false);
        },
      });
  }
}
