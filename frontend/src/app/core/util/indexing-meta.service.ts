import { Injectable, inject } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

/** Capability or private exploration URLs that must not be indexed. */
const NOINDEX_PREFIXES = ['/results/', '/report/', '/buffer-sensitivity/', '/compare'] as const;

@Injectable({ providedIn: 'root' })
export class IndexingMetaService {
  private readonly meta = inject(Meta);
  private readonly router = inject(Router);

  start(): void {
    this.apply(this.router.url);
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => this.apply(event.urlAfterRedirects));
  }

  private apply(url: string): void {
    const path = url.split('?')[0] ?? url;
    const noindex = NOINDEX_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
    this.meta.updateTag({
      name: 'robots',
      content: noindex ? 'noindex, nofollow' : 'index, follow',
    });
  }
}
