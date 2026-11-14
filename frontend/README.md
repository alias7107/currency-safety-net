# Frontend

Angular standalone application for household assessments and research scenarios.
Use the Node.js version in the root `.node-version` file.

```bash
npm ci
npm start
```

The development server runs on `http://localhost:4200` and forwards `/api` to
the Django server on port 8000. See [local development](../docs/development.md)
for backend and worker setup.

## Structure

- `src/app/pages/`: landing, research, questionnaires, results, comparison and reports.
- `src/app/core/api/`: research API types, validation and requests.
- `src/app/core/household/`: personal simulation requests, validation and presentation.
- `src/app/core/assessment/`: household input parsing and normalization.
- `src/app/core/state/`: form drafts and scenario comparison state.
- `src/app/core/i18n/en.ts`: English interface text.
- `src/app/shared/components/`: reusable interface components.
- `src/styles/`: shared styles and print layout.

## Routes

| Route                        | Purpose                                                 |
| ---------------------------- | ------------------------------------------------------- |
| `/`                          | Product introduction                                    |
| `/assessment`                | Household questionnaire and overview                    |
| `/assessment/results/:jobId` | Personal simulation status and results                  |
| `/research`                  | Research background and preprint                        |
| `/research/calculator`       | Four-profile research calculator                        |
| `/results/:jobId`            | Research calculation status and results                 |
| `/buffer-sensitivity/:jobId` | Tested buffer comparison                                |
| `/compare`                   | Research scenarios saved in the current browser session |
| `/report/:jobId`             | Printable research report                               |

`/calculator` redirects to the research calculator; `/methodology` redirects
to `/research`. API calls use relative `/api/v1/` URLs.

## Verification

```bash
npm test -- --watch=false
npm run build
```

Tests use Vitest and Angular's HTTP testing tools. Production assets are
generated under `dist/`; deployment serves them through Caddy.
