# Microsoft Clarity analytics

The public site loads Microsoft Clarity automatically at application startup.
There is no consent banner or analytics confirmation button.

## Configuration and startup

`frontend/src/app/core/config/analytics.config.ts` sets project ID `zdcnl83dsj`,
the production hosts `currencysafety.com` and `www.currencysafety.com`, and the
Microsoft privacy link displayed in the footer.

`AnalyticsService.init()` runs from the application initializer and inserts the
asynchronous `https://www.clarity.ms/tag/zdcnl83dsj` script once. Angular route
changes do not reinsert it or send duplicate page-view events. Script failures
do not interrupt the application.

The old `csn.analytics-consent.v1` preference is no longer read or written.
The application does not send a consent-granted signal on behalf of visitors.
Clarity's collection behavior depends on its project settings and regional
consent handling; loading the script does not override those controls. See
[Microsoft's setup guide](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-setup)
and [Consent API documentation](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-consent-api-v2).

## Data and events

Clarity provides page-usage analytics and session recordings with its default
masking. Page addresses can contain result job IDs. The footer and landing
privacy section describe the analytics; no extra masking framework is added.

Custom events contain only their names, with no amounts, form values, job IDs
or custom visitor identifiers:

| Event                               | Trigger                                                             |
| ----------------------------------- | ------------------------------------------------------------------- |
| `assessment_started`                | First answer in a new assessment; a restored draft does not count   |
| `assessment_step_completed`         | A validated step advances                                           |
| `assessment_overview_viewed`        | The household overview is displayed                                 |
| `personal_simulation_submitted`     | The server accepts a personal simulation                            |
| `personal_simulation_result_viewed` | A validated result is displayed, once per job while the app is open |
| `research_calculator_opened`        | The research calculator opens                                       |

## Local development

Analytics stays off on localhost and other non-production hosts, including
automated tests. To test manually in a browser, set
`localStorage.setItem('csn.analytics.dev-opt-in', 'true')` and reload. This sends
real data to the same Clarity project. Remove the flag with
`localStorage.removeItem('csn.analytics.dev-opt-in')` and reload to disable it.

Unit tests check automatic startup, one-time script insertion, event
deduplication, host restrictions, failure isolation and the passive footer
notice. These checks do not send data to Microsoft.
