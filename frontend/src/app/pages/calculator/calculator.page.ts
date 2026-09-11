import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import type {
  ApiError,
  HouseholdProfileOption,
  ModelOptions,
  OptimizationRequest,
} from '../../core/api/models';
import { OptimizationApiService } from '../../core/api/optimization-api.service';
import { EN_STRINGS } from '../../core/i18n/en';
import { DEFAULT_SCENARIO, ScenarioFormStore } from '../../core/state/scenario-form.store';
import {
  formatBufferMonths,
  formatConversionCost,
  formatHorizon,
  formatRatio,
  formatRebalanceFrequency,
  profileIdFromName,
} from '../../core/util/format.util';
import { AssumptionSummary } from '../../shared/components/assumption-summary/assumption-summary';
import { ErrorPanel } from '../../shared/components/error-panel/error-panel';
import { InfoCallout } from '../../shared/components/info-callout/info-callout';
import { LoadingIndicator } from '../../shared/components/loading-indicator/loading-indicator';
import { PageContainer } from '../../shared/components/page-container/page-container';
import { ProfileCard } from '../../shared/components/profile-card/profile-card';
import { SectionHeading } from '../../shared/components/section-heading/section-heading';
import {
  SegmentedControl,
  type SegmentedOption,
} from '../../shared/components/segmented-control/segmented-control';
import { SkeletonCard } from '../../shared/components/skeleton-card/skeleton-card';
import { StepIndicator } from '../../shared/components/step-indicator/step-indicator';

export interface ProfileChoice {
  id: string;
  title: string;
  summary: string;
  incomeChips: readonly string[];
  expenseChips: readonly string[];
}

/** Restricts a control to the values the research actually evaluated. */
export function oneOfValidator(allowed: readonly unknown[]): ValidatorFn {
  return (control: AbstractControl) => {
    if (!allowed.length) {
      return null;
    }
    return allowed.some((candidate) => candidate === control.value)
      ? null
      : { notDocumented: { allowed, actual: control.value } };
  };
}

