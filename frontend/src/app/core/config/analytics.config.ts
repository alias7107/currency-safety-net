import { InjectionToken } from '@angular/core';

export interface AnalyticsConfig {
  /** Microsoft Clarity project ID. */
  clarityProjectId: string;
  /** Hosts where analytics starts automatically. */
  productionHosts: readonly string[];
  /**
   * localStorage key for a manual development check on any other host:
   * `localStorage.setItem('csn.analytics.dev-opt-in', 'true')`, then reload.
   */
  devOptInStorageKey: string;
  /** Microsoft Privacy Statement, linked from the analytics notice as Clarity's terms require. */
  microsoftPrivacyUrl: string;
}

export const DEFAULT_ANALYTICS_CONFIG: AnalyticsConfig = {
  clarityProjectId: 'zdcnl83dsj',
  productionHosts: ['currencysafety.com', 'www.currencysafety.com'],
  devOptInStorageKey: 'csn.analytics.dev-opt-in',
  microsoftPrivacyUrl: 'https://go.microsoft.com/fwlink/?LinkId=521839',
};

export const ANALYTICS_CONFIG = new InjectionToken<AnalyticsConfig>('ANALYTICS_CONFIG', {
  providedIn: 'root',
  factory: () => DEFAULT_ANALYTICS_CONFIG,
});
