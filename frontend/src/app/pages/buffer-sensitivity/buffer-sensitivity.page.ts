import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, exhaustMap, takeUntil, timer } from 'rxjs';

import { ALLOCATION_CURRENCY_ORDER } from '../../core/api/allocation-currencies';
import type {
  ApiError,
  BufferSensitivityJobStatus,
  BufferSensitivityResult,
  JobStatus,
} from '../../core/api/models';
import {
  OptimizationApiService,
  isValidOriginJobId,
  sanitizeUserFacingMessage,
  validateBufferSensitivityResult,
} from '../../core/api/optimization-api.service';
import { EN_STRINGS } from '../../core/i18n/en';
import { ScenarioFormStore } from '../../core/state/scenario-form.store';
import {
  formatBufferMonths,
  formatConversionCost,
  formatHorizon,
  formatInteger,
  formatMonthsOfIncome,
  formatPercent,
  formatRatio,
  formatRebalanceFrequency,
  formatWeight,
  interpolate,
} from '../../core/util/format.util';
import { profileDisplayTitle } from '../../core/util/result-interpretation.util';
import { buildIdentificationPresentation } from '../../core/util/result-presentation.util';
import { DiscreteBufferChart } from '../../shared/components/discrete-buffer-chart/discrete-buffer-chart';
import { ErrorPanel } from '../../shared/components/error-panel/error-panel';
import { InfoCallout } from '../../shared/components/info-callout/info-callout';
import { LoadingIndicator } from '../../shared/components/loading-indicator/loading-indicator';
import { PageContainer } from '../../shared/components/page-container/page-container';
import { SectionHeading } from '../../shared/components/section-heading/section-heading';
import { SkeletonCard } from '../../shared/components/skeleton-card/skeleton-card';
import { StatusBadge, type StatusTone } from '../../shared/components/status-badge/status-badge';
import { TargetFinder } from '../../shared/components/target-finder/target-finder';

/** Buffer-sensitivity polling cadence (3–5s range). */
export const BUFFER_SENSITIVITY_POLL_INTERVAL_MS = 4000;