@Component({
  selector: 'app-calculator-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    PageContainer,
    SectionHeading,
    StepIndicator,
    ProfileCard,
    SegmentedControl,
    AssumptionSummary,
    ErrorPanel,
    InfoCallout,
    LoadingIndicator,
    SkeletonCard,
  ],
  templateUrl: './calculator.page.html',
})
export class CalculatorPage {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(OptimizationApiService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly store = inject(ScenarioFormStore);
  protected readonly strings = EN_STRINGS;
  protected readonly steps = EN_STRINGS.calculator.steps;

  protected readonly options = signal<ModelOptions | null>(null);
  protected readonly optionsLoading = signal(true);
  protected readonly optionsError = signal<ApiError | null>(null);
  protected readonly submitting = signal(false);
  protected readonly submitError = signal<ApiError | null>(null);
  protected readonly advancedOpen = signal(false);

  protected readonly step = this.store.step;

  readonly form = this.fb.group({
    profile: this.fb.control(this.store.scenario().profile, Validators.required),
    horizon_years: this.fb.control(this.store.scenario().horizon_years, Validators.required),
    expense_income_ratio: this.fb.control(
      this.store.scenario().expense_income_ratio,
      Validators.required,
    ),
    buffer_months: this.fb.control(this.store.scenario().buffer_months, Validators.required),
    rebalance_frequency: this.fb.control(
      this.store.scenario().rebalance_frequency,
      Validators.required,
    ),
    conversion_cost: this.fb.control(this.store.scenario().conversion_cost, Validators.required),
  });

  /** Merges API profile ids with the localized presentation metadata. */
  protected readonly profileChoices = computed<ProfileChoice[]>(() => {
    const profiles = this.options()?.profiles ?? [];
    return profiles.map((profile) => toProfileChoice(profile));
  });

  protected readonly horizonOptions = computed<SegmentedOption[]>(() => {
    const values = this.options()?.horizons_years ?? [];
    return values.map((value) => ({
      value,
      label: formatHorizon(value),
      baseline: value === DEFAULT_SCENARIO.horizon_years,
    }));
  });

  protected readonly ratioOptions = computed<SegmentedOption[]>(() => {
    const spec = this.options()?.expense_income_ratio;
    return (spec?.documented_values ?? []).map((value) => ({
      value,
      label: formatRatio(value),
      baseline: value === (spec?.default ?? DEFAULT_SCENARIO.expense_income_ratio),
    }));
  });

  protected readonly bufferOptions = computed<SegmentedOption[]>(() => {
    const spec = this.options()?.buffer_months;
    return (spec?.documented_values ?? []).map((value) => ({
      value,
      label: formatBufferMonths(value),
      baseline: value === (spec?.default ?? DEFAULT_SCENARIO.buffer_months),
    }));
  });

  protected readonly rebalanceOptions = computed<SegmentedOption[]>(() => {
    const values = this.options()?.rebalance_frequencies ?? [];
    return values.map((value) => ({
      value,
      label: formatRebalanceFrequency(value),
      baseline: value === DEFAULT_SCENARIO.rebalance_frequency,
    }));
  });

  protected readonly conversionCostOptions = computed<SegmentedOption[]>(() => {
    const spec = this.options()?.conversion_cost;
    return (spec?.documented_values ?? []).map((value) => ({
      value,
      label: formatConversionCost(value),
      baseline: value === (spec?.default ?? DEFAULT_SCENARIO.conversion_cost),
    }));
  });

  protected readonly selectedProfileTitle = computed(() => {
    const id = this.store.scenario().profile;
    const fromApi = this.profileChoices().find((choice) => choice.id === id);
    return fromApi?.title ?? localizedProfile(id)?.title ?? id;
  });

  protected readonly canLeaveProfileStep = computed(() => this.form.controls.profile.valid);

  constructor() {
    this.loadOptions();

    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      this.store.patch(value as Partial<OptimizationRequest>);
    });
  }

  protected loadOptions(): void {
    this.optionsLoading.set(true);
    this.optionsError.set(null);

    this.api
      .getOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (options) => {
          this.options.set(options);
          this.applyDocumentedValidators(options);
          this.optionsLoading.set(false);
        },
        error: (error: ApiError) => {
          this.optionsError.set(error);
          this.optionsLoading.set(false);
        },
      });
  }

  /**
   * Values are constrained to the documented grid only once the API has told us
   * what that grid is, so the form never invents its own allowed range.
   */
  private applyDocumentedValidators(options: ModelOptions): void {
    const controls = this.form.controls;
    const profileIds = options.profiles.map((profile) => profile.id);

    setValidators(controls.profile, [Validators.required, oneOfValidator(profileIds)]);
    setValidators(controls.horizon_years, [
      Validators.required,
      oneOfValidator(options.horizons_years),
    ]);
    setValidators(controls.expense_income_ratio, [
      Validators.required,
      oneOfValidator(options.expense_income_ratio.documented_values),
    ]);
    setValidators(controls.buffer_months, [
      Validators.required,
      oneOfValidator(options.buffer_months.documented_values),
    ]);
    setValidators(controls.rebalance_frequency, [
      Validators.required,
      oneOfValidator(options.rebalance_frequencies),
    ]);
    setValidators(controls.conversion_cost, [
      Validators.required,
      oneOfValidator(options.conversion_cost.documented_values),
    ]);
  }

  protected selectProfile(profileId: string): void {
    this.form.controls.profile.setValue(profileId);
    this.form.controls.profile.markAsTouched();
  }

  protected setControlValue(
    name: 'horizon_years' | 'expense_income_ratio' | 'buffer_months' | 'conversion_cost',
    value: string | number,
  ): void {
    this.form.controls[name].setValue(Number(value));
    this.form.controls[name].markAsTouched();
  }

  protected setRebalanceFrequency(value: string | number): void {
    this.form.controls.rebalance_frequency.setValue(String(value));
    this.form.controls.rebalance_frequency.markAsTouched();
  }

  protected toggleAdvanced(): void {
    this.advancedOpen.update((open) => !open);
  }

  protected goToStep(step: number): void {
    this.store.setStep(step);
  }

  protected next(): void {
    const current = this.step();
    if (current === 0 && this.form.controls.profile.invalid) {
      this.form.controls.profile.markAsTouched();
      return;
    }
    if (current === 1 && this.assumptionsInvalid()) {
      this.form.markAllAsTouched();
      return;
    }
    this.store.setStep(current + 1);
  }

  protected previous(): void {
    this.store.setStep(this.step() - 1);
  }

  protected assumptionsInvalid(): boolean {
    const c = this.form.controls;
    return (
      c.horizon_years.invalid ||
      c.expense_income_ratio.invalid ||
      c.buffer_months.invalid ||
      c.rebalance_frequency.invalid ||
      c.conversion_cost.invalid
    );
  }

  /** Exact snake_case body accepted by POST /api/v1/optimization-jobs/. */
  buildRequest(): OptimizationRequest {
    const value = this.form.getRawValue();
    return {
      profile: value.profile,
      horizon_years: Number(value.horizon_years),
      expense_income_ratio: Number(value.expense_income_ratio),
      buffer_months: Number(value.buffer_months),
      rebalance_frequency: value.rebalance_frequency,
      conversion_cost: Number(value.conversion_cost),
    };
  }

  protected runScenario(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.submitError.set(null);

    this.api
      .createOptimizationJob(this.buildRequest())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (submission) => {
          this.submitting.set(false);
          const body = submission.body;
          // A cached 200 already carries the result; hand it to the results page
          // so it can render immediately instead of polling for a finished job.
          const extras =
            body.cached && body.result ? { state: { result: body.result } } : undefined;
          void this.router.navigate(['/results', body.job_id], extras);
        },
        error: (error: ApiError) => {
          this.submitting.set(false);
          this.submitError.set(error);
        },
      });
  }

  protected controlInvalid(name: keyof CalculatorPage['form']['controls']): boolean {
    const control = this.form.controls[name];
    return control.invalid && (control.touched || control.dirty);
  }
}

function setValidators(control: AbstractControl, validators: ValidatorFn[]): void {
  control.setValidators(validators);
  control.updateValueAndValidity({ emitEvent: false });
}

function localizedProfile(id: string) {
  const key = profileIdFromName(id) ?? id.toUpperCase();
  const table = EN_STRINGS.profiles as Record<string, ProfileCopy | undefined>;
  return table[key];
}

interface ProfileCopy {
  title: string;
  summary: string;
  explanation: string;
  incomeChips: readonly string[];
  expenseChips: readonly string[];
}

function toProfileChoice(profile: HouseholdProfileOption): ProfileChoice {
  const copy = localizedProfile(String(profile.id));
  return {
    id: String(profile.id),
    title: copy?.title ?? String(profile.id),
    summary: copy?.summary ?? profile.description,
    incomeChips: copy?.incomeChips ?? [],
    expenseChips: copy?.expenseChips ?? [],
  };
}
