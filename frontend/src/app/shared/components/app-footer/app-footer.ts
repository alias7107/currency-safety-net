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
              <li><a routerLink="/">{{ strings.nav.home }}</a></li>
              <li><a routerLink="/calculator">{{ strings.nav.calculator }}</a></li>
              <li><a routerLink="/methodology">{{ strings.nav.methodology }}</a></li>
            </ul>
          </div>
        </div>

        <div class="app-footer__meta">
          <p>{{ strings.footer.rights }}</p>
        </div>
      </app-page-container>
    </footer>
  `,
})
export class AppFooter {
  protected readonly strings = EN_STRINGS;
}
