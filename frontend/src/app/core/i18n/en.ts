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
    tagline: 'Research-based household currency resilience',
    skipToContent: 'Skip to main content',
    documentTitle: 'Currency Safety Net — research-based household currency resilience',
  },

  nav: {
    label: 'Primary',
    menuButton: 'Menu',
    openMenu: 'Open navigation menu',
    closeMenu: 'Close navigation menu',
    home: 'Home',
    howItWorks: 'How it works',
    whoItHelps: 'Who it helps',
    research: 'Research',
    assessment: 'Assessment',
    compare: 'Compare',
    compareWithCount: 'Compare ({count})',
    primaryAction: 'Check my resilience',
  },

  footer: {
    about:
      'Currency Safety Net helps households explore modelled currency resilience using a research-based FX allocation model over simulated exchange-rate paths.',
    disclaimerHeading: 'Scope',
    disclaimer:
      'Results are modelled outcomes for the scenario you entered. They are not exchange-rate forecasts, not investment advice, and not a statement about what any currency will do in future.',
    linksHeading: 'Sections',
    rights: 'Research demonstrator. No account, bank connection, or transactions.',
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
    heroTitle: 'Would your emergency fund still protect your household when exchange rates move?',
    heroBody:
      'Choose the household situation closest to yours and explore how different currency mixes and buffer sizes perform across thousands of simulated exchange-rate scenarios.',
    heroCta: 'Check my resilience',
    heroSecondaryCta: 'View the published research',
    trustLine: 'No account · No bank connection · Research-based model · Not financial advice',
    illustrationAlt:
      'Diagram of a household savings buffer held in tenge, dollars and euros, sheltered under a protective arc representing modelled shortfall coverage.',

    whoHeading: 'Who it helps',
    whoBody:
      'The assessment is designed for households navigating more than one currency in everyday life. It may help explore modelled resilience — it does not claim measured impact on real outcomes.',
    whoAudiences: [
      {
        title: 'Currency-mismatch households',
        body: 'Designed for households that earn in one currency and spend in another.',
      },
      {
        title: 'Foreign-currency income',
        body: 'May help explore situations where wages or contracts arrive in USD or EUR while costs stay local.',
      },
      {
        title: 'Remittance-receiving families',
        body: 'Designed for families who receive support from abroad and cover local expenses.',
      },
      {
        title: 'Multi-currency emergency savings',
        body: 'May help explore buffers held across KZT, USD, or EUR.',
      },
    ],

    workflowHeading: 'How it works',
    workflowBody: 'Three short steps using documented research profiles and assumptions.',
    workflowSteps: [
      {
        title: 'Choose a household profile',
        body: 'Select the researched profile closest to how you earn and spend across currencies.',
      },
      {
        title: 'Set modelling assumptions',
        body: 'Choose the modelled horizon, buffer, rebalancing frequency, and conversion-cost assumption from documented values.',
      },
      {
        title: 'Review modelled risk',
        body: 'See the modelled currency allocation and shortfall-risk metrics for that scenario.',
      },
    ],

    outputsHeading: 'What you receive',
    outputsBody:
      'The assessment reports modelled results for the scenario you select — guidance for understanding the model, not a personal recommendation.',
    outputs: [
      {
        title: 'Transparent resilience profile',
        body: 'Separate views of tail severity, shortfall frequency, end-of-horizon depletion, and allocation identification — without collapsing them into a single score.',
      },
      {
        title: 'Tested buffer sensitivity',
        body: 'A side-by-side look at the four documented buffer sizes the model evaluates, using only returned values — never interpolated advice.',
      },
      {
        title: 'Modelled currency allocation',
        body: 'A KZT / USD / EUR mix selected by the research model for your inputs.',
      },
      {
        title: 'Assumptions and reproducibility metadata',
        body: 'The full set of selected assumptions plus model version, data as-of, path count, and seed.',
      },
    ],

    privacyHeading: 'Privacy in this version',
    privacyPoints: [
      'No account is required.',
      'The product does not connect to a bank.',
      'Names and contact details are not requested.',
      'An unfinished form is kept in your browser session only.',
      'Saved comparison scenarios stay in the current browser session only.',
      'When you run a scenario, the selected parameters and model results are stored by the service so the job can be retrieved and identical scenarios can reuse a cached result.',
    ],

    researchHeading: 'Based on published research',
    researchBody:
      'The model behind Currency Safety Net is based on the project’s published scientific research on household FX shortfall risk.',
    researchCta: 'Explore the research page',
    researchMethodLabel: 'Simulation method',
    researchPathsLabel: 'Simulated paths',
    researchVersionLabel: 'Model version',
    researchDataLabel: 'Historical FX data as of',
    metadataUnavailableNote:
      'Live model metadata could not be loaded. Research details will appear when the API is available.',

    limitationsHeading: 'Limitations',
    limitations: [
      'The model does not forecast exchange rates.',
      'Results are not individualized financial advice.',
      'Interest, inflation, tax, and deposit yield are not modelled.',
      'Outcomes depend on the assumptions you select and on historical data up to the as-of date.',
      'This version uses four predefined profiles evaluated in the research — not fully custom income, expense, or savings distributions.',
    ],

    ctaHeading: 'Ready to check a scenario?',
    ctaBody:
      'Open the assessment, choose a researched household profile, and review the modelled result.',
    ctaButton: 'Check my resilience',
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
          'The share of simulated paths whose buffer wealth was at or below the model’s depletion tolerance at the end of the horizon.',
      },
    },

    normalizationLabel: 'Income normalised to I₀ = 1',
    normalizationNote:
      'Shortfall figures are multiples of one month of income, not tenge amounts. A shortfall of 1.00 means one month of income went uncovered in total.',

    identificationHeading: 'Result stability',
    identificationWellIdentified: 'Well identified within the evaluated model specification',
    identificationWellIdentifiedBody:
      'Identification describes how clearly the reported allocation separates from nearby alternatives on the evaluated optimization surface. It is not a measure of household safety, not a forecast, and not a guarantee.',
    identificationWeaklyIdentified: 'Weakly identified within the evaluated model specification',
    identificationWeaklyIdentifiedBody:
      'Identification describes how clearly the reported allocation separates from nearby alternatives on the evaluated optimization surface. It is not a measure of household safety, not a forecast, and not a guarantee.',
    identificationNotIdentified: 'Not identified within the evaluated model specification',
    identificationNotIdentifiedBody:
      'Identification describes how clearly the reported allocation separates from nearby alternatives on the evaluated optimization surface. It is not a measure of household safety, not a forecast, and not a guarantee.',
    identificationOtherBody:
      'A human-readable identification summary is not available for this result. Identification describes separation on the evaluated optimization surface — not household safety, a forecast, or a guarantee.',
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

    comparisonAdd: 'Add to comparison',
    comparisonSaved: 'Saved for comparison',
    comparisonFull:
      'Three scenarios are already saved for comparison. Open Compare to review or remove one before adding another.',
    comparisonOpen: 'Compare scenarios',
    comparisonAddedLive: 'Scenario saved for comparison.',
    comparisonDuplicateLive: 'This scenario is already saved for comparison.',
    comparisonFullLive: 'Comparison is full. Remove a scenario on the Compare page first.',

    phase2b: {
      scenarioOverviewHeading: 'Scenario evaluated',
      scenarioOverviewBody:
        'These are the assumptions the model used for this run. Nothing below is a recommendation.',
      ratioObservationBelow:
        'Expense-to-income ratio is below 1: assumed income exceeds expenses in this scenario.',
      ratioObservationEqual:
        'Expense-to-income ratio is equal to 1: assumed income and expenses are equal in this scenario.',
      ratioObservationAbove:
        'Expense-to-income ratio is above 1: assumed expenses exceed income in this scenario.',

      narrativeHeading: 'What the model found',
      narrativeBody:
        'A factual summary of the returned allocation and the assumptions included in this calculation.',
      allocationList: 'KZT {kzt}, USD {usd}, EUR {eur}',
      narrativeAllocation: 'The model returned an allocation of {allocation}.',
      narrativeLargest:
        'For this scenario, the largest returned weight is {currency} ({code}) at {percent}.',
      narrativeLargestTied:
        'For this scenario, {currencies} share the largest returned weight at {percent}.',
      narrativeConcentrated:
        'The simulated result shows an allocation concentrated in {currency} ({code}), with no positive weight in the other listed currencies.',
      narrativeDistributed:
        'The simulated result shows an allocation distributed across {count} currencies with positive returned weights.',
      narrativeHorizonBuffer:
        'This calculation used a horizon of {horizon} {horizonUnit} and a starting buffer of {buffer} {bufferUnit}.',
      yearSingular: 'year',
      yearPlural: 'years',
      monthSingular: 'month',
      monthPlural: 'months',

      objectiveHeading: 'Primary optimization objective',
      objectiveBody:
        'CVaR95 is the average cumulative shortfall among the worst 5% of simulated paths. The optimizer searches for the allocation that minimizes this measure for the selected scenario.',
      objectiveValueLabel: 'Returned CVaR95 cumulative shortfall',
      objectiveUnit: 'months of income',
      objectiveResearchLink: 'Read the full methodology',
      objectiveNotAdvice:
        'This value is a modelled shortfall measure for the selected scenario. It is not a personal financial recommendation.',

      diagnosticsHeading: 'Diagnostic metrics',
      diagnosticsBody:
        'These figures help describe simulated outcomes for this scenario. They were not jointly optimized with CVaR95.',
      howToRead: 'How to read this',
      diagnostics: {
        shortfallProbability: {
          definition:
            'Share of simulated paths where expenses could not be fully covered at some point during the horizon.',
          howToRead:
            'A higher share means shortfall occurred on more simulated paths. This is a diagnostic description, not the objective the allocator minimized.',
        },
        var95: {
          definition: 'Cumulative shortfall level that is not exceeded on 95% of simulated paths.',
          howToRead:
            'This percentile summary describes the distribution of cumulative shortfall across paths. It is reported alongside the objective; it was not jointly optimized with CVaR95.',
          zeroNote:
            'A VaR95 of zero does not mean there is no risk. Losses can still appear in the worst tail of simulated paths, which CVaR95 and other diagnostics describe.',
        },
        meanShortfall: {
          definition:
            'Mean cumulative shortfall across every simulated path, including paths with no shortfall.',
          howToRead:
            'This average mixes paths with and without shortfall. It describes the simulated distribution; it was not jointly optimized with CVaR95.',
        },
        depletion: {
          definition:
            'The share of simulated paths whose buffer wealth was at or below the model’s depletion tolerance at the end of the horizon.',
          howToRead:
            'This end-of-horizon diagnostic describes how often terminal buffer wealth was at or below the model’s depletion tolerance. It is not an anytime-during-the-path measure, and it was not jointly optimized with CVaR95.',
        },
      },

      nextHeading: 'What you can do next',
      nextBody: 'These are product actions inside Currency Safety Net, not financial instructions.',
      nextCompare: 'Compare this result with another scenario',
      nextChange: 'Change one assumption and run the assessment again',
      nextAssumptions:
        'Review how expense-to-income ratio, buffer, horizon, rebalancing, and conversion cost define the scenario',
      nextResearch: 'Read the research methodology and limitations',
      nextOpenAssessment: 'Open the assessment',
      nextOpenResearch: 'Open the research page',
      nextOpenCompare: 'Open comparison',
      nextAddCompare: 'Add this result to comparison',
      exploreBuffers: 'Explore tested buffer levels',
      exploreBuffersBusy: 'Starting buffer sensitivity…',
      exploreBuffersError:
        'The buffer sensitivity job could not be started. You can stay on this result and try again shortly.',
      exploreBuffersHint:
        'Compares the four documented buffer sizes for this scenario’s other assumptions. One server job — not four separate runs.',

      limitationsHeading: 'Limitations',
      limitationsPoints: [
        'Results are simulation-based model outputs for the scenario you entered.',
        'Outputs depend on the model assumptions and the historical FX dataset used by the service.',
        'Exchange rates and household cash flows can differ from the simulated paths.',
        'This result is informational. It is not a guarantee and not individualized financial advice.',
      ],
    },

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
        body: 'A household that earns in one currency and spends in another carries exchange-rate risk on its everyday budget. If the currency you are paid in weakens against the currency you spend, your income covers less. The model asks a narrow question: given a savings buffer, which KZT, USD and EUR split produces the lowest average cumulative shortfall among the worst 5% of simulated paths?',
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
        body: 'Each candidate split is evaluated using CVaR95 of cumulative shortfall — the average cumulative shortfall among the worst 5% of simulated paths. The split with the lowest CVaR95 is reported as the model allocation. Shortfall probability and the other risk measures are shown as additional diagnostics.',
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
        body: 'The optimisation objective is a single measure: CVaR95 of cumulative shortfall (the average cumulative shortfall among the worst 5% of simulated paths). Candidate allocations are ranked by this CVaR95 value alone; the lowest-CVaR95 split is reported as the model allocation. Shortfall probability, VaR95 of cumulative shortfall, mean cumulative shortfall, and buffer-depletion probability are reported as diagnostics and are not jointly optimised.',
      },
      {
        title: 'Search procedure',
        body: 'The three-currency simplex is searched on a coarse grid, then refined around the best region under the CVaR95 objective. The number of coarse, refined and total evaluated points is reported with each result, together with an identification class describing how clearly the optimum separates from its neighbourhood on that objective.',
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

  research: {
    title: 'Published research',
    intro:
      'Currency Safety Net is based on published scientific research on household FX shortfall risk. This page summarises the model in plain language and technical detail, and shows live reproducibility metadata.',
    openAssessment: 'Open the research calculator',
    publication: {
      heading: 'Publication',
      paperTitle: 'Paper title will be listed here.',
      authors: 'Author details will be listed here.',
      placeholder: 'Publication link will be added here.',
      linkLabel: 'Read the published paper',
    },
    productNotes: {
      heading: 'How the product uses this research',
      noScoreTitle: 'Why there is no scalar resilience score',
      noScoreBody:
        'Shortfall frequency and tail severity are different quantities with different units. The published model does not define a weighting rule that would turn them into one 0–100 score, so the product keeps them separate in a resilience profile.',
      noRecommendedBufferTitle: 'Why the model does not recommend a buffer',
      noRecommendedBufferBody:
        'The research optimises currency allocation for a fixed buffer. It does not price the cost of holding cash, so it cannot identify an “optimal” or “recommended” emergency-fund size.',
      testedBuffersTitle: 'Why the explorer uses only {1, 3, 6, 12}',
      testedBuffersBody:
        'Those are the documented buffer months evaluated by the research specification. The Buffer Sensitivity Explorer shows only the four values returned by the batch API and does not estimate values between them.',
    },
    reproducibility: {
      heading: 'Reproducibility',
      body: 'Path count and random seed are fixed by the research specification and cannot be changed by the client. Identical scenario inputs return the same cached modelled result. Live parameter values above come from the model metadata endpoint.',
    },
    metadataUnavailableTitle: 'Model details temporarily unavailable',
    metadataUnavailableBody:
      'Live model metadata could not be loaded. The methodology above remains available, and you can try again.',
  },

  resilienceProfile: {
    heading: 'Resilience profile',
    body: 'A transparent multi-metric view of this scenario. CVaR95 is the only optimisation objective; other figures are diagnostics.',
    notScoreNote:
      'This profile is not a single score, risk grade, or good/bad band. Metrics are shown separately because the research does not combine them.',
    units: {
      monthsOfIncome: 'months of income',
    },
    objective: {
      badge: 'Primary optimisation objective',
      title: 'Worst-tail severity (CVaR95)',
      definition:
        'Average cumulative shortfall among the worst 5% of simulated paths, expressed in months of initial monthly income.',
      howToRead:
        'The allocator searches for the currency mix that minimises this measure for the selected scenario. Lower values mean lower modelled tail shortfall under that objective.',
      notAdvice:
        'This value is a modelled shortfall measure for the selected scenario. It is not a personal financial recommendation.',
    },
    frequency: {
      badge: 'Diagnostic — frequency, not severity',
      title: 'Shortfall frequency',
      definition:
        'Share of simulated paths where expenses could not be fully covered at some point during the horizon.',
      howToRead:
        'Frequency answers how often shortfall occurred. Severity (CVaR95) answers how large losses were in the worst tail. They are not interchangeable.',
    },
    depletion: {
      badge: 'Implementation-only diagnostic',
      title: 'End-of-horizon depletion',
      definition:
        'Share of simulated paths whose buffer wealth was at or below the model’s depletion tolerance at the end of the selected horizon.',
      howToRead:
        'This describes terminal wealth at the end of the horizon. It is not an anytime-during-the-path measure and was not jointly optimised with CVaR95.',
      horizonNote:
        'Labeled implementation-only because it is present in the shipped model outputs but is not part of the published methodology presentation.',
    },
    additional: {
      heading: 'Additional diagnostics',
      body: 'Reported alongside the objective. They were not jointly optimised with CVaR95.',
      badge: 'Diagnostic',
      var95: {
        title: 'VaR95 cumulative shortfall',
        definition: 'Cumulative shortfall level that is not exceeded on 95% of simulated paths.',
        howToRead:
          'A percentile summary of the shortfall distribution. Zero VaR95 does not imply an absence of tail losses when CVaR95 or other diagnostics are positive.',
      },
      meanShortfall: {
        title: 'Mean cumulative shortfall',
        definition:
          'Mean cumulative shortfall across every simulated path, including paths with no shortfall.',
        howToRead:
          'This average mixes paths with and without shortfall. It describes the simulated distribution; it was not jointly optimised with CVaR95.',
      },
    },
    identification: {
      heading: 'Allocation identification',
      surfaceNote:
        'Identification describes how clearly the reported allocation separates from nearby alternatives on the evaluated optimization surface. It is not a measure of household safety, not a forecast, and not a guarantee.',
      unavailableBody: 'A human-readable identification summary is not available for this result.',
      nearOptimalCount: 'Near-optimal allocations (within 1%)',
      nearOptimalFraction: 'Near-optimal share of evaluated surface',
    },
  },

  bufferSensitivity: {
    title: 'Buffer sensitivity',
    documentTitle: 'Buffer sensitivity',
    scopeBody:
      'This explorer compares modelled outcomes across the tested buffer levels returned by the server for one scenario. It does not recommend a buffer size and does not provide individualized financial advice.',
    testedOnlyNotice:
      'Tested values only. Charts and tables show the four returned buffer levels. Values between them are not estimated.',
    missingJobTitle: 'No buffer sensitivity job selected',
    missingJobBody: 'Start from a completed scenario result to explore tested buffer levels.',
    processingTitle: 'Evaluating tested buffer levels',
    processingBody:
      'Four tested buffer levels are being evaluated for this scenario. This can take several minutes. Results arrive together when the job finishes — there is no per-buffer progress.',
    processingLive: 'Buffer sensitivity status: {status}. Still running.',
    processingHint: 'You can leave this page and reopen the same link later.',
    statusQueued: 'Queued',
    statusRunning: 'Running',
    statusSucceeded: 'Complete',
    statusFailed: 'Failed',
    failedTitle: 'Buffer sensitivity could not be completed',
    failedBody:
      'The batch job did not finish. You can return to the original scenario result and try again later.',
    scenarioHeading: 'Scenario assumptions',
    scenarioBody:
      'Buffer size is varied by the server across tested levels; it is not listed here.',
    provenanceHeading: 'Provenance',
    chartHeading: 'Discrete comparison',
    chartBody:
      'One metric at a time. Bars mark tested buffer months only — no connecting line between them.',
    metricShortfall: 'Shortfall probability',
    metricCvar: 'CVaR95 cumulative shortfall',
    chartAria: 'Discrete chart of {metric} across tested buffer months',
    tableHeading: 'Results by tested buffer',
    tableBody: 'Every scientific value below comes from the batch API response.',
    cardsHeading: 'Results by tested buffer',
    colBuffer: 'Tested buffer (months)',
    colKzt: 'KZT weight',
    colUsd: 'USD weight',
    colEur: 'EUR weight',
    colShortfall: 'Shortfall probability',
    colCvar: 'CVaR95',
    colVar: 'VaR95',
    colIdentification: 'Identification',
    colDepletion: 'End-of-horizon depletion',
    depletionImplNote: 'implementation-only',
    allocationHeading: 'Allocation across tested buffers',
    allocationBody: 'Model-returned KZT / USD / EUR weights at each tested buffer.',
    targetHeading: 'Diagnostic target finder',
    targetBody:
      'Enter a threshold for one diagnostic metric. The finder reports the smallest tested buffer whose returned value meets that threshold. It does not interpolate between tested values.',
    targetMetricLabel: 'Diagnostic metric',
    targetThresholdLabelProbability: 'Maximum shortfall probability (%)',
    targetThresholdLabelCvar: 'Maximum CVaR95 (months of income)',
    targetApply: 'Find tested buffer',
    targetClear: 'Clear',
    targetResultFound:
      'The minimum tested buffer meeting your selected diagnostic threshold is {buffer} months.',
    targetResultNone: 'None of the tested buffer levels met your selected diagnostic threshold.',
    targetResultDisclaimer:
      'This compares only the tested values returned by the model. It does not estimate values between them and does not provide individualized financial advice.',
    targetInvalid:
      'Enter a valid non-negative threshold. For probability, use a percentage from 0 to 100.',
    limitationsHeading: 'Limitations',
    limitationsPoints: [
      'Only server-returned tested buffers are shown.',
      'CVaR95 remains the sole optimisation objective at each buffer; other metrics are diagnostics.',
      'Changing the diagnostic threshold does not re-run the model.',
      'Outputs are informational model results, not financial advice.',
    ],
    researchLink: 'Read why the product avoids scores and recommended buffers',
    actionBackResults: 'Back to scenario result',
    actionRunAnother: 'Run another assessment',
    detailLabels: {
      profile: 'Household profile',
      horizon: 'Horizon',
      ratio: 'Spending share of income',
      rebalance: 'Rebalancing',
      conversionCost: 'Conversion cost',
      modelVersion: 'Model version',
      dataAsOf: 'FX data as of',
      simulationPaths: 'Simulated paths',
      simulationSeed: 'Random seed',
      contractVersion: 'Contract version',
      datasetSha: 'Dataset SHA-256',
    },
  },

  compare: {
    title: 'Compare modelled scenarios',
    documentTitle: 'Compare scenarios',
    intro:
      'Side-by-side view of saved model outputs. No new optimisation runs on this page — only results you already completed.',
    scopeCallout:
      'This comparison shows differences between modelled scenarios. It does not determine which option is personally suitable and is not financial advice.',
    readingHeading: 'How to read this comparison',
    readingPoints: [
      'Each allocation minimises CVaR95 cumulative shortfall for that scenario’s inputs.',
      'Other risk figures are diagnostics reported alongside the objective, not alternative optimisation targets.',
      'Lower numerical values mean lower modelled values for that metric. A lower value is not a personal recommendation.',
      'Scenarios with different assumptions are not controlled experimental comparisons.',
    ],
    emptyBody:
      'Run a scenario and save its result to compare how different assumptions change the modelled allocation and shortfall-risk measures.',
    emptyCta: 'Open the assessment',
    oneHeading: 'One scenario saved',
    oneBody:
      'Save at least one more completed result to see a side-by-side comparison of modelled allocations and shortfall-risk measures.',
    oneCta: 'Add another scenario',
    clear: 'Clear comparison',
    clearConfirmTitle: 'Clear all saved scenarios?',
    clearConfirmBody:
      'This removes every scenario from the comparison list in this browser session. Individual results remain available if you still have their links.',
    clearConfirmAction: 'Clear all',
    clearCancel: 'Keep scenarios',
    remove: 'Remove from comparison',
    removeAria: 'Remove {label} from comparison',
    scenarioLabel: 'Scenario {number} — {profile}',
    profileUnavailable: 'Profile unavailable',
    metricColumn: 'Metric',
    provenanceWarningHeading: 'Different model provenance',
    provenanceWarningBody:
      'These saved scenarios were produced under different model versions or FX data-as-of dates. Differences are still shown, but they are not directly comparable without that qualification.',
    labels: {
      horizon: 'Horizon',
      ratio: 'Expense-to-income ratio',
      buffer: 'Starting buffer',
      rebalance: 'Rebalancing frequency',
      conversion: 'Conversion cost',
      allocation: 'Modelled allocation',
      shortfallProbability: 'Shortfall probability',
      cvar95: 'CVaR95 cumulative shortfall',
      var95: 'VaR95 cumulative shortfall',
      meanShortfall: 'Mean cumulative shortfall',
      depletion: 'Buffer-depletion probability',
      identification: 'Identification / stability',
      modelVersion: 'Model version',
      dataAsOf: 'FX data as of',
      paths: 'Simulation paths',
      seed: 'Simulation seed',
      monthsOfIncome: 'months of income',
    },
    allocationText: 'KZT {kzt}, USD {usd}, EUR {eur}',
    clearedLive: 'Comparison cleared.',
    removedLive: 'Scenario removed from comparison.',
  },

  report: {
    documentTitle: 'Scenario report',
    title: 'Scenario report',
    brand: 'Currency Safety Net',
    openAction: 'Open printable report',
    printAction: 'Print or save as PDF',
    printHelp: 'In the print dialog, choose “Save as PDF” to download a PDF copy.',
    printAria: 'Open the browser print dialog to print or save this report as a PDF',
    loadingTitle: 'Loading scenario report',
    loadingBody: 'Retrieving the scenario result for this report.',
    loadingLive: 'Loading scenario report.',
    notReadyTitle: 'Report not ready yet',
    notReadyBody:
      'This scenario is still queued or running. Open the results page to wait for the completed model output.',
    notReadyCta: 'Open results page',
    failedTitle: 'Scenario could not be completed',
    failedBody: 'The model run did not finish, so a printable report is not available.',
    missingJobTitle: 'No scenario selected',
    missingJobBody: 'Open the assessment to run a scenario before generating a report.',
    scopeHeading: 'Report scope',
    scopeBody:
      'This document contains simulation-based results for the selected scenario. It is not individualized financial advice and not a guarantee.',
    allocationHeading: 'Returned allocation',
    reproducibilityHeading: 'Reproducibility details',
    reproducibilityBody:
      'Values needed to identify this model run. They come from the API payload.',
    methodologyHeading: 'Methodology and limitations',
    methodologyPoints: [
      'Outputs are simulation-based model results for the selected scenario.',
      'Results depend on the selected model assumptions and the historical FX dataset used by the service.',
      'The model does not forecast exchange rates; it resamples historical behaviour up to the data as-of date.',
      'Actual household cash flows and exchange rates can differ from the simulated paths.',
      'This report is informational. It is not a guarantee and not individualized financial advice.',
    ],
    researchLink: 'Read the full research methodology',
    backToResults: 'Back to results',
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
