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

import type {
  ApiError,
  JobStatus,
  OptimizationJobStatus,
  OptimizationRequest,
  OptimizationResult,
} from '../../core/api/models';
import { OptimizationApiService } from '../../core/api/optimization-api.service';
import { EN_STRINGS } from '../../core/i18n/en';
import { ScenarioComparisonStore } from '../../core/state/scenario-comparison.store';
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
  humanizeIdentificationClass,
  interpolate,
  profileIdFromName,
} from '../../core/util/format.util';
import { AllocationChart } from '../../shared/components/allocation-chart/allocation-chart';
import { AssumptionSummary } from '../../shared/components/assumption-summary/assumption-summary';
import { ErrorPanel } from '../../shared/components/error-panel/error-panel';
import { InfoCallout } from '../../shared/components/info-callout/info-callout';
import { LoadingIndicator } from '../../shared/components/loading-indicator/loading-indicator';
import { MetricCard } from '../../shared/components/metric-card/metric-card';
import { PageContainer } from '../../shared/components/page-container/page-container';
import { SectionHeading } from '../../shared/components/section-heading/section-heading';
import { SkeletonCard } from '../../shared/components/skeleton-card/skeleton-card';
import { StatusBadge, type StatusTone } from '../../shared/components/status-badge/status-badge';

/** Job polling cadence, in milliseconds. */
export const POLL_INTERVAL_MS = 2000;

const WELL_IDENTIFIED = 'A_WELL_IDENTIFIED';

interface MetricView {
  key: string;
  label: string;
  value: string;
  explanation: string;
  unit: string | null;
  emphasis: boolean;
}

interface DetailRow {
  key: string;
  label: string;
  value: string;
}

