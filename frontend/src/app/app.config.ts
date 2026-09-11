import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { ViewportScroller } from '@angular/common';
import { provideRouter, withInMemoryScrolling } from '@angular/router';

import { routes } from './app.routes';

/** Sticky header is ~64px; leave breathing room below it for fragment targets. */
export const ANCHOR_SCROLL_OFFSET_PX = 88;

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch()),
    provideRouter(
      routes,
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
    ),
    provideAppInitializer(() => {
      inject(ViewportScroller).setOffset([0, ANCHOR_SCROLL_OFFSET_PX]);
    }),
  ],
};
