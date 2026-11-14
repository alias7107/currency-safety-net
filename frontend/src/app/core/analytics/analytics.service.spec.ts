import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';

import {
  ANALYTICS_CONFIG,
  DEFAULT_ANALYTICS_CONFIG,
  type AnalyticsConfig,
} from '../config/analytics.config';
import { AnalyticsService, CLARITY_TAG_URL } from './analytics.service';

@Component({ template: '' })
class BlankPage {}

type ClarityWindow = Window & {
  clarity?: ((...args: unknown[]) => void) & { q?: ArrayLike<unknown>[] };
};
const win = window as ClarityWindow;
const PRODUCTION: Partial<AnalyticsConfig> = { productionHosts: [window.location.hostname] };

function setup(config: Partial<AnalyticsConfig> = PRODUCTION): AnalyticsService {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'a', component: BlankPage },
        { path: 'b', component: BlankPage },
      ]),
      { provide: ANALYTICS_CONFIG, useValue: { ...DEFAULT_ANALYTICS_CONFIG, ...config } },
    ],
  });
  return TestBed.inject(AnalyticsService);
}

function tags(): HTMLScriptElement[] {
  return Array.from(
    document.querySelectorAll<HTMLScriptElement>(`script[src^="${CLARITY_TAG_URL}"]`),
  );
}

function calls(): unknown[][] {
  return Array.from(win.clarity?.q ?? [], (args) => Array.from(args));
}

describe('AnalyticsService', () => {
  beforeEach(() => localStorage.clear());

  afterEach(() => {
    tags().forEach((tag) => tag.remove());
    delete win.clarity;
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('stays disabled on localhost by default, including automated tests', () => {
    expect(window.location.hostname).toBe('localhost');
    const analytics = setup({});
    analytics.init();
    analytics.track('assessment_started');
    expect(analytics.enabled).toBe(false);
    expect(tags()).toHaveLength(0);
    expect(win.clarity).toBeUndefined();
  });

  it('can run on a development host with the explicit opt-in', () => {
    localStorage.setItem(DEFAULT_ANALYTICS_CONFIG.devOptInStorageKey, 'true');
    const analytics = setup({});
    analytics.init();
    expect(analytics.enabled).toBe(true);
    expect(tags()).toHaveLength(1);
  });

  it('targets the public domains and existing project', () => {
    expect(DEFAULT_ANALYTICS_CONFIG.productionHosts).toEqual([
      'currencysafety.com',
      'www.currencysafety.com',
    ]);
    expect(DEFAULT_ANALYTICS_CONFIG.clarityProjectId).toBe('zdcnl83dsj');
  });

  it('loads the async tag on initialization without a click or a stored choice', () => {
    const analytics = setup();
    analytics.init();
    const [tag] = tags();
    expect(tags()).toHaveLength(1);
    expect(tag!.src).toBe('https://www.clarity.ms/tag/zdcnl83dsj');
    expect(tag!.async).toBe(true);
    expect(localStorage.length).toBe(0);
    expect(calls()).toEqual([]);
  });

  it.each(['granted', 'denied'])(
    'does not use the legacy %s choice as a startup gate',
    (choice) => {
      localStorage.setItem('csn.analytics-consent.v1', choice);
      setup().init();
      expect(tags()).toHaveLength(1);
      expect(calls()).toEqual([]);
    },
  );

  it('initializes once across repeated calls', () => {
    const analytics = setup();
    analytics.init();
    analytics.init();
    expect(tags()).toHaveLength(1);
    expect(calls()).toEqual([]);
  });

  it('sends named events without properties after initialization', () => {
    const analytics = setup();
    analytics.track('assessment_started');
    analytics.init();
    analytics.track('assessment_started');
    analytics.track('assessment_step_completed');
    expect(calls()).toEqual([
      ['event', 'assessment_started'],
      ['event', 'assessment_step_completed'],
    ]);
  });

  it('deduplicates events without sending the job key', () => {
    const analytics = setup();
    analytics.init();
    const job = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    analytics.track('personal_simulation_result_viewed', job);
    analytics.track('personal_simulation_result_viewed', job);
    analytics.track('personal_simulation_result_viewed', 'other-job');
    expect(calls()).toEqual([
      ['event', 'personal_simulation_result_viewed'],
      ['event', 'personal_simulation_result_viewed'],
    ]);
    expect(JSON.stringify(calls())).not.toContain(job);
  });

  it('adds no tags or synthetic page-view calls on SPA navigation', async () => {
    const analytics = setup();
    analytics.init();
    const router = TestBed.inject(Router);
    for (const url of ['/a', '/b', '/a', '/b']) {
      await router.navigateByUrl(url);
    }
    analytics.init();
    expect(tags()).toHaveLength(1);
    expect(calls()).toEqual([]);
  });

  it('keeps working if the script fails to load', () => {
    const analytics = setup();
    analytics.init();
    expect(() => tags()[0]!.dispatchEvent(new Event('error'))).not.toThrow();
    expect(() => analytics.track('assessment_started')).not.toThrow();
  });

  it('never throws if script insertion or the tracker fails', () => {
    const analytics = setup();
    vi.spyOn(document, 'createElement').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => analytics.init()).not.toThrow();
    win.clarity = () => {
      throw new Error('tracker failure');
    };
    expect(() => analytics.track('assessment_started')).not.toThrow();
  });

  it('does not require browser storage on a production host', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const analytics = setup();
    expect(() => analytics.init()).not.toThrow();
    expect(tags()).toHaveLength(1);
  });

  it('stays disabled on other hosts when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const analytics = setup({});
    expect(() => analytics.init()).not.toThrow();
    expect(analytics.enabled).toBe(false);
    expect(tags()).toHaveLength(0);
  });
});
