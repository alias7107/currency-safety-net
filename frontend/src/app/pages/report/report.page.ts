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

import type {
  ApiError,
  JobStatus,
  OptimizationJobStatus,
  OptimizationResult,
} from '../../core/api/models';
import {
  OptimizationApiService,
  sanitizeUserFacingMessage,
} from '../../core/api/optimization-api.service';
import { EN_STRINGS } from '../../core/i18n/en';
import { profileDisplayTitle } from '../../core/util/result-interpretation.util';
import {
  buildDiagnosticMetricViews,
  buildIdentificationPresentation,
  buildReportProvenanceRows,
  formatCvar95Value,
} from '../../core/util/result-presentation.util';
import { AllocationChart } from '../../shared/components/allocation-chart/allocation-chart';
import { ErrorPanel } from '../../shared/components/error-panel/error-panel';
import { InfoCallout } from '../../shared/components/info-callout/info-callout';
import { LoadingIndicator } from '../../shared/components/loading-indicator/loading-indicator';
import { MetricExplanation } from '../../shared/components/metric-explanation/metric-explanation';
import { PageContainer } from '../../shared/components/page-container/page-container';
import { ResultNarrative } from '../../shared/components/result-narrative/result-narrative';
import { ScenarioOverview } from '../../shared/components/scenario-overview/scenario-overview';
import { SectionHeading } from '../../shared/components/section-heading/section-heading';

@Component({
  selector: 'app-report-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    PageContainer,
    SectionHeading,
    AllocationChart,
    InfoCallout,
    ErrorPanel,
    LoadingIndicator,
    ScenarioOverview,
    ResultNarrative,
    MetricExplanation,
  ],
  templateUrl: './report.page.html',
})
export class ReportPage {
  private readonly api = inject(OptimizationApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly strings = EN_STRINGS;

  protected readonly jobId = signal<string | null>(null);
  protected readonly status = signal<JobStatus | null>(null);
  protected readonly result = signal<OptimizationResult | null>(null);
  protected readonly error = signal<ApiError | null>(null);
  protected readonly failure = signal<{ code: string | null; message: string | null } | null>(null);
  protected readonly loading = signal(false);
  private fetchedOnce = false;

  constructor() {
    const seeded = this.seededResult();
    if (seeded) {
      this.result.set(seeded);
      this.status.set('succeeded');
    }

    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const jobId = params.get('jobId');
      this.jobId.set(jobId);
      if (!jobId) {
        return;
      }
      if (this.result()) {
        return;
      }
      if (this.fetchedOnce) {
        return;
      }
      this.fetchedOnce = true;
      this.fetchJobOnce(jobId);
    });
  }

  private seededResult(): OptimizationResult | null {
    const state = this.router.getCurrentNavigation()?.extras?.state as
      { result?: OptimizationResult } | undefined;
    return state?.result ?? null;
  }

  private fetchJobOnce(jobId: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.failure.set(null);

    this.api
      .getOptimizationJob(jobId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (job) => this.handleJob(job),
        error: (error: ApiError) => {
          this.loading.set(false);
          this.error.set(error);
        },
      });
  }

  private handleJob(job: OptimizationJobStatus): void {
    this.loading.set(false);
    this.status.set(job.status);

    if (job.status === 'succeeded') {
      if (job.result) {
        this.result.set(job.result);
      } else {
        this.error.set({
          status: 500,
          code: 'malformed_result',
          message: EN_STRINGS.errors.serverBody,
        });
      }
      return;
    }

    if (job.status === 'failed') {
      this.failure.set({
        code: job.error_code ?? null,
        message: sanitizeUserFacingMessage(job.error_message),
      });
      return;
    }

    // queued / running — report not ready; no polling.
  }

  protected readonly isNotReady = computed(() => {
    if (this.result() || this.error() || this.failure() || this.loading()) {
      return false;
    }
    const status = this.status();
    return status === 'queued' || status === 'running';
  });

  protected readonly liveMessage = computed(() => {
    if (this.loading()) {
      return EN_STRINGS.report.loadingLive;
    }
    return '';
  });

  protected readonly profileTitle = computed(() => profileDisplayTitle(this.result()?.profile));

  protected readonly cvar95Value = computed(() => {
    const result = this.result();
    return result ? formatCvar95Value(result) : '—';
  });

  protected readonly diagnostics = computed(() => {
    const result = this.result();
    return result ? buildDiagnosticMetricViews(result) : [];
  });

  protected readonly identification = computed(() =>
    buildIdentificationPresentation(this.result()?.identification_class),
  );

  protected readonly provenanceRows = computed(() => {
    const result = this.result();
    if (!result) {
      return [];
    }
    return buildReportProvenanceRows(result, this.jobId());
  });

  protected printReport(): void {
    if (!this.result()) {
      return;
    }
    window.print();
  }

  protected retry(): void {
    const jobId = this.jobId();
    if (!jobId) {
      return;
    }
    this.fetchedOnce = false;
    this.result.set(null);
    this.status.set(null);
    this.fetchedOnce = true;
    this.fetchJobOnce(jobId);
  }
}
