import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import {
  AMOUNT_MAX_DECIMALS,
  RATE_MAX_DECIMALS,
  RAW_INPUT_MAX_LENGTH,
  canonicalCurrencies,
  errorsForStep,
  evaluateAssessment,
  firstInvalidStep,
  localIsoDate,
  stepForErrorKey,
} from '../../core/assessment/assessment-normalization';
import {
  ASSESSMENT_CURRENCIES,
  ASSESSMENT_HORIZONS,
  ASSESSMENT_OVERVIEW_STEP,
  ASSESSMENT_STEP_COUNT,
  type AssessmentDraft,
  type CurrencyLine,
  type ForeignCurrency,
  type RawAmounts,
} from '../../core/assessment/assessment.model';
import type { ApiError, CurrencyCode, ModelOptions } from '../../core/api/models';
import { OptimizationApiService } from '../../core/api/optimization-api.service';
import { EN_STRINGS } from '../../core/i18n/en';
import { AssessmentStore } from '../../core/state/assessment.store';
import {
  formatConversionCost,
  formatCurrencyAmount,
  formatHorizon,
  formatKzt,
  formatMonthsOfIncome,
  formatPercent,
  formatRate,
  formatRatio,
  formatRebalanceFrequency,
  interpolate,
} from '../../core/util/format.util';
import { ErrorPanel } from '../../shared/components/error-panel/error-panel';
import { InfoCallout } from '../../shared/components/info-callout/info-callout';
import { LoadingIndicator } from '../../shared/components/loading-indicator/loading-indicator';
import { PageContainer } from '../../shared/components/page-container/page-container';
import { SectionHeading } from '../../shared/components/section-heading/section-heading';
import {
  SegmentedControl,
  type SegmentedOption,
} from '../../shared/components/segmented-control/segmented-control';
import { StepIndicator } from '../../shared/components/step-indicator/step-indicator';

type CurrencyListKey = 'incomeCurrencies' | 'expenseCurrencies' | 'reserveCurrencies';
type AmountGroup = 'income' | 'expenses' | 'reserves';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Error key prefix used by the normalization utilities for each amount group. */
const ERROR_PREFIX: Record<AmountGroup, string> = {
  income: 'income',
  expenses: 'expense',
  reserves: 'reserve',
};

