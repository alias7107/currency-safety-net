/**
 * Centralised English copy.
 *
 * All user-visible text lives here so that RU and KK translations can be added
 * later without touching templates. Wording is deliberately descriptive of the
 * model: no advice, no forecasts, no guarantees.
 */

export const EN_STRINGS = {
  app: {
    name: 'Currency Safety Net',
    tagline: 'Research-based currency allocation scenarios',
    skipToContent: 'Skip to main content',
    documentTitle: 'Currency Safety Net — research-based currency allocation scenarios',
  },

  nav: {
    label: 'Primary',
    menuButton: 'Menu',
    openMenu: 'Open navigation menu',
    closeMenu: 'Close navigation menu',
    home: 'Overview',
    calculator: 'Calculator',
    methodology: 'Methodology',
    primaryAction: 'Run a scenario',
  },

  footer: {
    about:
      'Currency Safety Net runs a published household FX allocation model over simulated exchange-rate paths and reports the modelled outcome for the inputs you choose.',
    disclaimerHeading: 'Scope',
    disclaimer:
      'Results are model outputs for the scenario you entered. They are not exchange-rate forecasts, not investment advice, and not a statement about what any currency will do in future.',
    linksHeading: 'Sections',
    rights: 'Research demonstrator. No account, no transactions, no personal data stored.',
  },

  common: {
    loading: 'Loading',
    loadingOptions: 'Loading model options',
    retry: 'Try again',
    back: 'Back',
    next: 'Continue',
    edit: 'Edit',
    close: 'Close',
    dismiss: 'Dismiss',
    of: 'of',
    step: 'Step',
    optional: 'Optional',
    baseline: 'Baseline',
    baselineTitle: 'Baseline value used in the published research run',
    notAvailable: 'Not available',
    unavailable: 'Unavailable',
    show: 'Show',
    hide: 'Hide',
  },

  currencies: {
    KZT: { code: 'KZT', label: 'Kazakhstani tenge', short: 'Tenge' },
    USD: { code: 'USD', label: 'US dollar', short: 'Dollar' },
    EUR: { code: 'EUR', label: 'Euro', short: 'Euro' },
  },

  /**
   * Presentation metadata for the four household profiles. Keyed by the public
   * profile id so that internal engine names (for example
   * `P2_foreign_income_mismatch`) are never used as a primary heading.
   */
  profiles: {
    P1: {
      title: 'Local income, local spending',
      summary: 'You earn and spend in tenge.',
      explanation:
        'Income and expenses are both fully in KZT. This is the control profile in the research: there is no currency mismatch to manage.',
      incomeChips: ['Income: 100% KZT'],
      expenseChips: ['Expenses: 100% KZT'],
    },
    P2: {
      title: 'Foreign income, local spending',
      summary: 'You are paid in dollars but your costs are in tenge.',
      explanation:
        'All income arrives in USD while all expenses are settled in KZT. The gap between the currency you receive and the currency you spend is the mismatch the model evaluates.',
      incomeChips: ['Income: 100% USD'],
      expenseChips: ['Expenses: 100% KZT'],
    },
    P3: {
      title: 'Mixed income, local spending',
      summary: 'Half your income is in tenge, half in dollars.',
      explanation:
        'Income is split evenly between KZT and USD, and expenses are entirely in KZT. Part of your income already matches your spending currency.',
      incomeChips: ['Income: 50% KZT', 'Income: 50% USD'],
      expenseChips: ['Expenses: 100% KZT'],
    },
    P4: {
      title: 'Multi-currency income and spending',
      summary: 'You earn in dollars and euros, and spend in tenge and euros.',
      explanation:
        'Income is split between USD and EUR, while expenses are mostly KZT with a euro component. Several exchange rates affect the household at once.',
      incomeChips: ['Income: 50% USD', 'Income: 50% EUR'],
      expenseChips: ['Expenses: 80% KZT', 'Expenses: 20% EUR'],
    },
  },

  landing: {
    eyebrow: 'Household FX scenario model',
    heroTitle: 'See how a currency mix changes modelled shortfall risk',
    heroBody:
      'Currency Safety Net applies a published research model to your household situation. Choose how you earn and spend, set the assumptions, and the model reports the allocation with the lowest modelled shortfall risk over simulated exchange-rate paths.',
    heroCta: 'Build a scenario',
    heroSecondaryCta: 'Read the methodology',
    heroNote:
      'No sign-up, no account, no transactions. The model reports a scenario result, not a recommendation.',
    illustrationAlt:
      'Diagram of a household savings buffer held in tenge, dollars and euros, sheltered under a protective arc representing modelled shortfall coverage.',

    workflowHeading: 'How it works',
    workflowBody: 'Three steps, each using only inputs documented in the research.',
    workflowSteps: [
      {
        title: 'Describe your currency situation',
        body: 'Pick the household profile that matches how you receive income and where your expenses fall.',
      },
      {
        title: 'Set the modelling assumptions',
        body: 'Choose the horizon, spending-to-income ratio and buffer size from the values evaluated in the research.',
      },
      {
        title: 'Read the scenario result',
        body: 'The model returns an allocation across the three currencies together with the modelled shortfall risk it implies.',
      },
    ],

    currenciesHeading: 'Currencies in the model',
    currenciesBody:
      'The model works with three currencies. Every allocation is a split across exactly these.',

    methodologyHeading: 'What the model actually does',
    methodologyBody:
      'Exchange-rate paths are resampled from historical data using a stationary bootstrap, household cash flows are settled month by month, and each candidate currency split is scored on the shortfall it produces across all simulated paths.',
    methodologyPoints: [
      {
        title: 'Simulated paths, not predictions',
        body: 'Paths are generated by resampling historical FX behaviour. They describe a range of possible outcomes; they do not say which one will occur.',
      },
      {
        title: 'Shortfall as the objective',
        body: 'Allocations are ranked by modelled shortfall — how far the household falls short of covering expenses — rather than by expected return.',
      },
      {
        title: 'Fixed, reproducible run',
        body: 'Path count and random seed are fixed by the research specification, so the same inputs always produce the same scenario result.',
      },
      {
        title: 'Documented inputs only',
        body: 'The scenario builder exposes only the parameter values that were evaluated in the research, so results stay inside the studied range.',
      },
    ],

    dataHeading: 'Data and model version',
    dataAsOfLabel: 'Historical FX data as of',
    metadataUnavailableNote:
      'Live model metadata could not be loaded. Data as-of and version details will appear when the API is available.',
    dataBody:
      'The model has not seen any exchange-rate movement after this date. Scenario results describe the model, not current market conditions.',

    limitationsHeading: 'Limitations you should read first',
    limitations: [
      'This is not financial, tax or legal advice, and not a personal recommendation.',
      'The model does not forecast future exchange rates and cannot tell you what any currency will do.',
      'Results depend entirely on the assumptions you select and on historical data up to the as-of date.',
      'Household cash flows are stylised: income and expenses are normalised, steady and inflation-free.',
      'Interest, deposit yields, taxes, fees beyond the modelled conversion cost, and transfer limits are not included.',
      'A scenario result is one model output. It is not a statement about your actual finances.',
    ],

    ctaHeading: 'Ready to run a scenario?',
    ctaBody:
      'Building a scenario takes about a minute. You can change assumptions and run it again as many times as you like.',
    ctaButton: 'Open the scenario builder',
  },

  calculator: {
    title: 'Scenario builder',
    intro:
      'Three steps. Every value you can choose here is one that was evaluated in the research.',
    summaryHeading: 'Your scenario',
    summaryHint: 'Updated as you make changes.',

    steps: [
      { id: 'profile', label: 'Currency situation', short: 'Situation' },
      { id: 'assumptions', label: 'Assumptions', short: 'Assumptions' },
      { id: 'review', label: 'Review and run', short: 'Review' },
    ],

    stepProfile: {
      heading: 'How do you earn and spend?',
      body: 'Pick the profile closest to your household. Each one is a fixed income and expense currency mix defined in the research.',
      legend: 'Household currency profile',
      noneSelected: 'Select a profile to continue.',
    },

    stepAssumptions: {
      heading: 'Modelling assumptions',
      body: 'These control how the household is simulated. Values marked as baseline are the ones used in the published research run.',
      horizonLabel: 'Horizon',
      horizonHelp:
        'How many years of simulated exchange-rate paths the household is carried through.',
      horizonUnit: 'years',
      ratioLabel: 'Spending as a share of income',
      ratioHelp:
        'Monthly expenses divided by monthly income. 0.95 means expenses use 95% of income.',
      bufferLabel: 'Starting buffer',
      bufferHelp:
        'Savings held at the start, expressed in months of expenses. This is the pot the model allocates across currencies.',
      bufferUnit: 'months of expenses',
      advancedToggle: 'Advanced assumptions',
      advancedHint: 'Rebalancing and conversion cost. Leave as-is to match the research baseline.',
      rebalanceLabel: 'Rebalancing frequency',
      rebalanceHelp: 'How often the buffer is returned to its target currency split.',
      conversionCostLabel: 'Conversion cost',
      conversionCostHelp:
        'Proportional cost applied each time currency is converted, as a share of the converted amount.',
      normalizationNote:
        'Income is normalised to I₀ = 1, so every monetary figure is a multiple of one month of income rather than a tenge amount.',
    },

    stepReview: {
      heading: 'Review and run',
      body: 'Check the inputs below. The model runs on a worker and usually returns within a minute.',
      runButton: 'Run scenario',
      runningButton: 'Submitting…',
      editLink: 'Edit',
      runNote:
        'Running a scenario evaluates the allocation grid over all simulated paths. Identical inputs return the stored result immediately.',
    },

    validation: {
      profileRequired: 'Choose a household profile.',
      horizonRequired: 'Choose a horizon.',
      horizonInvalid: 'Choose one of the horizons evaluated in the research.',
      ratioInvalid: 'Choose one of the documented spending-to-income ratios.',
      bufferInvalid: 'Choose one of the documented buffer sizes.',
      rebalanceInvalid: 'Choose one of the documented rebalancing frequencies.',
      conversionCostInvalid: 'Choose one of the documented conversion costs.',
      formInvalid: 'Some inputs are outside the documented range. Fix them before running.',
    },

    optionsErrorTitle: 'Model options could not be loaded',
    optionsErrorBody:
      'The scenario builder needs the documented parameter values from the API before it can run.',
  },

  results: {
    title: 'Scenario result',
    processingTitle: 'Running your scenario',
    processingBody:
      'The model is evaluating the allocation grid over every simulated path. This page updates automatically.',
    processingLive: 'Scenario status: {status}. Still running.',
    processingHint: 'You can leave this page open. Refreshing keeps the same scenario.',
    statusQueued: 'Queued',
    statusRunning: 'Running',
    statusSucceeded: 'Complete',
    statusFailed: 'Failed',

    allocationHeading: 'Model allocation',
    allocationBody:
      'The currency split with the lowest modelled shortfall for the inputs you chose, across all simulated paths.',
    allocationLegendHeading: 'Allocation breakdown',
    allocationChartLabel: 'Model allocation across KZT, USD and EUR',

    metricsHeading: 'Modelled shortfall risk',
    metricsBody:
      'All figures below are model outputs for this scenario, expressed in months of income.',

    metrics: {
      shortfallProbability: {
        label: 'Modelled shortfall risk',
        explanation:
          'Share of simulated paths where the household could not fully cover its expenses at some point in the horizon.',
      },
      cvar95: {
        label: 'Average shortfall in the worst 5% of paths',
        explanation:
          'Mean cumulative shortfall across the worst 5% of simulated paths. This is the tail measure the allocation is optimised against.',
      },
      var95: {
        label: 'Shortfall at the 95th percentile',
        explanation:
          'Cumulative shortfall that is not exceeded on 95% of simulated paths. Zero means at least 95% of paths ended with no shortfall.',
      },
      meanShortfall: {
        label: 'Average shortfall across all paths',
        explanation:
          'Mean cumulative shortfall over every simulated path, including the many paths with no shortfall at all.',
      },
      depletion: {
        label: 'Buffer depletion rate',
        explanation:
          'Share of simulated paths where the starting buffer was fully used up before the end of the horizon.',
      },
    },

    normalizationLabel: 'Income normalised to I₀ = 1',
    normalizationNote:
      'Shortfall figures are multiples of one month of income, not tenge amounts. A shortfall of 1.00 means one month of income went uncovered in total.',

    identificationHeading: 'Result stability',
    identificationWellIdentified: 'Well identified within the evaluated model specification',
    identificationWellIdentifiedBody:
      'Within the grid that was searched, the reported allocation is clearly separated from the alternatives. This describes the model, not the future.',
    identificationOtherBody:
      'The optimiser reported this identification class for the searched grid. It describes how clearly the reported allocation separates from nearby allocations.',
    identificationClassLabel: 'Identification class',

    detailsHeading: 'Model details',
    detailsBody: 'Everything needed to reproduce this scenario result.',
    detailLabels: {
      profile: 'Household profile',
      horizon: 'Horizon',
      ratio: 'Spending share of income',
      buffer: 'Starting buffer',
      rebalance: 'Rebalancing',
      conversionCost: 'Conversion cost',
      modelVersion: 'Model version',
      dataAsOf: 'FX data as of',
      simulationPaths: 'Simulated paths',
      simulationSeed: 'Random seed',
      gridCoarse: 'Coarse grid points',
      gridRefined: 'Refined grid points',
      gridSurface: 'Total surface points',
      jobId: 'Scenario id',
    },

    interpretationHeading: 'Reading this result',
    interpretationPoints: [
      'This is the model’s output for the exact inputs you entered, not a recommendation to hold these currencies.',
      'The allocation minimises modelled shortfall over simulated paths. Different assumptions can produce a different split.',
      'Nothing here predicts exchange rates. The model resamples historical behaviour up to the data as-of date.',
    ],

    actionsHeading: 'What next',
    actionRunAnother: 'Run another scenario',
    actionChangeAssumptions: 'Change assumptions',
    actionMethodology: 'Read the methodology',

    failedTitle: 'Scenario could not be completed',
    failedBody: 'The model run did not finish. You can adjust your inputs and try again.',
    notFoundTitle: 'Scenario not found',
    notFoundBody:
      'This scenario id is not on the server. Scenario results are not kept forever — build the scenario again.',
    missingJobTitle: 'No scenario selected',
    missingJobBody: 'Open the scenario builder to run one.',
  },

  methodology: {
    title: 'Methodology',
    intro:
      'What the model does, what it deliberately leaves out, and how to read its output. Written twice: once in plain language, once with the technical detail.',

    plainHeading: 'In plain language',
    plainSections: [
      {
        title: 'The problem being modelled',
        body: 'A household that earns in one currency and spends in another carries exchange-rate risk on its everyday budget. If the currency you are paid in weakens against the currency you spend, your income covers less. The model asks a narrow question: given a savings buffer, which split across tenge, dollars and euros leaves the household short least often and least severely?',
      },
      {
        title: 'How possible futures are generated',
        body: 'The model does not guess where exchange rates are going. It resamples blocks of historical daily movements to build many alternative paths that preserve the statistical behaviour observed in the data — including calm stretches and sharp moves. Each path is one internally consistent way the past patterns could rearrange themselves.',
      },
      {
        title: 'How the household is simulated',
        body: 'Every month, income arrives in its currencies, expenses fall due in theirs, and the buffer covers whatever the income does not. Converting between currencies can cost a small proportional fee. If the household cannot cover its expenses, the gap is recorded as a shortfall.',
      },
      {
        title: 'How an allocation is chosen',
        body: 'Many candidate splits across the three currencies are tested on every simulated path. Each is scored on the shortfall it produces, with particular weight on the worst outcomes. The split with the best score for your inputs is reported as the model allocation.',
      },
      {
        title: 'What the numbers mean',
        body: 'Income is normalised to 1, so results are multiples of one month of income rather than tenge amounts. A shortfall of 1.00 means one month of income went uncovered in total. This keeps the result readable at any income level.',
      },
      {
        title: 'What this cannot tell you',
        body: 'It cannot tell you what exchange rates will do, whether to convert money, or what is right for your circumstances. It reports how a stylised household would have fared under resampled historical conditions, for one set of assumptions.',
      },
    ],

    technicalHeading: 'Technical specification',
    technicalSections: [
      {
        title: 'Data',
        body: 'Daily USD/KZT and EUR/KZT levels. The baseline estimation window and data as-of date are reported by the model metadata endpoint and shown below.',
      },
      {
        title: 'Data-generating process',
        body: 'Joint stationary bootstrap over daily log returns of both exchange rates, resampled in blocks so that cross-currency dependence and volatility clustering survive resampling. Paths are generated once at full horizon and sliced for shorter horizons so the seeded sequence is identical across horizons.',
      },
      {
        title: 'Household cash flows',
        body: 'Income I₀ is normalised to 1. Expenses are the spending-to-income ratio times income. The starting buffer is the buffer size in months multiplied by monthly expenses. Income and expense currency shares are fixed per profile and sum to one on each side.',
      },
      {
        title: 'Settlement and rebalancing',
        body: 'Cash flows are settled monthly at simulated exchange rates. Any deficit is met from the buffer, converting currencies as needed and applying the proportional conversion cost. The buffer is returned to its target weights at the selected rebalancing frequency.',
      },
      {
        title: 'Objective and risk metrics',
        body: 'Allocations are scored on cumulative shortfall. Reported metrics are the probability of any shortfall, the 95% value at risk of cumulative shortfall, the 95% conditional value at risk (the mean of the worst 5% of paths), the mean cumulative shortfall, and the probability of fully depleting the buffer.',
      },
      {
        title: 'Search procedure',
        body: 'The three-currency simplex is searched on a coarse grid, then refined around the best region. The number of coarse, refined and total evaluated points is reported with each result, together with an identification class describing how clearly the optimum separates from its neighbourhood.',
      },
      {
        title: 'Reproducibility',
        body: 'Path count and random seed are fixed by the research specification and are not client-settable. Identical inputs return an identical, cached scenario result.',
      },
    ],

    parametersHeading: 'Live model parameters',
    parametersBody: 'Read directly from the model metadata endpoint.',
    parameterLabels: {
      modelVersion: 'Model version',
      dataAsOf: 'FX data as of',
      estimationWindow: 'Baseline estimation window',
      simulationMethod: 'Data-generating process',
      simulationPaths: 'Simulated paths',
      simulationSeed: 'Random seed',
      currencies: 'Currencies',
      horizons: 'Supported horizons (years)',
      riskMetrics: 'Reported risk metrics',
      specification: 'Optimisation specification',
      datasetHash: 'Dataset checksum',
    },

    scopeHeading: 'Scope and exclusions',
    scopePoints: [
      'No exchange-rate forecast is produced or implied at any point.',
      'No interest, deposit yield, inflation or tax is modelled.',
      'No fees beyond the proportional conversion cost you select.',
      'No transfer limits, capital controls or account constraints.',
      'Income and expenses are constant in real terms over the horizon.',
      'Only the parameter values evaluated in the research are selectable.',
    ],

    metadataErrorTitle: 'Model parameters could not be loaded',
    metadataErrorBody:
      'The technical sections above still describe the model. Only the live parameter table is unavailable.',
  },

  errors: {
    genericTitle: 'Something went wrong',
    genericBody: 'The request could not be completed. Please try again.',
    validationTitle: 'Those inputs were rejected',
    validationBody:
      'The server rejected the scenario inputs. Adjust them to the documented values and try again.',
    notFoundTitle: 'Not found',
    notFoundBody: 'The requested item is no longer available on the server.',
    rateLimitTitle: 'Too many scenario runs',
    rateLimitBody:
      'Scenario runs are rate limited because each one is computationally expensive. Wait a short while and try again.',
    unavailableTitle: 'Service temporarily unavailable',
    unavailableBody:
      'The scenario queue is not accepting work right now. This is usually short-lived — try again in a moment.',
    networkTitle: 'Cannot reach the server',
    networkBody: 'Check your connection and try again.',
    serverTitle: 'Server error',
    serverBody: 'The server could not process the request. Try again shortly.',
    detailsToggle: 'Technical details',
  },
} as const;

export type EnStrings = typeof EN_STRINGS;