@Component({
  selector: 'app-results-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    PageContainer,
    SectionHeading,
    AllocationChart,
    MetricCard,
    StatusBadge,
    InfoCallout,
    ErrorPanel,
    LoadingIndicator,
    SkeletonCard,
    AssumptionSummary,
  ],
  templateUrl: './results.page.html',
})
export class ResultsPage {
  private readonly api = inject(OptimizationApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject(ScenarioFormStore);
  private readonly comparison = inject(ScenarioComparisonStore);

  private readonly stopPolling$ = new Subject<void>();

  protected readonly strings = EN_STRINGS;

  protected readonly jobId = signal<string | null>(null);
  protected readonly status = signal<JobStatus | null>(null);
  protected readonly result = signal<OptimizationResult | null>(null);
  protected readonly error = signal<ApiError | null>(null);
  protected readonly failure = signal<{ code: string | null; message: string | null } | null>(null);
  protected readonly comparisonNotice = signal('');

  constructor() {
    // A cached 200 from the submit call hands the finished result over directly,
    // so there is nothing to poll for.
    const seeded = this.seededResult();
    if (seeded) {
      this.result.set(seeded);
      this.status.set('succeeded');
    }

    // Reading the id from the route (not from component state) is what makes a
    // browser refresh on /results/:jobId resume the same scenario.
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

  private seededResult(): OptimizationResult | null {
    const state = this.router.getCurrentNavigation()?.extras?.state as
      { result?: OptimizationResult } | undefined;
    return state?.result ?? null;
  }

  protected startPolling(jobId: string): void {
    this.stopPolling$.next();
    this.error.set(null);
    this.failure.set(null);

    timer(0, POLL_INTERVAL_MS)
      .pipe(
        exhaustMap(() => this.api.getOptimizationJob(jobId)),
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

  private handleJob(job: OptimizationJobStatus): void {
    this.status.set(job.status);

    if (job.status === 'succeeded') {
      if (job.result) {
        this.result.set(job.result);
      }
      this.stopPolling$.next();
      return;
    }

    if (job.status === 'failed') {
      this.failure.set({
        code: job.error_code ?? null,
        message: job.error_message ?? null,
      });
      this.stopPolling$.next();
    }
  }

  protected retry(): void {
    const jobId = this.jobId();
    if (jobId) {
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
        return EN_STRINGS.results.statusRunning;
      case 'succeeded':
        return EN_STRINGS.results.statusSucceeded;
      case 'failed':
        return EN_STRINGS.results.statusFailed;
      default:
        return EN_STRINGS.results.statusQueued;
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

  /** Announced politely while the job is still in flight; never a fake percentage. */
  protected readonly liveMessage = computed(() => {
    if (this.isProcessing()) {
      return interpolate(EN_STRINGS.results.processingLive, { status: this.statusLabel() });
    }
    return this.comparisonNotice();
  });

  protected readonly isInComparison = computed(() => {
    const id = this.jobId();
    return id ? this.comparison.contains(id) : false;
  });

  protected readonly comparisonIsFull = computed(() => this.comparison.isFull());

  protected addToComparison(): void {
    const jobId = this.jobId();
    const result = this.result();
    if (!jobId || !result) {
      return;
    }
    const outcome = this.comparison.add(jobId, result);
    switch (outcome.status) {
      case 'added':
        this.comparisonNotice.set(EN_STRINGS.results.comparisonAddedLive);
        break;
      case 'duplicate':
        this.comparisonNotice.set(EN_STRINGS.results.comparisonDuplicateLive);
        break;
      case 'full':
        this.comparisonNotice.set(EN_STRINGS.results.comparisonFullLive);
        break;
      default:
        this.comparisonNotice.set('');
    }
  }

  protected readonly profileTitle = computed(() => {
    const id = profileIdFromName(this.result()?.profile);
    if (!id) {
      return this.result()?.profile ?? '—';
    }
    const table = EN_STRINGS.profiles as Record<string, { title: string } | undefined>;
    return table[id]?.title ?? id;
  });

  protected readonly scenarioInputs = computed<OptimizationRequest | null>(() => {
    const result = this.result();
    if (!result) {
      return null;
    }
    return {
      profile: profileIdFromName(result.profile) ?? result.profile,
      horizon_years: result.horizon_years,
      expense_income_ratio: result.expense_income_ratio,
      buffer_months: result.buffer_months,
      rebalance_frequency: result.rebalance_frequency,
      conversion_cost: result.conversion_cost,
    };
  });

  /** Every displayed metric is read straight from the API payload. */
  protected readonly metrics = computed<MetricView[]>(() => {
    const result = this.result();
    if (!result) {
      return [];
    }
    const copy = EN_STRINGS.results.metrics;
    const months = 'months of income';

    return [
      {
        key: 'shortfall_probability',
        label: copy.shortfallProbability.label,
        value: formatPercent(result.shortfall_probability, 2),
        explanation: copy.shortfallProbability.explanation,
        unit: null,
        emphasis: true,
      },
      {
        key: 'cvar95_cumulative_shortfall',
        label: copy.cvar95.label,
        value: formatMonthsOfIncome(result.cvar95_cumulative_shortfall),
        explanation: copy.cvar95.explanation,
        unit: months,
        emphasis: true,
      },
      {
        key: 'var95_cumulative_shortfall',
        label: copy.var95.label,
        value: formatMonthsOfIncome(result.var95_cumulative_shortfall),
        explanation: copy.var95.explanation,
        unit: months,
        emphasis: false,
      },
      {
        key: 'mean_cumulative_shortfall',
        label: copy.meanShortfall.label,
        value: formatMonthsOfIncome(result.mean_cumulative_shortfall),
        explanation: copy.meanShortfall.explanation,
        unit: months,
        emphasis: false,
      },
      {
        key: 'wealth_depletion_probability',
        label: copy.depletion.label,
        value: formatPercent(result.wealth_depletion_probability, 2),
        explanation: copy.depletion.explanation,
        unit: null,
        emphasis: false,
      },
    ];
  });

  protected readonly isWellIdentified = computed(
    () => this.result()?.identification_class === WELL_IDENTIFIED,
  );

  protected readonly identificationLabel = computed(() => {
    const result = this.result();
    if (!result?.identification_class) {
      return null;
    }
    return this.isWellIdentified()
      ? EN_STRINGS.results.identificationWellIdentified
      : humanizeIdentificationClass(result.identification_class);
  });

  protected readonly modelDetails = computed<DetailRow[]>(() => {
    const result = this.result();
    if (!result) {
      return [];
    }
    const labels = EN_STRINGS.results.detailLabels;
    const rows: DetailRow[] = [
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
      { key: 'model_version', label: labels.modelVersion, value: result.model_version },
      { key: 'data_as_of', label: labels.dataAsOf, value: result.data_as_of },
      {
        key: 'simulation_paths',
        label: labels.simulationPaths,
        value: formatInteger(result.simulation_paths),
      },
      {
        key: 'simulation_seed',
        label: labels.simulationSeed,
        value: formatInteger(result.simulation_seed),
      },
    ];

    if (result.n_coarse !== undefined) {
      rows.push({
        key: 'n_coarse',
        label: labels.gridCoarse,
        value: formatInteger(result.n_coarse),
      });
    }
    if (result.n_refined !== undefined) {
      rows.push({
        key: 'n_refined',
        label: labels.gridRefined,
        value: formatInteger(result.n_refined),
      });
    }
    if (result.n_surface !== undefined) {
      rows.push({
        key: 'n_surface',
        label: labels.gridSurface,
        value: formatInteger(result.n_surface),
      });
    }

    const jobId = this.jobId();
    if (jobId) {
      rows.push({ key: 'job_id', label: labels.jobId, value: jobId });
    }
    return rows;
  });

  protected runAnother(): void {
    this.store.setStep(0);
    void this.router.navigate(['/calculator']);
  }

  protected changeAssumptions(): void {
    this.store.setStep(1);
    void this.router.navigate(['/calculator']);
  }
}