@Component({
  selector: 'app-assessment-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    RouterLink,
    PageContainer,
    SectionHeading,
    StepIndicator,
    SegmentedControl,
    ErrorPanel,
    InfoCallout,
    LoadingIndicator,
  ],
  templateUrl: './assessment.page.html',
})
export class AssessmentPage {
  private readonly api = inject(OptimizationApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly clearDialog = viewChild<ElementRef<HTMLElement>>('clearDialog');

  protected readonly store = inject(AssessmentStore);
  protected readonly strings = EN_STRINGS;
  protected readonly copy = EN_STRINGS.assessment;
  protected readonly steps = EN_STRINGS.assessment.steps;
  protected readonly currencies = ASSESSMENT_CURRENCIES;
  protected readonly overviewStep = ASSESSMENT_OVERVIEW_STEP;
  protected readonly today = localIsoDate();

  protected readonly draft = this.store.draft;
  protected readonly step = computed(() => this.draft().step);
  protected readonly evaluation = computed(() => evaluateAssessment(this.draft(), this.today));
  protected readonly overview = computed(() => this.evaluation().overview);
  protected readonly errors = computed(() => this.evaluation().errors);

  protected readonly incomeCurrencies = computed(() =>
    canonicalCurrencies(this.draft().incomeCurrencies),
  );
  protected readonly expenseCurrencies = computed(() =>
    canonicalCurrencies(this.draft().expenseCurrencies),
  );
  protected readonly reserveCurrencies = computed(() =>
    this.draft().noReserve ? [] : canonicalCurrencies(this.draft().reserveCurrencies),
  );

  protected readonly options = signal<ModelOptions | null>(null);
  protected readonly optionsLoading = signal(true);
  protected readonly optionsError = signal<ApiError | null>(null);

  /** Steps whose Continue action was attempted; their errors are shown. */
  private readonly attemptedSteps = signal<ReadonlySet<number>>(new Set());
  /** Fields the user has left at least once. */
  private readonly touchedFields = signal<ReadonlySet<string>>(new Set());

  protected readonly confirmClear = signal(false);
  protected readonly liveMessage = signal('');
  private clearOpener: HTMLElement | null = null;
  /** Elements made inert while the dialog is open, so they can be restored exactly. */
  private inertedElements: HTMLElement[] = [];

  protected readonly horizonOptions: SegmentedOption[] = ASSESSMENT_HORIZONS.map((value) => ({
    value,
    label: formatHorizon(value),
  }));

  protected readonly rebalanceOptions = computed<SegmentedOption[]>(() =>
    (this.options()?.rebalance_frequencies ?? []).map((value) => ({
      value,
      label: formatRebalanceFrequency(value),
    })),
  );

  /** Documented conversion costs that also respect the API's min/max bounds. */
  protected readonly conversionCostOptions = computed<SegmentedOption[]>(() => {
    const spec = this.options()?.conversion_cost;
    if (!spec) {
      return [];
    }
    return spec.documented_values
      .filter((value) => value >= spec.min && value <= spec.max)
      .map((value) => ({ value, label: formatConversionCost(value) }));
  });

  protected readonly cashflowSections = computed(() => [
    {
      key: 'income',
      data: this.overview().income,
      heading: this.copy.overview.incomeHeading,
      totalLabel: this.copy.overview.totalIncomeLabel,
    },
    {
      key: 'expenses',
      data: this.overview().expenses,
      heading: this.copy.overview.expensesHeading,
      totalLabel: this.copy.overview.totalExpensesLabel,
    },
  ]);

  protected readonly remainingDisplay = computed(() => {
    const value = this.overview().incomeAfterEssentialKzt;
    return value === null ? this.copy.summary.pending : this.remainingText(value);
  });

  protected readonly currentStepErrors = computed(() =>
    errorsForStep(this.errors(), Math.min(this.step(), ASSESSMENT_STEP_COUNT - 1)),
  );

  constructor() {
    if (this.draft().step === ASSESSMENT_OVERVIEW_STEP && !this.evaluation().complete) {
      this.store.setStep(Math.max(firstInvalidStep(this.errors()), 0));
    }
    this.destroyRef.onDestroy(() => this.releaseBackground());
    this.loadOptions();
  }

  /* ---------- Model options ---------- */

  protected loadOptions(): void {
    this.optionsLoading.set(true);
    this.optionsError.set(null);
    this.api
      .getOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (options) => {
          this.options.set(options);
          this.optionsLoading.set(false);
          this.dropUnsupportedSettings(options);
        },
        error: (error: ApiError) => {
          this.optionsError.set(error);
          this.optionsLoading.set(false);
        },
      });
  }

  private dropUnsupportedSettings(options: ModelOptions): void {
    const { rebalanceFrequency, conversionCost } = this.draft();
    const allowedCosts = this.conversionCostOptions().map((option) => option.value);
    const patch: Partial<AssessmentDraft> = {};
    if (
      rebalanceFrequency !== null &&
      !options.rebalance_frequencies.includes(rebalanceFrequency)
    ) {
      patch.rebalanceFrequency = null;
    }
    if (conversionCost !== null && !allowedCosts.includes(conversionCost)) {
      patch.conversionCost = null;
    }
    if (Object.keys(patch).length) {
      this.store.patch(patch);
    }
  }

  /* ---------- Answer updates ---------- */

  protected isSelected(list: CurrencyListKey, code: CurrencyCode): boolean {
    return this.draft()[list].includes(code);
  }

  protected toggleCurrency(list: CurrencyListKey, code: CurrencyCode, checked: boolean): void {
    const current = new Set(this.draft()[list]);
    if (checked) {
      current.add(code);
    } else {
      current.delete(code);
    }
    this.store.patch({ [list]: canonicalCurrencies([...current]) } as Partial<AssessmentDraft>);
    this.markTouched(list);
  }

  protected setNoReserve(checked: boolean): void {
    this.store.patch(checked ? { noReserve: true, reserveCurrencies: [] } : { noReserve: false });
    this.markTouched('reserveCurrencies');
  }

  protected rawAmount(group: AmountGroup, code: CurrencyCode): string {
    return (this.draft()[group] as RawAmounts)[code] ?? '';
  }

  protected setAmount(group: AmountGroup, code: CurrencyCode, value: string): void {
    this.store.patch({
      [group]: { ...this.draft()[group], [code]: value },
    } as Partial<AssessmentDraft>);
  }

  protected rawRate(code: ForeignCurrency): string {
    return this.draft().rates[code] ?? '';
  }

  protected setRate(code: ForeignCurrency, value: string): void {
    this.store.patch({ rates: { ...this.draft().rates, [code]: value } });
  }

  protected setValuationDate(value: string): void {
    this.store.patch({ valuationDate: value });
  }

  protected setContribution(value: string): void {
    this.store.patch({ monthlyContribution: value });
  }

  protected setHorizon(value: string | number): void {
    this.store.patch({ horizonYears: Number(value) });
    this.markTouched('horizonYears');
  }

  protected setRebalance(value: string | number): void {
    this.store.patch({ rebalanceFrequency: String(value) });
  }

  protected setConversionCost(value: string | number): void {
    this.store.patch({ conversionCost: Number(value) });
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  /* ---------- Errors ---------- */

  protected markTouched(key: string): void {
    if (this.touchedFields().has(key)) {
      return;
    }
    this.touchedFields.update((set) => new Set(set).add(key));
  }

  protected amountErrorKey(group: AmountGroup, code: CurrencyCode): string {
    return `${ERROR_PREFIX[group]}.${code}`;
  }

  /** DOM id for an amount input, e.g. `income-USD`. */
  protected amountId(group: AmountGroup, code: CurrencyCode): string {
    return `${ERROR_PREFIX[group]}-${code}`;
  }

  protected showError(key: string): boolean {
    if (!this.errors()[key]) {
      return false;
    }
    return this.attemptedSteps().has(stepForErrorKey(key)) || this.touchedFields().has(key);
  }

  protected errorMessage(key: string): string {
    const code = this.errors()[key];
    if (!code) {
      return '';
    }
    const messages = this.copy.errors;
    if (code === 'required' && key.startsWith('rate.')) {
      return messages.requiredRate;
    }
    if (code === 'too_many_decimals') {
      return interpolate(messages.too_many_decimals, {
        decimals: key.startsWith('rate.') ? RATE_MAX_DECIMALS : AMOUNT_MAX_DECIMALS,
      });
    }
    if (code === 'too_long') {
      return interpolate(messages.too_long, { max: RAW_INPUT_MAX_LENGTH });
    }
    return messages[code];
  }

  /** `aria-describedby` value combining help text and a visible error. */
  protected describedBy(id: string, key: string, helpId: string | null = null): string | null {
    const ids = [helpId, this.showError(key) ? `${id}-error` : null].filter(Boolean);
    return ids.length ? ids.join(' ') : null;
  }

  protected stepHasVisibleErrors(): boolean {
    return (
      this.attemptedSteps().has(this.step()) && Object.keys(this.currentStepErrors()).length > 0
    );
  }

  /* ---------- Navigation ---------- */

  protected next(): void {
    const current = this.step();
    if (Object.keys(errorsForStep(this.errors(), current)).length) {
      this.attemptedSteps.update((set) => new Set(set).add(current));
      this.focusFirstError(current);
      return;
    }
    this.goToStep(current + 1);
  }

  protected previous(): void {
    this.goToStep(this.step() - 1);
  }

  protected viewOverview(): void {
    const invalid = firstInvalidStep(this.errors());
    if (invalid !== -1) {
      this.attemptedSteps.update((set) => {
        const next = new Set(set);
        for (let i = 0; i < ASSESSMENT_STEP_COUNT; i++) {
          next.add(i);
        }
        return next;
      });
      if (invalid !== this.step()) {
        this.goToStep(invalid, false);
      }
      this.focusFirstError(invalid);
      return;
    }
    this.store.setStep(ASSESSMENT_OVERVIEW_STEP);
    this.liveMessage.set(this.copy.live.overview);
    this.focusAfterRender('assessment-step-heading');
  }

  protected editStep(step: number): void {
    this.goToStep(step);
  }

  /** The horizon lives on the reserve step; focus its selected (or first) option. */
  protected editHorizon(): void {
    this.goToStep(2, false);
    afterNextRender(
      () => {
        const group = this.host.nativeElement.querySelector('[data-group="horizon"]');
        const target =
          group?.querySelector<HTMLInputElement>('input:checked') ??
          group?.querySelector<HTMLInputElement>('input');
        target?.focus();
      },
      { injector: this.injector },
    );
  }

  private goToStep(step: number, focusHeading = true): void {
    const target = Math.min(Math.max(step, 0), ASSESSMENT_STEP_COUNT - 1);
    this.store.setStep(target);
    this.liveMessage.set(
      interpolate(this.copy.live.step, {
        current: target + 1,
        total: ASSESSMENT_STEP_COUNT,
        label: this.steps[target]!.label,
      }),
    );
    if (focusHeading) {
      this.focusAfterRender('assessment-step-heading');
    }
  }

  private focusAfterRender(id: string): void {
    afterNextRender(
      () => {
        const el = this.host.nativeElement.querySelector<HTMLElement>(`#${id}`);
        el?.focus();
      },
      { injector: this.injector },
    );
  }

  private focusFirstError(step: number): void {
    const keys = Object.keys(errorsForStep(this.errors(), step));
    const selectors = keys.map((key) => this.selectorForErrorKey(key));
    afterNextRender(
      () => {
        for (const selector of selectors) {
          const el = this.host.nativeElement.querySelector<HTMLElement>(selector);
          if (el) {
            el.focus();
            return;
          }
        }
      },
      { injector: this.injector },
    );
  }

  private selectorForErrorKey(key: string): string {
    if (key.endsWith('Currencies')) {
      return `[data-group="${key}"] input:not([disabled])`;
    }
    if (key === 'incomeTotal') {
      return '[data-group="income-amounts"] input';
    }
    if (key === 'expenseTotal') {
      return '[data-group="expense-amounts"] input';
    }
    if (key === 'valuationDate') {
      return '#valuation-date';
    }
    if (key === 'horizonYears') {
      return '[data-group="horizon"] input';
    }
    return `#${key.replace('.', '-')}`;
  }

  /* ---------- Clear dialog ---------- */

  protected openClearDialog(event: Event): void {
    this.clearOpener = event.currentTarget as HTMLElement;
    this.confirmClear.set(true);
    afterNextRender(
      () => {
        const dialog = this.clearDialog()?.nativeElement;
        if (dialog) {
          this.isolateBackground(dialog);
        }
        this.host.nativeElement.querySelector<HTMLElement>('#assessment-clear-title')?.focus();
      },
      { injector: this.injector },
    );
  }

  protected cancelClear(): void {
    this.releaseBackground();
    this.confirmClear.set(false);
    afterNextRender(
      () => {
        this.clearOpener?.focus();
        this.clearOpener = null;
      },
      { injector: this.injector },
    );
  }

  protected confirmClearAnswers(): void {
    this.releaseBackground();
    this.store.clear();
    this.attemptedSteps.set(new Set());
    this.touchedFields.set(new Set());
    this.confirmClear.set(false);
    this.clearOpener = null;
    this.liveMessage.set(this.copy.clearDialog.clearedLive);
    afterNextRender(
      () => {
        const heading = this.host.nativeElement.querySelector<HTMLElement>('#assessment-title');
        heading?.setAttribute('tabindex', '-1');
        heading?.focus();
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
      this.cancelClear();
      return;
    }
    if (event.key === 'Tab') {
      this.trapFocus(event);
    }
  }

  /**
   * Wraps Tab/Shift+Tab inside the dialog. Focus starting on the dialog heading
   * (tabindex="-1") or anywhere outside the interactive controls is treated as
   * being before the first control and after the last one.
   */
  private trapFocus(event: KeyboardEvent): void {
    const dialog = this.clearDialog()?.nativeElement;
    if (!dialog) {
      return;
    }
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    event.preventDefault();
    if (!focusable.length) {
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    const index = active ? focusable.indexOf(active) : -1;
    let next: number;
    if (index === -1) {
      next = event.shiftKey ? focusable.length - 1 : 0;
    } else if (event.shiftKey) {
      next = index === 0 ? focusable.length - 1 : index - 1;
    } else {
      next = index === focusable.length - 1 ? 0 : index + 1;
    }
    focusable[next]!.focus();
  }

  /** Marks every branch of the page outside the dialog as inert. */
  private isolateBackground(dialog: HTMLElement): void {
    this.releaseBackground();
    let node: HTMLElement | null = dialog;
    while (node && node !== document.body) {
      const parent: HTMLElement | null = node.parentElement;
      for (const sibling of Array.from(parent?.children ?? [])) {
        if (sibling !== node && sibling instanceof HTMLElement && !sibling.hasAttribute('inert')) {
          sibling.setAttribute('inert', '');
          this.inertedElements.push(sibling);
        }
      }
      node = parent;
    }
  }

  private releaseBackground(): void {
    for (const element of this.inertedElements) {
      element.removeAttribute('inert');
    }
    this.inertedElements = [];
  }

  /* ---------- Display helpers ---------- */

  protected currencyName(code: CurrencyCode): string {
    return EN_STRINGS.currencies[code].label;
  }

  protected fieldLabel(template: string, code: CurrencyCode): string {
    return interpolate(template, { currency: code });
  }

  protected kzt(value: number | null | undefined): string {
    return formatKzt(value);
  }

  protected amount(line: CurrencyLine): string {
    return formatCurrencyAmount(line.amount, line.currency);
  }

  protected percent(value: number | null | undefined): string {
    return formatPercent(value, 1);
  }

  protected ratio(value: number | null | undefined): string {
    return formatRatio(value);
  }

  protected months(value: number | null | undefined): string {
    return interpolate(this.copy.overview.coverageValue, {
      months: formatMonthsOfIncome(value, 2),
    });
  }

  protected remainingText(value: number): string {
    return value < 0
      ? interpolate(this.copy.overview.remainingNegative, { amount: formatKzt(-value) })
      : formatKzt(value);
  }

  protected rateText(code: ForeignCurrency): string {
    return `1 ${code} = ${formatRate(this.overview().valuation?.rates[code])} KZT`;
  }

  protected rebalanceText(): string {
    if (!this.options()) {
      return this.copy.overview.settingsUnavailable;
    }
    const value = this.draft().rebalanceFrequency;
    return value ? formatRebalanceFrequency(value) : this.copy.overview.notSelected;
  }

  protected conversionCostText(): string {
    if (!this.options()) {
      return this.copy.overview.settingsUnavailable;
    }
    const value = this.draft().conversionCost;
    return value === null ? this.copy.overview.notSelected : formatConversionCost(value);
  }

  protected horizonText(): string {
    return formatHorizon(this.overview().horizonYears);
  }

  protected editLabel(section: string): string {
    return interpolate(this.copy.actions.editSection, { section });
  }
}
