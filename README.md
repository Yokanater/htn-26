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
