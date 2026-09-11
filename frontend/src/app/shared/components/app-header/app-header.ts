import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  viewChild,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { EN_STRINGS } from '../../../core/i18n/en';
import { PageContainer } from '../page-container/page-container';

@Component({
  selector: 'app-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, PageContainer],
  template: `
    <header class="app-header">
      <app-page-container>
        <div class="app-header__inner">
          <a class="app-header__brand" routerLink="/">
            <svg class="app-header__mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
              <path
                d="M16 2.5 27 6.6v9.2c0 6.6-4.4 12.2-11 13.7-6.6-1.5-11-7.1-11-13.7V6.6z"
                fill="var(--color-accent-soft)"
                stroke="var(--color-accent)"
                stroke-width="1.8"
                stroke-linejoin="round"
              />
              <path d="M16 10.5v11" stroke="var(--color-kzt)" stroke-width="2.4" />
              <path d="M11.5 13h9M11.5 16.5h9" stroke="var(--color-kzt)" stroke-width="2.4" />
            </svg>
            <span class="app-header__brand-text">
              <span>{{ strings.app.name }}</span>
              <span class="app-header__brand-sub">{{ strings.app.tagline }}</span>
            </span>
          </a>

          <button
            #menuToggle
            type="button"
            class="app-header__toggle"
            [attr.aria-expanded]="menuOpen()"
            aria-controls="primary-navigation"
            [attr.aria-label]="menuOpen() ? strings.nav.closeMenu : strings.nav.openMenu"
            (click)="toggleMenu()"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              @if (menuOpen()) {
                <path
                  d="M4 4l12 12M16 4L4 16"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              } @else {
                <path
                  d="M3 5h14M3 10h14M3 15h14"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              }
            </svg>
          </button>

          <nav
            id="primary-navigation"
            class="app-header__nav"
            [class.is-open]="menuOpen()"
            [attr.aria-label]="strings.nav.label"
          >
            <a
              class="app-header__link"
              routerLink="/calculator"
              routerLinkActive="is-active"
              (click)="closeMenu()"
              >{{ strings.nav.calculator }}</a
            >
            <a
              class="app-header__link"
              routerLink="/methodology"
              routerLinkActive="is-active"
              (click)="closeMenu()"
              >{{ strings.nav.methodology }}</a
            >
            <a
              class="button button--primary app-header__cta"
              routerLink="/calculator"
              (click)="closeMenu()"
              >{{ strings.nav.primaryAction }}</a
            >
          </nav>
        </div>
      </app-page-container>
    </header>
  `,
})
export class AppHeader {
  private readonly menuToggle = viewChild<ElementRef<HTMLButtonElement>>('menuToggle');

  protected readonly strings = EN_STRINGS;
  protected readonly menuOpen = signal(false);

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected closeMenu(): void {
    this.menuOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (!this.menuOpen()) {
      return;
    }
    this.closeMenu();
    this.menuToggle()?.nativeElement.focus();
  }
}
