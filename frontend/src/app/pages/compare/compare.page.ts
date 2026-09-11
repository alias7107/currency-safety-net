import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { EN_STRINGS } from '../../core/i18n/en';
import {
  type ComparisonScenario,
  ScenarioComparisonStore,
} from '../../core/state/scenario-comparison.store';
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
  humanizeIdentificationClass,
  interpolate,
  profileIdFromName,
} from '../../core/util/format.util';
import { AllocationChart } from '../../shared/components/allocation-chart/allocation-chart';
import { InfoCallout } from '../../shared/components/info-callout/info-callout';
import { PageContainer } from '../../shared/components/page-container/page-container';
import { SectionHeading } from '../../shared/components/section-heading/section-heading';

const WELL_IDENTIFIED = 'A_WELL_IDENTIFIED';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

interface CompareRow {
  key: string;
  label: string;
  values: string[];
}

@Component({
  selector: 'app-compare-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageContainer, SectionHeading, InfoCallout, AllocationChart],
  templateUrl: './compare.page.html',
})
export class ComparePage {
  private readonly comparison = inject(ScenarioComparisonStore);
  private readonly injector = inject(Injector);

  private readonly clearDialog = viewChild<ElementRef<HTMLElement>>('clearDialog');
  private readonly clearConfirmButton =
    viewChild<ElementRef<HTMLButtonElement>>('clearConfirmButton');

  private clearOpener: HTMLElement | null = null;

  protected readonly strings = EN_STRINGS;
  protected readonly confirmClear = signal(false);
  protected readonly liveMessage = signal('');

  protected readonly scenarios = this.comparison.scenarios;
  protected readonly count = this.comparison.count;
  protected readonly isEmpty = this.comparison.isEmpty;

  protected readonly scenarioLabels = computed(() =>
    this.scenarios().map((scenario, index) => this.scenarioLabel(index, scenario.profile)),
  );

  protected readonly provenanceMismatch = computed(() => {
    const list = this.scenarios();
    if (list.length < 2) {
      return false;
    }
    const versions = new Set(list.map((item) => item.model_version));
    const dates = new Set(list.map((item) => item.data_as_of));
    return versions.size > 1 || dates.size > 1;
  });

  protected readonly metricRows = computed<CompareRow[]>(() => {
    const list = this.scenarios();
    if (list.length === 0) {
      return [];
    }
    const labels = EN_STRINGS.compare.labels;
    return [
      {
        key: 'horizon',
        label: labels.horizon,
        values: list.map((s) => formatHorizon(s.horizon_years)),
      },
      {
        key: 'ratio',
        label: labels.ratio,
        values: list.map((s) => formatRatio(s.expense_income_ratio)),
      },
      {
        key: 'buffer',
        label: labels.buffer,
        values: list.map((s) => formatBufferMonths(s.buffer_months)),
      },
      {
        key: 'rebalance',
        label: labels.rebalance,
        values: list.map((s) => formatRebalanceFrequency(s.rebalance_frequency)),
      },
      {
        key: 'conversion',
        label: labels.conversion,
        values: list.map((s) => formatConversionCost(s.conversion_cost)),
      },
      {
        key: 'allocation',
        label: labels.allocation,
        values: list.map((s) => this.allocationText(s.weights)),
      },
      {
        key: 'shortfall_probability',
        label: labels.shortfallProbability,
        values: list.map((s) => formatPercent(s.shortfall_probability, 2)),
      },
      {
        key: 'cvar95',
        label: labels.cvar95,
        values: list.map(
          (s) => `${formatMonthsOfIncome(s.cvar95_cumulative_shortfall)} ${labels.monthsOfIncome}`,
        ),
      },
      {
        key: 'var95',
        label: labels.var95,
        values: list.map(
          (s) => `${formatMonthsOfIncome(s.var95_cumulative_shortfall)} ${labels.monthsOfIncome}`,
        ),
      },
      {
        key: 'mean',
        label: labels.meanShortfall,
        values: list.map(
          (s) => `${formatMonthsOfIncome(s.mean_cumulative_shortfall)} ${labels.monthsOfIncome}`,
        ),
      },
      {
        key: 'depletion',
        label: labels.depletion,
        values: list.map((s) => formatPercent(s.wealth_depletion_probability, 2)),
      },
      {
        key: 'identification',
        label: labels.identification,
        values: list.map((s) => this.identificationLabel(s)),
      },
      {
        key: 'model_version',
        label: labels.modelVersion,
        values: list.map((s) => s.model_version),
      },
      {
        key: 'data_as_of',
        label: labels.dataAsOf,
        values: list.map((s) => s.data_as_of),
      },
      {
        key: 'paths',
        label: labels.paths,
        values: list.map((s) => formatInteger(s.simulation_paths)),
      },
      {
        key: 'seed',
        label: labels.seed,
        values: list.map((s) => formatInteger(s.simulation_seed)),
      },
    ];
  });

