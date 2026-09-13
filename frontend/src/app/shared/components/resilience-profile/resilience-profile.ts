import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { OptimizationResult } from '../../../core/api/models';
import { EN_STRINGS } from '../../../core/i18n/en';
import { buildResilienceProfileViewModel } from '../../../core/util/resilience-profile.util';
import { MetricExplanation } from '../metric-explanation/metric-explanation';
import { SectionHeading } from '../section-heading/section-heading';

/**
 * Transparent multi-metric resilience profile for a single succeeded optimization.
 * Never invents a scalar score, risk band, or recommended buffer.
 */
@Component({
  selector: 'app-resilience-profile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SectionHeading, MetricExplanation],
  template: `
    @if (view(); as profile) {
      <section
        class="resilience-profile stack stack--5"
        aria-labelledby="resilience-profile-title"
        data-testid="resilience-profile"
      >
        <app-section-heading
          headingId="resilience-profile-title"
          [heading]="profile.heading"
          [body]="profile.body"
        />

        <p class="resilience-profile__not-score" data-testid="resilience-not-score">
          {{ profile.notScoreNote }}
        </p>

        <article
          class="panel panel--objective resilience-profile__objective"
          data-testid="resilience-objective"
          [attr.data-role]="profile.objective.role"
        >
          @if (profile.objective.badge) {
            <p class="resilience-profile__badge">{{ profile.objective.badge }}</p>
          }
          <h3 class="resilience-profile__title">{{ profile.objective.title }}</h3>
          <p class="objective__value" data-testid="resilience-objective-value">
            <span class="objective__number">
              {{ profile.objective.value }}
              @if (profile.objective.unit) {
                <span class="objective__unit">{{ profile.objective.unit }}</span>
              }
            </span>
          </p>
          <p>{{ profile.objective.definition }}</p>
          <p class="resilience-profile__how">{{ profile.objective.howToRead }}</p>
          @if (profile.objective.note) {
            <p>{{ profile.objective.note }}</p>
          }
          <p class="normalization-note" data-testid="normalization-note">
            <strong>{{ strings.results.normalizationLabel }}.</strong>
            {{ strings.results.normalizationNote }}
          </p>
        </article>

        <div class="metric-explanation-grid">
          <article
            class="metric-explanation"
            data-testid="resilience-frequency"
            data-metric="shortfall_probability"
          >
            @if (profile.frequency.badge) {
              <p class="resilience-profile__badge">{{ profile.frequency.badge }}</p>
            }
            <h3 class="metric-explanation__label">{{ profile.frequency.title }}</h3>
            <p class="metric-explanation__value" data-testid="metric-explanation-value">
              {{ profile.frequency.value }}
            </p>
            <p class="metric-explanation__definition">{{ profile.frequency.definition }}</p>
            @if (alwaysExpanded()) {
              <div class="metric-explanation__expanded">
                <p class="metric-explanation__how-label">{{ strings.results.phase2b.howToRead }}</p>
                <p>{{ profile.frequency.howToRead }}</p>
              </div>
            } @else {
              <details class="metric-explanation__details">
                <summary>{{ strings.results.phase2b.howToRead }}</summary>
                <p>{{ profile.frequency.howToRead }}</p>
              </details>
            }
          </article>

          <article
            class="metric-explanation resilience-profile__depletion"
            data-testid="resilience-depletion"
            data-metric="wealth_depletion_probability"
          >
            @if (profile.depletion.badge) {
              <p class="resilience-profile__badge resilience-profile__badge--impl">
                {{ profile.depletion.badge }}
              </p>
            }
            <h3 class="metric-explanation__label">{{ profile.depletion.title }}</h3>
            <p class="metric-explanation__value" data-testid="resilience-depletion-value">
              {{ profile.depletion.value }}
            </p>
            <p class="metric-explanation__definition">{{ profile.depletion.definition }}</p>
            @if (profile.depletion.note) {
              <p class="metric-explanation__note">{{ profile.depletion.note }}</p>
            }
            @if (alwaysExpanded()) {
              <div class="metric-explanation__expanded">
                <p class="metric-explanation__how-label">{{ strings.results.phase2b.howToRead }}</p>
                <p>{{ profile.depletion.howToRead }}</p>
              </div>
            } @else {
              <details class="metric-explanation__details">
                <summary>{{ strings.results.phase2b.howToRead }}</summary>
                <p>{{ profile.depletion.howToRead }}</p>
              </details>
            }
          </article>
        </div>

        <section
          class="stack stack--3"
          aria-labelledby="resilience-additional-title"
          data-testid="resilience-additional"
        >
          <h3 id="resilience-additional-title" class="resilience-profile__subtitle">
            {{ strings.resilienceProfile.additional.heading }}
          </h3>
          <p>{{ strings.resilienceProfile.additional.body }}</p>
          <div class="metric-explanation-grid">
            @for (metric of profile.additionalDiagnostics; track metric.key) {
              <app-metric-explanation
                [metricKey]="metric.key"
                [label]="metric.title"
                [value]="metric.value"
                [unit]="metric.unit"
                [definition]="metric.definition"
                [howToRead]="metric.howToRead"
                [note]="metric.note"
                [alwaysExpanded]="alwaysExpanded()"
              />
            }
          </div>
        </section>

        <section
          class="panel stack stack--3"
          aria-labelledby="resilience-identification-title"
          data-testid="resilience-identification"
        >
          <h3 id="resilience-identification-title" class="resilience-profile__subtitle">
            {{ strings.resilienceProfile.identification.heading }}
          </h3>
          <p class="identification__value" data-testid="resilience-identification-label">
            {{ profile.identification.label }}
          </p>
          <p class="identification__body">{{ profile.identification.body }}</p>
          <p>{{ profile.identification.surfaceNote }}</p>
          @if (
            profile.identification.nearOptimalCount || profile.identification.nearOptimalFraction
          ) {
            <dl class="detail-grid detail-grid--compact">
              @if (profile.identification.nearOptimalCount) {
                <div class="detail-grid__row">
                  <dt class="detail-grid__term">
                    {{ strings.resilienceProfile.identification.nearOptimalCount }}
                  </dt>
                  <dd class="detail-grid__value" data-testid="resilience-near-count">
                    {{ profile.identification.nearOptimalCount }}
                  </dd>
                </div>
              }
              @if (profile.identification.nearOptimalFraction) {
                <div class="detail-grid__row">
                  <dt class="detail-grid__term">
                    {{ strings.resilienceProfile.identification.nearOptimalFraction }}
                  </dt>
                  <dd class="detail-grid__value" data-testid="resilience-near-frac">
                    {{ profile.identification.nearOptimalFraction }}
                  </dd>
                </div>
              }
            </dl>
          }
        </section>
      </section>
    }
  `,
})
export class ResilienceProfile {
  readonly result = input.required<OptimizationResult>();
  /** Expand “How to read” inline (printable report). */
  readonly alwaysExpanded = input(false);

  protected readonly strings = EN_STRINGS;

  protected readonly view = computed(() => buildResilienceProfileViewModel(this.result()));
}
