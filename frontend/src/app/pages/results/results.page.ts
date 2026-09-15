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
import {
  OptimizationApiService,
  bufferSensitivityRequestFromResult,
  isValidOriginJobId,
  sanitizeUserFacingMessage,
} from '../../core/api/optimization-api.service';
import { EN_STRINGS } from '../../core/i18n/en';
import { ScenarioComparisonStore } from '../../core/state/scenario-comparison.store';
import { ScenarioFormStore } from '../../core/state/scenario-form.store';
import { interpolate, profileIdFromName } from '../../core/util/format.util';
import { profileDisplayTitle } from '../../core/util/result-interpretation.util';
import { buildProvenanceDetailRows } from '../../core/util/result-presentation.util';
import { AllocationChart } from '../../shared/components/allocation-chart/allocation-chart';
import { AssumptionSummary } from '../../shared/components/assumption-summary/assumption-summary';
import { ErrorPanel } from '../../shared/components/error-panel/error-panel';
import { InfoCallout } from '../../shared/components/info-callout/info-callout';
import { LoadingIndicator } from '../../shared/components/loading-indicator/loading-indicator';
import { PageContainer } from '../../shared/components/page-container/page-container';
import { ResilienceProfile } from '../../shared/components/resilience-profile/resilience-profile';
import { ResultNarrative } from '../../shared/components/result-narrative/result-narrative';
import { ScenarioOverview } from '../../shared/components/scenario-overview/scenario-overview';
import { SectionHeading } from '../../shared/components/section-heading/section-heading';
import { SkeletonCard } from '../../shared/components/skeleton-card/skeleton-card';
import { StatusBadge, type StatusTone } from '../../shared/components/status-badge/status-badge';

/** Job polling cadence, in milliseconds. */
export const POLL_INTERVAL_MS = 2000;

@Component({
  selector: 'app-results-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    PageContainer,
    SectionHeading,
    AllocationChart,
    StatusBadge,
    InfoCallout,
    ErrorPanel,
    LoadingIndicator,
    SkeletonCard,
    AssumptionSummary,
    ScenarioOverview,
    ResultNarrative,
    ResilienceProfile,
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
  protected readonly explorePending = signal(false);
  protected readonly exploreError = signal<string | null>(null);

  constructor() {
    const seeded = this.seededResult();
    if (seeded) {
      this.result.set(seeded);
      this.status.set('succeeded');
    }

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
        message: sanitizeUserFacingMessage(job.error_message),
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

  protected readonly profileTitle = computed(() => profileDisplayTitle(this.result()?.profile));

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

  protected readonly modelDetails = computed(() => {
    const result = this.result();
    if (!result) {
      return [];
    }
    return buildProvenanceDetailRows(result, this.jobId());
  });

  protected openPrintableReport(): void {
    const jobId = this.jobId();
    const result = this.result();
    if (!jobId || !result) {
      return;
    }
    void this.router.navigate(['/report', jobId], { state: { result } });
  }

  protected exploreBuffers(): void {
    const result = this.result();
    if (!result || this.explorePending()) {
      return;
    }
    this.explorePending.set(true);
    this.exploreError.set(null);
    const request = bufferSensitivityRequestFromResult({
      profile: profileIdFromName(result.profile) ?? result.profile,
      horizon_years: result.horizon_years,
      expense_income_ratio: result.expense_income_ratio,
      rebalance_frequency: result.rebalance_frequency,
      conversion_cost: result.conversion_cost,
    });

    this.api
      .createBufferSensitivityJob(request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (submission) => {
          this.explorePending.set(false);
          const batchJobId = submission.body.job_id;
          const originJobId = this.jobId();
          const queryParams =
            originJobId && isValidOriginJobId(originJobId) ? { origin: originJobId } : undefined;
          if (submission.httpStatus === 200 && submission.body.result) {
            void this.router.navigate(['/buffer-sensitivity', batchJobId], {
              queryParams,
              state: {
                result: submission.body.result,
                originJobId,
              },
            });
            return;
          }
          void this.router.navigate(['/buffer-sensitivity', batchJobId], {
            queryParams,
            state: { originJobId },
          });
        },
        error: () => {
          this.explorePending.set(false);
          this.exploreError.set(EN_STRINGS.results.phase2b.exploreBuffersError);
        },
      });
  }

  protected runAnother(): void {
    this.store.setStep(0);
    void this.router.navigate(['/research/calculator']);
  }

  protected changeAssumptions(): void {
    this.store.setStep(1);
    void this.router.navigate(['/research/calculator']);
  }
}