  protected scenarioLabel(index: number, profile: string): string {
    return interpolate(EN_STRINGS.compare.scenarioLabel, {
      number: index + 1,
      profile: this.profileDisplayTitle(profile),
    });
  }

  protected profileDisplayTitle(profile: string): string {
    const id = profileIdFromName(profile);
    if (!id) {
      return EN_STRINGS.compare.profileUnavailable;
    }
    const table = EN_STRINGS.profiles as Record<string, { title: string } | undefined>;
    return table[id]?.title ?? EN_STRINGS.compare.profileUnavailable;
  }

  protected allocationText(weights: number[]): string {
    return interpolate(EN_STRINGS.compare.allocationText, {
      kzt: formatWeight(weights[0]),
      usd: formatWeight(weights[1]),
      eur: formatWeight(weights[2]),
    });
  }

  protected identificationLabel(scenario: ComparisonScenario): string {
    if (!scenario.identification_class) {
      return EN_STRINGS.common.notAvailable;
    }
    if (scenario.identification_class === WELL_IDENTIFIED) {
      return EN_STRINGS.results.identificationWellIdentified;
    }
    return humanizeIdentificationClass(scenario.identification_class);
  }

  protected removeAria(label: string): string {
    return interpolate(EN_STRINGS.compare.removeAria, { label });
  }

  protected remove(jobId: string): void {
    this.comparison.remove(jobId);
    this.liveMessage.set(EN_STRINGS.compare.removedLive);
  }

  protected openClearConfirm(event: Event): void {
    this.clearOpener = event.currentTarget as HTMLElement;
    this.confirmClear.set(true);
    afterNextRender(
      () => {
        this.clearConfirmButton()?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }

  protected cancelClear(): void {
    this.confirmClear.set(false);
    afterNextRender(
      () => {
        this.clearOpener?.focus();
        this.clearOpener = null;
      },
      { injector: this.injector },
    );
  }

  protected confirmClearAll(): void {
    this.comparison.clear();
    this.confirmClear.set(false);
    this.liveMessage.set(EN_STRINGS.compare.clearedLive);
    afterNextRender(
      () => {
        const heading = document.getElementById('compare-title');
        if (heading instanceof HTMLElement) {
          heading.setAttribute('tabindex', '-1');
          heading.focus();
        } else {
          this.clearOpener?.focus();
        }
        this.clearOpener = null;
      },
      { injector: this.injector },
    );
  }

  @HostListener('document:keydown', ['$event'])
  protected onDocumentKeydown(event: KeyboardEvent): void {
    if (!this.confirmClear()) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelClear();
      return;
    }

    if (event.key === 'Tab') {
      this.trapFocus(event);
    }
  }

  private trapFocus(event: KeyboardEvent): void {
    const dialog = this.clearDialog()?.nativeElement;
    if (!dialog) {
      return;
    }
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
    );

    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement as HTMLElement | null;

    if (event.shiftKey) {
      if (active === first || !dialog.contains(active)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }

    if (active === last || !dialog.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }
}