@Component({
  selector: 'app-buffer-sensitivity-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    PageContainer,
    SectionHeading,
    StatusBadge,
    InfoCallout,
    ErrorPanel,
    LoadingIndicator,
    SkeletonCard,
    DiscreteBufferChart,
    TargetFinder,
  ],
  templateUrl: './buffer-sensitivity.page.html',
})
export class BufferSensitivityPage {
  private readonly api = inject(OptimizationApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject(ScenarioFormStore);

  private readonly stopPolling$ = new Subject<void>();

  protected readonly strings = EN_STRINGS;
  protected readonly currencies = ALLOCATION_CURRENCY_ORDER;

  protected readonly jobId = signal<string | null>(null);
  protected readonly originJobId = signal<string | null>(null);
  protected readonly status = signal<JobStatus | null>(null);
  protected readonly result = signal<BufferSensitivityResult | null>(null);
  protected readonly error = signal<ApiError | null>(null);
  protected readonly failure = signal<{ code: string | null; message: string | null } | null>(null);

  constructor() {
    const seeded = this.seededNavigation();
    if (seeded.result) {
      this.result.set(seeded.result);
      this.status.set('succeeded');
    }
    if (seeded.originJobId) {
      this.originJobId.set(seeded.originJobId);
    }

    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const origin = params.get('origin');
      if (isValidOriginJobId(origin)) {
        this.originJobId.set(origin);
      }
    });

    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const jobId = params.get('jobId');
      this.jobId.set(jobId);
      if (!jobId) {
        return;
      }
      if (this.result()) {
        return;
      }
      this.startPolling(jobId);
    });

    this.destroyRef.onDestroy(() => {
      this.stopPolling$.next();
      this.stopPolling$.complete();
    });
  }

  private seededNavigation(): {
    result: BufferSensitivityResult | null;
    originJobId: string | null;
  } {
    const state = this.router.getCurrentNavigation()?.extras?.state as
      { result?: unknown; originJobId?: string } | undefined;
    let result: BufferSensitivityResult | null = null;
    if (state?.result !== undefined) {
      const validated = validateBufferSensitivityResult(state.result);
      if (validated.ok) {
        result = validated.result;
      }
    }
    const originCandidate = state?.originJobId ?? null;
    return {
      result,
      originJobId: isValidOriginJobId(originCandidate) ? originCandidate : null,
    };
  }

  protected startPolling(jobId: string): void {
    this.stopPolling$.next();
    this.error.set(null);
    this.failure.set(null);

    timer(0, BUFFER_SENSITIVITY_POLL_INTERVAL_MS)
      .pipe(
        exhaustMap(() => this.api.getBufferSensitivityJob(jobId)),
        takeUntil(this.stopPolling$),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (job) => this.handleJob(job),
        error: (error: ApiError) => {
          this.error.set(error);
          this.stopPolling$.next();
        },
      });
  }

  private handleJob(job: BufferSensitivityJobStatus): void {
    this.status.set(job.status);

    if (job.status === 'succeeded') {
      if (job.result) {
        this.result.set(job.result);
      } else {
        this.error.set({
          status: 0,
          code: 'malformed_response',
          message: EN_STRINGS.errors.serverBody,
        });
      }
      this.stopPolling$.next();
      return;
    }

    if (job.status === 'failed') {
      this.failure.set({
        code: job.error_code ?? null,
        message: sanitizeUserFacingMessage(job.error_message),
      });
      this.stopPolling$.next();
    }
  }

  protected retry(): void {
    const jobId = this.jobId();
    if (jobId) {
      this.result.set(null);
      this.startPolling(jobId);
    }
  }

  protected readonly isProcessing = computed(() => {
    if (this.result() || this.error() || this.failure()) {
      return false;
    }
    const status = this.status();
    return status === null || status === 'queued' || status === 'running';
  });

  protected readonly statusLabel = computed(() => {
    switch (this.status()) {
      case 'running':
        return EN_STRINGS.bufferSensitivity.statusRunning;
      case 'succeeded':
        return EN_STRINGS.bufferSensitivity.statusSucceeded;
      case 'failed':
        return EN_STRINGS.bufferSensitivity.statusFailed;
      default:
        return EN_STRINGS.bufferSensitivity.statusQueued;
    }
  });

  protected readonly statusTone = computed<StatusTone>(() => {
    switch (this.status()) {
      case 'succeeded':
        return 'success';
      case 'failed':
        return 'error';
      case 'running':
        return 'info';
      default:
        return 'neutral';
    }
  });

  protected readonly liveMessage = computed(() => {
    if (this.isProcessing()) {
      return interpolate(EN_STRINGS.bufferSensitivity.processingLive, {
        status: this.statusLabel(),
      });
    }
    return '';
  });

  protected readonly profileTitle = computed(() =>
    profileDisplayTitle(this.result()?.scenario.profile),
  );

  protected readonly scenarioRows = computed(() => {
    const scenario = this.result()?.scenario;
    if (!scenario) {
      return [];
    }
    const labels = EN_STRINGS.bufferSensitivity.detailLabels;
    return [
      {
        key: 'profile',
        label: labels.profile,
        value: profileDisplayTitle(scenario.profile),
      },
      { key: 'horizon', label: labels.horizon, value: formatHorizon(scenario.horizon_years) },
      {
        key: 'ratio',
        label: labels.ratio,
        value: formatRatio(scenario.expense_income_ratio),
      },
      {
        key: 'rebalance',
        label: labels.rebalance,
        value: formatRebalanceFrequency(scenario.rebalance_frequency),
      },
      {
        key: 'conversion',
        label: labels.conversionCost,
        value: formatConversionCost(scenario.conversion_cost),
      },
    ];
  });

  protected readonly provenanceRows = computed(() => {
    const result = this.result();
    if (!result) {
      return [];
    }
    const labels = EN_STRINGS.bufferSensitivity.detailLabels;
    const provenance = result.provenance;
    return [
      { key: 'model_version', label: labels.modelVersion, value: provenance.model_version },
      { key: 'data_as_of', label: labels.dataAsOf, value: provenance.data_as_of },
      {
        key: 'simulation_paths',
        label: labels.simulationPaths,
        value: formatInteger(provenance.simulation_paths),
      },
      {
        key: 'simulation_seed',
        label: labels.simulationSeed,
        value: formatInteger(provenance.simulation_seed),
      },
      { key: 'contract_version', label: labels.contractVersion, value: result.contract_version },
      { key: 'dataset_sha', label: labels.datasetSha, value: provenance.dataset_sha256 },
    ];
  });

  protected readonly tableRows = computed(() => {
    const result = this.result();
    if (!result) {
      return [];
    }
    return result.results.map((row) => {
      const identity = buildIdentificationPresentation(row.identification_class);
      return {
        bufferLabel: formatBufferMonths(row.buffer_months),
        bufferMonths: row.buffer_months,
        weights: row.weights.map((weight) => formatWeight(weight)),
        shortfall: formatPercent(row.shortfall_probability, 2),
        cvar: formatMonthsOfIncome(row.cvar95_cumulative_shortfall),
        var95: formatMonthsOfIncome(row.var95_cumulative_shortfall),
        identification: identity.label,
        depletion: formatPercent(row.implementation_only.wealth_depletion_probability, 2),
      };
    });
  });

  protected resultsLink(): string[] {
    const origin = this.originJobId();
    return origin && isValidOriginJobId(origin) ? ['/results', origin] : ['/assessment'];
  }

  protected runAnother(): void {
    this.store.setStep(0);
    void this.router.navigate(['/assessment']);
  }
}
