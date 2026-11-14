import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subject, exhaustMap, takeUntil, timer } from 'rxjs';

import { ALLOCATION_CURRENCY_ORDER } from '../../core/api/allocation-currencies';
import { isValidOriginJobId } from '../../core/api/buffer-sensitivity.validation';
import type { JobStatus } from '../../core/api/models';
import { HouseholdAnalysisApiService } from '../../core/household/household-analysis-api.service';
import type {
  HouseholdAnalysisResult,
  HouseholdApiError,
  HouseholdJobStatus,
  HouseholdPolicyEvaluation,
  HouseholdVector,
} from '../../core/household/household-analysis.models';
import { HouseholdAnalysisStore } from '../../core/household/household-analysis.store';
import { validateHouseholdResult } from '../../core/household/household-analysis.validation';
import { EN_STRINGS } from '../../core/i18n/en';
import {
  formatConversionCost,
  formatHorizon,
  formatInteger,
  formatMonthsOfIncome,
  formatPercent,
  formatRebalanceFrequency,
  formatWeight,
  interpolate,
} from '../../core/util/format.util';
import { buildIdentificationPresentation } from '../../core/util/result-presentation.util';
import { AllocationChart } from '../../shared/components/allocation-chart/allocation-chart';
import { ErrorPanel } from '../../shared/components/error-panel/error-panel';
import { InfoCallout } from '../../shared/components/info-callout/info-callout';
import { LoadingIndicator } from '../../shared/components/loading-indicator/loading-indicator';
import { PageContainer } from '../../shared/components/page-container/page-container';
import { SectionHeading } from '../../shared/components/section-heading/section-heading';
import { StatusBadge, type StatusTone } from '../../shared/components/status-badge/status-badge';

/** Household-analysis polling cadence. */
export const HOUSEHOLD_ANALYSIS_POLL_INTERVAL_MS = 4000;

interface MetricRow {
  key: string;
  label: string;
  current: string;
  optimized: string;
  note?: string | null;
}

@Component({
  selector: 'app-assessment-results-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    RouterLink,
    PageContainer,
    SectionHeading,
    StatusBadge,
    InfoCallout,
    ErrorPanel,
    LoadingIndicator,
    AllocationChart,
  ],
  templateUrl: './assessment-results.page.html',
})
export class AssessmentResultsPage {
  private readonly api = inject(HouseholdAnalysisApiService);
  private readonly store = inject(HouseholdAnalysisStore);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  private readonly stopPolling$ = new Subject<void>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly copy = EN_STRINGS.assessmentResults;
  protected readonly currencies = ALLOCATION_CURRENCY_ORDER;

