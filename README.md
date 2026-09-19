# Grove

A friendly market-intelligence workspace for Shopify brands. Teammate 4's first platform implementation, based on [the product brief](docs/SHOPIFY_ECOSYSTEM_INTELLIGENCE_DESIGN.md).

## Run locally

Requires Node **22.15+** (uses `node:sqlite`) and npm.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. The API runs on port 3001. No API keys or database service required. Fonts and illustrations are bundled locally.

## What works

- Responsive merchant workspace, report library, search, confidence filters, sorting, and saved brands.
- Store intake → editable profile confirmation → streamed report progress.
- Collaborator cards, competitor/discourse analysis, SWOT, and prioritized experiments.
- Evidence drawers, component scores, confidence, caveats, feedback, and JSON export.
- SQLite persistence, opaque browser sessions, workspace-scoped queries, idempotent report creation, restart recovery, cancellation, and partial-result behavior.
- API health counters in workspace settings; deterministic fixture providers for local integration.

**This is a local product demo.** All brands, rankings, comments, and source excerpts are fictional. Store URLs are saved but never crawled. Every new report uses the same specialty-coffee fixture. Real authentication, production Postgres/queue adapters, live vendor integrations, and deployment are not implemented.

## Check and build

```sh
npm test
npx playwright install chromium
npm run test:e2e
npm run build
npm start
```

## Browserbase

Put `BROWSERBASE_API_KEY` in `.env`. If the account contains multiple projects,
also set `BROWSERBASE_PROJECT_ID`. Verify the cloud browser connection with:

```sh
npm run browserbase:smoke
# Or browse a specific public page:
npm run browserbase:smoke -- https://example.com
```

The smoke command creates a short-lived Browserbase session, connects over CDP,
loads the page, prints a small text preview, and closes the session. The reusable
adapter is `apps/api/src/browserbase.ts`.

To exercise the bounded storefront profiler directly:

```sh
npm run browserbase:profile -- https://your-store.example
```

Set `PROVIDER_MODE=browserbase` to use it from the new-report flow. This live mode
checks DNS and redirects, reads `robots.txt`, restricts browser navigation to the
store domain, visits a small homepage/About/collection/product sample, and records
source excerpts and content hashes. Store profiles are live; the downstream market
report research also runs live in Browserbase mode. Candidate brands are accepted
only after their public storefront is captured; evidence links point to those
pages. Results become partial instead of falling back to fictional brands when
too few supported candidates are available. Demo mode remains deterministic.

`npm start` serves the production web build and API together at **http://127.0.0.1:3001**. Run it after stopping the dev API, or choose another `PORT`.

The integration tests cover profile confirmation, idempotency, cancellation, partial results, evidence references, persistence, workspace isolation, and input validation. Browser tests cover desktop and mobile workflows and produce screenshots in `test-results/`.

## Layout

```text
apps/web/src/                 React product experience and styles
apps/api/src/                 Express API and persistent demo orchestration
packages/contracts/src/      Shared types, input schemas, and fictional fixtures
packages/db/migrations/      Proposed production Postgres schema (not applied)
tests/                       API integration and Playwright browser checks
docs/PLATFORM_HANDOFF.md      API contract, integration boundaries, and runbook
```

Data is stored in `.data/grove.sqlite` (gitignored). Use `DATABASE_PATH` to choose a separate demo database. Browser sessions are isolated; using a new browser session creates a fresh workspace. The SQLite experimental warning is expected on Node 22.

Shared contracts and the proposed Postgres schema need consuming-teammate review before becoming integration baselines. See the [platform handoff](docs/PLATFORM_HANDOFF.md).
