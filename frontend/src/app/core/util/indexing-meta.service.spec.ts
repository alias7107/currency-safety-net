import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meta } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';

import { IndexingMetaService } from './indexing-meta.service';

@Component({
  standalone: true,
  template: '',
})
class StubPage {}

describe('IndexingMetaService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: StubPage },
          { path: 'research', component: StubPage },
          { path: 'results/:jobId', component: StubPage },
          { path: 'compare', component: StubPage },
          { path: 'report/:jobId', component: StubPage },
          { path: 'buffer-sensitivity/:jobId', component: StubPage },
        ]),
        IndexingMetaService,
      ],
    });
  });

  it('marks capability URLs as noindex', async () => {
    const meta = TestBed.inject(Meta);
    const service = TestBed.inject(IndexingMetaService);
    const router = TestBed.inject(Router);
    service.start();
    await router.navigateByUrl('/results/00000000-0000-0000-0000-000000000001');
    expect(meta.getTag('name="robots"')?.content).toContain('noindex');
    await router.navigateByUrl('/compare');
    expect(meta.getTag('name="robots"')?.content).toContain('noindex');
    await router.navigateByUrl('/');
    expect(meta.getTag('name="robots"')?.content).toContain('index, follow');
    await router.navigateByUrl('/research');
    expect(meta.getTag('name="robots"')?.content).toContain('index, follow');
  });
});
