import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

import type { BufferSensitivityResult } from '../../../core/api/models';
import { EN_STRINGS } from '../../../core/i18n/en';
import { interpolate } from '../../../core/util/format.util';
import {
  findMinimumTestedBufferMeetingThreshold,
  parseCvarThresholdInput,
  parseProbabilityPercentInput,
  type TargetMetricKey,
} from '../../../core/util/target-finder.util';

/**
 * Pure frontend diagnostic target finder — never calls the API and never interpolates.
 */
@Component({
  selector: 'app-target-finder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form
      class="target-finder stack stack--4"
      data-testid="target-finder"
      (submit)="onSubmit($event)"
    >
      <div class="field">
        <label class="field__label" for="target-metric">{{
          strings.bufferSensitivity.targetMetricLabel
        }}</label>
        <select
          id="target-metric"
          class="field__control"
          name="metric"
          [value]="metric()"
          (change)="onMetricSelect($event)"
        >
          <option value="shortfall_probability">
            {{ strings.bufferSensitivity.metricShortfall }}
          </option>
          <option value="cvar95_cumulative_shortfall">
            {{ strings.bufferSensitivity.metricCvar }}
          </option>
        </select>
      </div>

      <div class="field">
        <label class="field__label" for="target-threshold">{{ thresholdLabel() }}</label>
        <input
          id="target-threshold"
          class="field__control"
          name="threshold"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          [value]="thresholdInput()"
          (input)="onThresholdInput($event)"
        />
      </div>

      <div class="results__actions">
        <button type="submit" class="button button--primary" data-testid="target-apply">
          {{ strings.bufferSensitivity.targetApply }}
        </button>
        <button
          type="button"
          class="button button--ghost"
          data-testid="target-clear"
          (click)="clear()"
        >
          {{ strings.bufferSensitivity.targetClear }}
        </button>
      </div>

      @if (invalid()) {
        <p class="field__error" data-testid="target-invalid" role="alert">
          {{ strings.bufferSensitivity.targetInvalid }}
        </p>
      }

      @if (outcome(); as current) {
        @if (current.status === 'found') {
          <p class="target-finder__result" data-testid="target-found">
            {{ foundMessage() }}
          </p>
          <p class="target-finder__disclaimer" data-testid="target-disclaimer">
            {{ strings.bufferSensitivity.targetResultDisclaimer }}
          </p>
        } @else if (current.status === 'none') {
          <p class="target-finder__result" data-testid="target-none">
            {{ strings.bufferSensitivity.targetResultNone }}
          </p>
          <p class="target-finder__disclaimer" data-testid="target-disclaimer">
            {{ strings.bufferSensitivity.targetResultDisclaimer }}
          </p>
        }
      }
    </form>
  `,
})
export class TargetFinder {
  readonly result = input.required<BufferSensitivityResult>();

  protected readonly strings = EN_STRINGS;
  protected readonly metric = signal<TargetMetricKey>('shortfall_probability');
  protected readonly thresholdInput = signal('');
  protected readonly invalid = signal(false);
  protected readonly outcome = signal<ReturnType<
    typeof findMinimumTestedBufferMeetingThreshold
  > | null>(null);

  protected readonly thresholdLabel = computed(() =>
    this.metric() === 'shortfall_probability'
      ? EN_STRINGS.bufferSensitivity.targetThresholdLabelProbability
      : EN_STRINGS.bufferSensitivity.targetThresholdLabelCvar,
  );

  protected readonly foundMessage = computed(() => {
    const current = this.outcome();
    if (!current || current.status !== 'found') {
      return '';
    }
    return interpolate(EN_STRINGS.bufferSensitivity.targetResultFound, {
      buffer: current.bufferMonths,
    });
  });

  protected onMetricSelect(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'shortfall_probability' || value === 'cvar95_cumulative_shortfall') {
      this.metric.set(value);
      this.outcome.set(null);
      this.invalid.set(false);
    }
  }

  protected onThresholdInput(event: Event): void {
    this.thresholdInput.set((event.target as HTMLInputElement).value);
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    const parsed =
      this.metric() === 'shortfall_probability'
        ? parseProbabilityPercentInput(this.thresholdInput())
        : parseCvarThresholdInput(this.thresholdInput());
    if (!parsed.ok) {
      this.invalid.set(true);
      this.outcome.set(null);
      return;
    }
    this.invalid.set(false);
    this.outcome.set(
      findMinimumTestedBufferMeetingThreshold(this.result(), this.metric(), parsed.value),
    );
  }

  protected clear(): void {
    this.thresholdInput.set('');
    this.outcome.set(null);
    this.invalid.set(false);
  }
}
