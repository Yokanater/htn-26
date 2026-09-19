# Teammate 4 — platform handoff

## Scope and status

Grove is a complete **local demo loop**, not a production launch. The UI and API work together without credentials. The original design document remains unchanged. Proposed shared contracts are version `1.0.0`; review with teammates 1–3 before adopting or modifying them.

Implemented: store context capture/confirmation, report snapshots, idempotency, persisted phase progression, SSE, restart recovery, cancellation, useful partial results, report library, collaborators, competitor themes, SWOT/actions, source drawers, saves, feedback, JSON export, and workspace-specific health counters.

Not implemented: actual storefront extraction, Shopify verification, vendor orchestration, production identity, invitations, Redis/Postgres queue execution, live evidence validation pipeline, deployment, distributed tracing, or quality-benchmark gates. The Postgres migration is a **proposal** and has not been run against Postgres.

## Visual direction

- Pine `#285847`, soft paper `#FAFBF8`, sage `#EDF1E6`, lavender `#E5DFEF`, apricot `#F4E0CF`, and straw `#F4EDCE`.
- Manrope headings and DM Sans interface text, bundled locally.
- A quiet sidebar and a spacious report workspace, with a connected product ecosystem as the signature illustration.
- Hand-drawn SVG product objects give fictional partners recognizable identities without stock photography or remote assets.
- One subtle card entrance; reduced-motion preferences disable animation. Visible keyboard focus, arrow-key report tabs, focus-trapped dialogs, and mobile navigation.
- Design critique: restrained the playfulness to product illustrations and conversational copy; kept scores, evidence, caveats, and actions direct. Removed an incidental decorative mark from the artwork during review.

## API contract

All API paths start with `/v1`. JSON errors use `{ "error": "Human-readable message" }`. Browser requests use an HttpOnly, SameSite=Strict opaque session cookie. This is anonymous local isolation, **not account authentication**. Same-origin requests only. `GET /session` initializes the demo workspace; call it before parallel bootstrap requests so they share a cookie.

| Method       | Path                         | Body / result                                                                                    |
| ------------ | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| GET          | `/session`                   | Demo workspace metadata; initializes one fictional report                                        |
| POST         | `/store-profiles`            | `name`, `url`, optional `category`, `audience`, `geography`, `goal`; returns unconfirmed profile |
| GET          | `/store-profiles/:id`        | Read owned profile                                                                               |
| PATCH        | `/store-profiles/:id`        | Correct context and confirm; increments version; URL remains immutable                           |
| POST         | `/reports`                   | `{ profileId, simulatePartial?: boolean }`; requires `Idempotency-Key`                           |
| GET          | `/reports`                   | Workspace reports, newest first                                                                  |
| GET          | `/reports/:id`               | Profile snapshot, progress, completed sections, evidence                                         |
| GET          | `/reports/:id/events`        | SSE `data:` records containing the current report; terminal record closes stream                 |
| POST         | `/reports/:id/cancel`        | Persist terminal cancellation; retain completed sections                                         |
| POST         | `/report-items/:id/feedback` | `{ rating: "useful" \| "not_useful" }`                                                           |
| GET          | `/feedback`                  | Map of item ID to feedback                                                                       |
| GET          | `/saved`                     | Saved demo brand IDs                                                                             |
| PUT / DELETE | `/saved/:id`                 | Save or remove a brand                                                                           |
| GET          | `/health`                    | API status, provider mode, storage type, running/completed/partial counts                        |

Report statuses: `queued → profiling → discovering → collecting → enriching → analyzing → synthesizing → completed | partial`. A nonterminal state can transition to `cancelled`. `failed` is reserved in the contract but the current fake does not generate it.

An idempotency key returns the existing report for the same profile ID and partial-simulation flag; changed inputs return 409. The run snapshots the confirmed profile. Demo profile rows hold the latest version; historical context remains in report snapshots. The proposed Postgres schema stores every profile version separately.

SSE sends complete snapshots every 500 ms; the demo advances approximately every 1.5 seconds. All phases are simulated. Collaborators become available at analysis; remaining complete sections appear at synthesis completion. Partial simulation withholds competitor and SWOT conclusions and explains the gap.

