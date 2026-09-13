import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { vi } from 'vitest';

import { routes } from '../../app.routes';
import { EN_STRINGS } from '../../core/i18n/en';
import {
  BUFFER_SENSITIVITY_RESULT,
  TEST_BATCH_JOB_ID,
  batchJobStatus,
} from '../../testing/buffer-sensitivity.fixtures';
import { errorBody } from '../../testing/fixtures';
import {
  BUFFER_SENSITIVITY_POLL_INTERVAL_MS,
  BufferSensitivityPage,
} from './buffer-sensitivity.page';

describe('BufferSensitivityPage', () => {
  let fixture: ComponentFixture<BufferSensitivityPage>;
  let http: HttpTestingController;
  let router: Router;
  const paramMap$ = new BehaviorSubject({
    get: (key: string) => (key === 'jobId' ? TEST_BATCH_JOB_ID : null),
  });
  const queryParamMap$ = new BehaviorSubject({
    get: (_key: string) => null as string | null,
  });

  async function tick(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    fixture.detectChanges();
  }

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return host().textContent ?? '';
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({
      imports: [BufferSensitivityPage],
      providers: [
        provideRouter(routes),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: (await import('@angular/router')).ActivatedRoute,
          useValue: {
            paramMap: paramMap$.asObservable(),
            queryParamMap: queryParamMap$.asObservable(),
          },
        },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  function create(): void {
    fixture = TestBed.createComponent(BufferSensitivityPage);
    fixture.detectChanges();
  }

  it('starts polling on direct URL and stops on success', async () => {
    create();
    await tick(0);
    http
      .expectOne(`/api/v1/buffer-sensitivity-jobs/${TEST_BATCH_JOB_ID}/`)
      .flush(batchJobStatus('queued'));
    fixture.detectChanges();
    expect(host().querySelector('[data-testid="batch-processing"]')).toBeTruthy();

    await tick(BUFFER_SENSITIVITY_POLL_INTERVAL_MS);
    http
      .expectOne(`/api/v1/buffer-sensitivity-jobs/${TEST_BATCH_JOB_ID}/`)
      .flush(batchJobStatus('succeeded', { result: BUFFER_SENSITIVITY_RESULT }));
    fixture.detectChanges();
    expect(host().querySelector('[data-testid="batch-result"]')).toBeTruthy();
    expect(host().querySelectorAll('h1').length).toBe(1);

    await tick(BUFFER_SENSITIVITY_POLL_INTERVAL_MS);
    http.expectNone(`/api/v1/buffer-sensitivity-jobs/${TEST_BATCH_JOB_ID}/`);
  });

  it('does not overlap poll requests while one is outstanding', async () => {
    create();
    await tick(0);
    const first = http.expectOne(`/api/v1/buffer-sensitivity-jobs/${TEST_BATCH_JOB_ID}/`);
    await tick(BUFFER_SENSITIVITY_POLL_INTERVAL_MS);
    http.expectNone(`/api/v1/buffer-sensitivity-jobs/${TEST_BATCH_JOB_ID}/`);
    first.flush(batchJobStatus('running'));
    fixture.detectChanges();
    await tick(BUFFER_SENSITIVITY_POLL_INTERVAL_MS);
    http
      .expectOne(`/api/v1/buffer-sensitivity-jobs/${TEST_BATCH_JOB_ID}/`)
      .flush(batchJobStatus('succeeded', { result: BUFFER_SENSITIVITY_RESULT }));
    fixture.detectChanges();
  });

  it('stops polling on failed status', async () => {
    create();
    await tick(0);
    http.expectOne(`/api/v1/buffer-sensitivity-jobs/${TEST_BATCH_JOB_ID}/`).flush(
      batchJobStatus('failed', {
        error_code: 'optimization_failed',
        error_message: 'The buffer sensitivity job failed. Please retry later.',
      }),
    );
    fixture.detectChanges();
    expect(text()).toContain(EN_STRINGS.bufferSensitivity.failedTitle);
    await tick(BUFFER_SENSITIVITY_POLL_INTERVAL_MS);
    http.expectNone(`/api/v1/buffer-sensitivity-jobs/${TEST_BATCH_JOB_ID}/`);
  });

  it('stops polling on destroy', async () => {
    create();
    await tick(0);
    http
      .expectOne(`/api/v1/buffer-sensitivity-jobs/${TEST_BATCH_JOB_ID}/`)
      .flush(batchJobStatus('running'));
    fixture.destroy();
    await tick(BUFFER_SENSITIVITY_POLL_INTERVAL_MS);
    http.expectNone(`/api/v1/buffer-sensitivity-jobs/${TEST_BATCH_JOB_ID}/`);
  });

  it('renders cached router-state success without polling', () => {
    vi.spyOn(router, 'getCurrentNavigation').mockReturnValue({
      extras: { state: { result: BUFFER_SENSITIVITY_RESULT, originJobId: 'origin' } },
    } as unknown as ReturnType<Router['getCurrentNavigation']>);
    create();
    expect(host().querySelector('[data-testid="batch-result"]')).toBeTruthy();
    http.expectNone(`/api/v1/buffer-sensitivity-jobs/${TEST_BATCH_JOB_ID}/`);
  });

  it('keeps scientific values in the mobile card representation', async () => {
    create();
    await tick(0);
    http
      .expectOne(`/api/v1/buffer-sensitivity-jobs/${TEST_BATCH_JOB_ID}/`)
      .flush(batchJobStatus('succeeded', { result: BUFFER_SENSITIVITY_RESULT }));
    fixture.detectChanges();
    const cards = host().querySelector('[data-testid="buffer-table-mobile"]');
    expect(cards?.textContent).toContain('18%');
    expect(cards?.textContent).toContain('2.10');
    expect(cards?.textContent).toContain(EN_STRINGS.bufferSensitivity.depletionImplNote);
    expect(host().querySelector('[data-testid="discrete-buffer-chart"]')).toBeTruthy();
    expect(host().querySelector('#target-metric')).toBeTruthy();
    expect(host().querySelector('#target-threshold')).toBeTruthy();
  });

  it('preserves a validated origin query parameter across refresh', async () => {
    const origin = '8b1f0d1c-6b21-4d0e-9f26-4f2b1c0d5e7a';
    queryParamMap$.next({ get: (key: string) => (key === 'origin' ? origin : null) });
    create();
    await tick(0);
    http
      .expectOne(`/api/v1/buffer-sensitivity-jobs/${TEST_BATCH_JOB_ID}/`)
      .flush(batchJobStatus('succeeded', { result: BUFFER_SENSITIVITY_RESULT }));
    fixture.detectChanges();
    const back = host().querySelector<HTMLAnchorElement>('[data-testid="batch-back"]');
    expect(back?.getAttribute('href')).toContain(`/results/${origin}`);
  });

  it('shows API errors without creating a new job on retry', async () => {
    create();
    await tick(0);
    http
      .expectOne(`/api/v1/buffer-sensitivity-jobs/${TEST_BATCH_JOB_ID}/`)
      .flush(errorBody('not_found', 'Missing.'), { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();
    host().querySelector<HTMLButtonElement>('button')?.click();
    await tick(0);
    http.expectOne(`/api/v1/buffer-sensitivity-jobs/${TEST_BATCH_JOB_ID}/`);
  });
});
