import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { OptimizationResult } from '../../../core/api/models';
import { EN_STRINGS } from '../../../core/i18n/en';
import { buildResultNarrativeParagraphs } from '../../../core/util/result-interpretation.util';
import { SectionHeading } from '../section-heading/section-heading';

@Component({
  selector: 'app-result-narrative',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SectionHeading],
  template: `
    <section
      class="panel stack stack--4"
      aria-labelledby="result-narrative-title"
      data-testid="result-narrative"
    >
      <app-section-heading
        headingId="result-narrative-title"
        [heading]="strings.results.phase2b.narrativeHeading"
        [body]="strings.results.phase2b.narrativeBody"
      />
      <div class="result-narrative__body stack stack--3">
        @for (paragraph of paragraphs(); track $index) {
          <p data-testid="narrative-paragraph">{{ paragraph }}</p>
        }
      </div>
    </section>
  `,
})
export class ResultNarrative {
  readonly result = input.required<OptimizationResult>();

  protected readonly strings = EN_STRINGS;

  protected readonly paragraphs = computed(() => buildResultNarrativeParagraphs(this.result()));
}
