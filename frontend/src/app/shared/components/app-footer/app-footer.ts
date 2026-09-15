import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

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
                <a routerLink="/research/calculator">{{ strings.nav.assessment }}</a>
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
}
