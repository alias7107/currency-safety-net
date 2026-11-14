import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AnalyticsService } from '../../../core/analytics/analytics.service';
import { ANALYTICS_CONFIG } from '../../../core/config/analytics.config';
import { EN_STRINGS } from '../../../core/i18n/en';
import { PageContainer } from '../page-container/page-container';

@Component({
  selector: 'app-footer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageContainer],
  template: `
    <footer class="app-footer">
      <app-page-container>
        <div class="app-footer__grid">
          <div class="stack stack--3">
            <p>{{ strings.footer.about }}</p>
            <h2 class="app-footer__heading">{{ strings.footer.disclaimerHeading }}</h2>
            <p>{{ strings.footer.disclaimer }}</p>
          </div>
          <div class="stack stack--3">
            <h2 class="app-footer__heading">{{ strings.footer.linksHeading }}</h2>
            <ul class="app-footer__links">
              <li>
                <a routerLink="/">{{ strings.nav.home }}</a>
              </li>
              <li>
                <a routerLink="/assessment">{{ strings.nav.householdAssessment }}</a>
              </li>
              <li>
                <a routerLink="/research/calculator">{{ strings.nav.researchCalculator }}</a>
              </li>
              <li>
                <a routerLink="/compare">{{ strings.nav.compare }}</a>
              </li>
              <li>
                <a routerLink="/research">{{ strings.nav.research }}</a>
              </li>
            </ul>
          </div>
        </div>

        @if (analytics.enabled) {
          <div class="app-footer__analytics stack stack--2" data-testid="analytics-notice">
            <h2 class="app-footer__heading">{{ copy.footerHeading }}</h2>
            <p>{{ copy.footerNotice }}</p>
            <a [href]="privacyUrl" target="_blank" rel="noopener noreferrer">{{
              copy.privacyLinkLabel
            }}</a>
          </div>
        }

        <div class="app-footer__meta">
          <p>{{ strings.footer.rights }}</p>
          <p class="app-footer__credit">
            {{ strings.footer.developedBy }} · {{ strings.footer.contactLabel }}:
            <a [href]="'mailto:' + strings.footer.contactEmail">{{
              strings.footer.contactEmail
            }}</a>
          </p>
        </div>
      </app-page-container>
    </footer>
  `,
})
export class AppFooter {
  protected readonly strings = EN_STRINGS;
  protected readonly copy = EN_STRINGS.analytics;
  protected readonly analytics = inject(AnalyticsService);
  protected readonly privacyUrl = inject(ANALYTICS_CONFIG).microsoftPrivacyUrl;
}
