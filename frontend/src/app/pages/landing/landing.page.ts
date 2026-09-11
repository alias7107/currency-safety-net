import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { OptimizationApiService } from '../../core/api/optimization-api.service';
import { EN_STRINGS } from '../../core/i18n/en';
import { formatInteger } from '../../core/util/format.util';
import { InfoCallout } from '../../shared/components/info-callout/info-callout';
import { PageContainer } from '../../shared/components/page-container/page-container';
import { SectionHeading } from '../../shared/components/section-heading/section-heading';

@Component({
  selector: 'app-landing-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageContainer, SectionHeading, InfoCallout],
  templateUrl: './landing.page.html',
})
export class LandingPage {
  private readonly api = inject(OptimizationApiService);

  protected readonly strings = EN_STRINGS;

  protected readonly metadataFailed = signal(false);
  protected readonly dataAsOf = signal<string>(EN_STRINGS.common.unavailable);
  protected readonly simulationPaths = signal<string | null>(null);
  protected readonly modelVersion = signal<string | null>(null);
  protected readonly simulationMethod = signal<string | null>(null);

  constructor() {
    this.api
      .getMetadata()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (metadata) => {
          this.metadataFailed.set(false);
          this.dataAsOf.set(metadata.data_as_of);
          this.modelVersion.set(metadata.model_version);
          this.simulationPaths.set(formatInteger(metadata.simulation_paths));
          this.simulationMethod.set(metadata.simulation_method ?? null);
        },
        error: () => {
          this.metadataFailed.set(true);
          this.dataAsOf.set(EN_STRINGS.common.unavailable);
          this.modelVersion.set(null);
          this.simulationPaths.set(null);
          this.simulationMethod.set(null);
        },
      });
  }
}
