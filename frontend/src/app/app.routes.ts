import { Routes } from '@angular/router';

import { EN_STRINGS } from './core/i18n/en';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: EN_STRINGS.app.documentTitle,
    loadComponent: () => import('./pages/landing/landing.page').then((m) => m.LandingPage),
  },
  {
    path: 'assessment',
    title: `${EN_STRINGS.calculator.title} — ${EN_STRINGS.app.name}`,
    loadComponent: () =>
      import('./pages/calculator/calculator.page').then((m) => m.CalculatorPage),
  },
  {
    path: 'calculator',
    redirectTo: 'assessment',
    pathMatch: 'full',
  },
  {
    path: 'results/:jobId',
    title: `${EN_STRINGS.results.title} — ${EN_STRINGS.app.name}`,
    loadComponent: () => import('./pages/results/results.page').then((m) => m.ResultsPage),
  },
  {
    path: 'research',
    title: `${EN_STRINGS.research.title} — ${EN_STRINGS.app.name}`,
    loadComponent: () => import('./pages/research/research.page').then((m) => m.ResearchPage),
  },
  {
    path: 'methodology',
    redirectTo: 'research',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: '',
  },
];
