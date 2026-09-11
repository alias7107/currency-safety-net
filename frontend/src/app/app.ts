import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { EN_STRINGS } from './core/i18n/en';
import { AppFooter } from './shared/components/app-footer/app-footer';
import { AppHeader } from './shared/components/app-header/app-header';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, AppHeader, AppFooter],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly strings = EN_STRINGS;
}