  protected readonly jobId = signal<string | null>(null);
  protected readonly invalidId = signal(false);
  protected readonly status = signal<JobStatus | null>(null);
  protected readonly result = signal<HouseholdAnalysisResult | null>(null);
  protected readonly error = signal<HouseholdApiError | null>(null);
  protected readonly failureCode = signal<string | null>(null);
  protected readonly failed = signal(false);
  protected readonly retryAfterSeconds = signal<number | null>(null);

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.load(params.get('jobId'));
    });
    this.destroyRef.onDestroy(() => {
      this.stopPolling$.next();
      this.stopPolling$.complete();
      this.clearRetryTimer();
    });
  }

  private load(rawId: string | null): void {
    this.stopPolling$.next();
    this.clearRetryTimer();
    this.result.set(null);
    this.error.set(null);
    this.failed.set(false);
    this.failureCode.set(null);
    this.status.set(null);

    if (!isValidOriginJobId(rawId) || rawId !== rawId.trim()) {
      this.jobId.set(null);
      this.invalidId.set(true);
      return;
    }
    this.invalidId.set(false);
    this.jobId.set(rawId);

    const cached = this.store.get(rawId)?.result ?? null;
    if (cached) {
      this.result.set(cached);
      this.status.set('succeeded');
      return;
    }
    this.startPolling(rawId);
  }

  private startPolling(jobId: string): void {
    this.stopPolling$.next();
    this.error.set(null);
    timer(0, HOUSEHOLD_ANALYSIS_POLL_INTERVAL_MS)
      .pipe(
        exhaustMap(() => this.api.getJob(jobId)),
        takeUntil(this.stopPolling$),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (job) => {
          if (this.jobId() === jobId) {
            this.handleJob(jobId, job);
          }
        },
        error: (error: HouseholdApiError) => {
          if (this.jobId() !== jobId) {
            return;
          }
          this.error.set(error);
          this.stopPolling$.next();
          this.startRetryDelay(error.retryAfterSeconds);
        },
      });
  }

  private handleJob(jobId: string, job: HouseholdJobStatus): void {
    this.status.set(job.status);
    if (job.status === 'succeeded') {
      this.stopPolling$.next();
      const request = this.store.get(jobId)?.request ?? null;
      const checked = validateHouseholdResult(job.result, request);
      if (!checked.ok) {
        this.error.set(checked.error);
        return;
      }
      this.store.recordResult(jobId, checked.value);
      this.result.set(checked.value);
      return;
    }
    if (job.status === 'failed') {
      this.stopPolling$.next();
      this.failed.set(true);
      this.failureCode.set(job.error_code ?? null);
    }
  }

  /** Re-fetches the same job; never resubmits. */
  protected checkAgain(): void {
    const jobId = this.jobId();
    if (!jobId || this.retryAfterSeconds() !== null) {
      return;
    }
    this.status.set(null);
    this.startPolling(jobId);
  }

  private startRetryDelay(seconds: number | undefined): void {
    this.clearRetryTimer();
    if (seconds === undefined || seconds <= 0) {
      return;
    }
    this.retryAfterSeconds.set(seconds);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.retryAfterSeconds.set(null);
    }, seconds * 1000);
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.retryAfterSeconds.set(null);
  }

  /* ---------- Presentation ---------- */

  protected readonly isProcessing = computed(
    () =>
      !this.invalidId() &&
      !this.result() &&
      !this.error() &&
      !this.failed() &&
      this.status() !== 'succeeded',
  );

  protected readonly statusLabel = computed(() =>
    this.status() === 'running' ? this.copy.statusRunning : this.copy.statusQueued,
  );

  protected readonly statusTone = computed<StatusTone>(() =>
    this.status() === 'running' ? 'info' : 'neutral',
  );

  protected readonly liveMessage = computed(() => {
    if (this.result()) {
      return this.copy.completedLive;
    }
    if (this.isProcessing() && this.status() !== null) {
      return interpolate(this.copy.processingLive, { status: this.statusLabel() });
    }
    return '';
  });

  protected readonly errorCopy = computed(() => {
    const error = this.error();
    if (!error) {
      return null;
    }
    if (error.code === 'malformed_response') {
      return { title: this.copy.malformedTitle, body: this.copy.malformedBody };
    }
    if (error.status === 404) {
      return { title: this.copy.notFoundTitle, body: this.copy.notFoundBody };
    }
    if (error.status === 429) {
      return { title: this.copy.loadErrorTitle, body: this.copy.rateLimitBody };
    }
    return { title: this.copy.loadErrorTitle, body: this.copy.loadErrorBody };
  });

  protected readonly canCheckAgain = computed(() => this.error()?.status !== 404);

  protected readonly failureMessage = computed(() => {
    const code = this.failureCode();
    const messages = this.copy.failedCodes as Record<string, string>;
    return code && Object.prototype.hasOwnProperty.call(messages, code) ? messages[code]! : null;
  });

  protected readonly retryAfterText = computed(() =>
    interpolate(this.copy.retryAfter, { seconds: this.retryAfterSeconds() ?? 0 }),
  );

  protected readonly assumptionRows = computed(() => {
    const scenario = this.result()?.scenario;
    if (!scenario) {
      return [];
    }
    return [
      { key: 'income', label: this.copy.incomeShares, value: this.shares(scenario.income_shares) },
      {
        key: 'expenses',
        label: this.copy.expenseShares,
        value: this.shares(scenario.expense_shares),
      },
      {
        key: 'weights',
        label: this.copy.currentWeights,
        value: this.shares(scenario.current_reserve_weights),
      },
      {
        key: 'ratio',
        label: this.copy.ratio,
        value: formatPercent(scenario.expense_income_ratio, 2),
      },
      {
        key: 'buffer',
        label: this.copy.buffer,
        value: interpolate(this.copy.bufferValue, {
          months: formatMonthsOfIncome(scenario.buffer_months, 2),
        }),
      },
      { key: 'horizon', label: this.copy.horizon, value: formatHorizon(scenario.horizon_years) },
      {
        key: 'rebalance',
        label: this.copy.rebalance,
        value: formatRebalanceFrequency(scenario.rebalance_frequency),
      },
      {
        key: 'cost',
        label: this.copy.conversionCost,
        value: formatConversionCost(scenario.conversion_cost),
      },
    ];
  });

  protected readonly differenceText = computed(() => {
    const comparison = this.result()?.comparison;
    return comparison ? this.signedDifference(comparison.cvar95_optimized_minus_current) : '';
  });

  protected readonly outcomeText = computed(() => {
    const outcome = this.result()?.comparison.outcome;
    return outcome ? this.copy.outcomes[outcome] : '';
  });

  protected readonly diagnosticRows = computed<MetricRow[]>(() => {
    const result = this.result();
    if (!result) {
      return [];
    }
    const c = result.current_policy.diagnostics;
    const o = result.optimized_policy.diagnostics;
    return [
      {
        key: 'shortfall_probability',
        label: this.copy.shortfallProbability,
        current: formatPercent(c.shortfall_probability, 2),
        optimized: formatPercent(o.shortfall_probability, 2),
      },
      {
        key: 'var95',
        label: this.copy.var95,
        current: formatMonthsOfIncome(c.var95_cumulative_shortfall),
        optimized: formatMonthsOfIncome(o.var95_cumulative_shortfall),
        note:
          c.var95_cumulative_shortfall === 0 || o.var95_cumulative_shortfall === 0
            ? this.copy.var95ZeroNote
            : null,
      },
    ];
  });

  protected readonly implementationRows = computed<MetricRow[]>(() => {
    const result = this.result();
    if (!result) {
      return [];
    }
    const c = result.current_policy.implementation_only;
    const o = result.optimized_policy.implementation_only;
    const months = (v: number): string => formatMonthsOfIncome(v);
    return [
      {
        key: 'mean_shortfall',
        label: this.copy.meanShortfall,
        current: months(c.mean_cumulative_shortfall),
        optimized: months(o.mean_cumulative_shortfall),
      },
      {
        key: 'depletion',
        label: this.copy.depletion,
        current: formatPercent(c.wealth_depletion_probability, 2),
        optimized: formatPercent(o.wealth_depletion_probability, 2),
      },
      {
        key: 'mean_terminal',
        label: this.copy.meanTerminal,
        current: months(c.mean_terminal_wealth),
        optimized: months(o.mean_terminal_wealth),
      },
      {
        key: 'median_terminal',
        label: this.copy.medianTerminal,
        current: months(c.median_terminal_wealth),
        optimized: months(o.median_terminal_wealth),
      },
      {
        key: 'p05_terminal',
        label: this.copy.p05Terminal,
        current: months(c.p05_terminal_wealth),
        optimized: months(o.p05_terminal_wealth),
      },
      {
        key: 'p95_terminal',
        label: this.copy.p95Terminal,
        current: months(c.p95_terminal_wealth),
        optimized: months(o.p95_terminal_wealth),
      },
    ];
  });

  protected readonly identification = computed(() => {
    const id = this.result()?.optimized_policy.identification;
    if (!id) {
      return null;
    }
    return {
      presentation: buildIdentificationPresentation(id.identification_class),
      rows: [
        { key: 'n_coarse', label: this.copy.nCoarse, value: formatInteger(id.n_coarse) },
        { key: 'n_refined', label: this.copy.nRefined, value: formatInteger(id.n_refined) },
        { key: 'n_surface', label: this.copy.nSurface, value: formatInteger(id.n_surface) },
        {
          key: 'near_optimal',
          label: this.copy.nearOptimal,
          value: `${formatInteger(id.near_optimal_1pct_count)} (${formatPercent(id.near_optimal_1pct_frac, 1)})`,
        },
      ],
    };
  });

  protected readonly provenanceRows = computed(() => {
    const p = this.result()?.provenance;
    if (!p) {
      return [];
    }
    return [
      { key: 'model_version', label: this.copy.modelVersion, value: p.model_version, mono: false },
      { key: 'data_as_of', label: this.copy.dataAsOf, value: p.data_as_of, mono: false },
      { key: 'dataset_sha256', label: this.copy.datasetSha, value: p.dataset_sha256, mono: true },
      {
        key: 'paths',
        label: this.copy.paths,
        value: formatInteger(p.simulation_paths),
        mono: false,
      },
      { key: 'seed', label: this.copy.seed, value: String(p.simulation_seed), mono: false },
      {
        key: 'specification',
        label: this.copy.specification,
        value: p.canonical_optimization_specification,
        mono: true,
      },
      { key: 'fx', label: this.copy.fxPolicy, value: this.copy.fxPolicyValue, mono: false },
      { key: 'job', label: this.copy.jobId, value: this.jobId() ?? '', mono: true },
    ];
  });

  protected cvar(policy: HouseholdPolicyEvaluation): string {
    return formatMonthsOfIncome(policy.objective.cvar95_cumulative_shortfall);
  }

  private shares(vector: HouseholdVector): string {
    return this.currencies.map((code, i) => `${code} ${formatWeight(vector[i])}`).join(', ');
  }

  /** Signed optimized − current; tiny non-zero values never display as 0. */
  private signedDifference(delta: number): string {
    if (delta === 0) {
      return formatMonthsOfIncome(0, 4);
    }
    const sign = delta > 0 ? '+' : '−';
    if (Math.abs(delta) < 0.00005) {
      return interpolate(this.copy.differenceTiny, { sign });
    }
    return `${sign}${formatMonthsOfIncome(Math.abs(delta), 4)}`;
  }
}