## Provider integration boundaries

`packages/contracts/src/index.ts` defines the rendering contract. `fixtures.ts` is a deterministic **fictional** success provider; `simulatePartial` is the failure fixture. The only current orchestration integration point is `createPlatform`'s worker in `apps/api/src/platform.ts`. It deliberately performs no vendor calls.

1. **Teammate 1**: replace context-only profiling with extracted and normalized profile data. Supply canonical evidence URLs, exact spans, dates, and provenance. Add real `shopify_confidence` and supporting signals before showing verification in the UI. The existing URL check is syntactic; live fetching must additionally implement DNS/redirect validation, policy checks, and budgets from the design document.
2. **Teammate 2**: supply decomposed fit scores and enriched evidence, with deployment versions. Current fit values and confidence labels are illustrative ranking aids, not probabilities. Canonical domain identities should replace fixture IDs for cross-report saves.
3. **Teammate 3**: supply cited collaborators, competitors, discourse, SWOT, and actions. Every material claim must resolve to run-owned evidence. Themes without evidence are currently rendered as explicit gaps. Replace the simplified UI payload with a reviewed adapter from the full analysis schema; do not drop provenance or infer sources.
4. **Platform follow-up**: add authenticated workspace membership, a Postgres repository, leased queue workers, server-side provider clients, retries/timeouts/cancellation hooks, and telemetry. Keep vendor keys out of the web bundle.

The demo trusts its compiled fixtures. Runtime validation of live report payloads, source URLs, and citation coverage must sit at the provider boundary before real data is introduced. The UI uses React text rendering rather than HTML insertion.

## Production schema proposal

`packages/db/migrations/001_platform.sql` sketches workspaces/memberships, immutable profile versions, idempotent runs, leased jobs, evidence, report items, claim/evidence relations, feedback, and saved domains. Composite foreign keys prevent cross-workspace and cross-run evidence attachment. Row-level policies require a transaction-scoped `app.workspace_id` and a non-owner application role. The application must authenticate membership **before** setting that value. It is not wired into the demo, and SQL migration/RLS verification remains outstanding.

## Local runbook

- Start: `npm install && npm run dev`; web 5173, API 3001. Requires Node 22.15+.
- Build: `npm run build`; run `npm start` to serve compiled web and API together.
- Configuration: set `PORT`, `HOST`, `DATABASE_PATH` as process environment variables. `.env.example` is a reference; no automatic `.env` loader is configured. Non-demo `PROVIDER_MODE` fails startup.
- Source failure: select **Try a partial report** in profile confirmation. Collaborators survive; unsupported sections remain empty with a clear message.
- Cancellation: click **Cancel report** during progress. It is persisted, repeatable, and does not resume after restart.
- Recovery: restart the API with the same `DATABASE_PATH`; nonterminal jobs resume from their persisted phase. Run only one API process against a demo database. This is not a distributed queue.
- Monitoring: workspace settings display API health and report counters; `/v1/health` exposes the same data to that session.
- Preserve state: back up the SQLite database with SQLite backup tooling while active, or stop the API before copying its files. Sessions contain no production identities or provider secrets.
- Fresh demo: use a new browser context or point `DATABASE_PATH` at a new file. Existing workspaces are not overwritten.
- Rollback: stop the process and return to the previous application revision/database backup. No live providers or model deployments exist to roll back yet.
- Source removal and retention: all present sources are fictional; real deletion/retention jobs and incident handling must be implemented before collecting live evidence.
- Hosting: no deployment performed. Keep this anonymous demo bound to localhost until production authentication and deployment configuration are supplied.

## Verification

`npm test` exercises evidence references, session isolation, profile confirmation/versioning, idempotency conflicts, snapshots, complete/partial results, cancellation, saved feedback, invalid input, same-origin restrictions, SSE, and database restart recovery. `npm run test:e2e` runs report creation/export and exploration at desktop and mobile sizes. Browser screenshots are local QA artifacts in `test-results/`.
