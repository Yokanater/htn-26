# S4 merchant workflow and provider integration

User-assigned cross-lane continuation from `9a825bbb0fb760f7024c06dbb2252de5d97fca84`.
This assignment covers S4-L1-1, S4-L2-1, S4-L3-1 and S4-L4-1, plus additive
merchant contracts/fixtures, core ports, provider composition, session erasure,
environment example and active planning documents needed for that workflow.
No dependencies, private environment files, live provider calls or external store writes.

Browserbase supplies bounded public browser captures and owner-scoped live progress.
Baseten performs evidence-bound extraction and proposes testable collaboration experiments.
Deterministic code verifies references, calculates coverage, suppresses small cohorts and
keeps observed pair support separate from inferred supply fit. Both domains are required.

The merchant journey is profile -> confirm catalog -> compare eligible demand and partner
coverage -> create/edit/save/export a proposal. Public URLs never prove store ownership.
Public catalog exploration and thresholded anonymous demand summaries require an app session; synthetic mode is
explicit and isolated. S5 external Shopify activation remains a separate human-gated card.

Validation and operational details are recorded here as implementation progresses.

## Run configuration (human-owned private environment)

For the full offline workflow use `MERCHANT_PROVIDER=fake`.
The merchant screen offers seeded outfit/setup stores. Review and confirm the catalog, compare
the synthetic cohort, inspect both catalogs, generate a proposal, edit/save and copy/download it.
No provider keys are needed for this explicitly synthetic path.

For live merchant profiling, set:

```dotenv
MERCHANT_PROVIDER=browserbase_baseten
BROWSERBASE_API_KEY=<server secret>
BROWSERBASE_PROJECT_ID=<project ID>
BASETEN_API_KEY=<server secret>
BASETEN_TAGGER_MODEL=<verified structured-output Model API slug>
BASETEN_REASONING_MODEL=<optional; defaults to tagger>
```

The merchant workflow does not require an OpenAI key. The existing live shopper intake/catalog
adapters still require their own `OPENAI_API_KEY` and configured vision/search models. Actual live
demand additionally requires explicit shopper choices and separate consent; profiles and model
suggestions never create it. Fewer than five eligible sessions yields insufficient evidence.
Private `.env` files were not edited. Restart the server after changing configuration.

## Provider responsibilities and limits

- Browserbase/Stagehand v4: public collection navigation, product link capture, private read-only
  live view, pre-navigation domain policy, always-close cleanup. No recorded session or raw browser
  log is retained. Two concurrent scans globally; one per owner; 12 scans per one-hour workspace.
- Baseten extraction: one batch of up to eight verified product records; strict JSON output;
  source-quote verification; no model-derived prices, availability, sizes or dimensions.
- Baseten experiment selection: chooses a landing-page test, joint guide or opt-in interest test
  with validated aggregate/evidence references. Counts and factual copy are rendered in code.
- Merchant state: private owner session, up to 32 variants per profile and 24 saved drafts; one-hour
  expiry, memory only, restart clears it. Copy/download rechecks current snapshot and product age.
- Partner comparison: automatically verified partner catalogs (seeded partners in demo), matching
  category coverage, exclusion of known currency/shipping/availability conflicts. It is not a claim
  that unknown hard constraints pass. Complementary stores are automatically discovered and their public catalogs verified.
- No automatic outreach, custom model deployment, cross-store checkout or S5 Shopify Admin action.

Provider API shapes were checked against installed SDK types and official references:
[Baseten Model APIs](https://docs.baseten.co/inference/model-apis/overview),
[Browserbase live view](https://docs.browserbase.com/platform/browser/observability/session-live-view).
Documentation and fake tests are not live-account certification. A human must validate model access,
latency, custom-domain storefront behavior, live-view embedding and extraction quality in both domains.

## Human smoke checklist

1. Configure keys privately (no milestone flags are required). Start the application using the normal human dev command.
2. Enter one store for each domain. Verify complementary partners are discovered automatically. Watch the browser, cancel once,
   retry, inspect product source links and confirm or correct categories.
3. Verify unknown shipping/dimensions are not presented as verified. If no cohort qualifies, keep
   the insufficient-evidence state; do not manufacture demand or relabel synthetic data.
4. With a qualifying consented cohort, generate/edit/save/reopen/export a proposal. Withdraw one
   contributor and verify old evidence cannot be exported or read from the API.
5. Review the experiment and outreach semantically before sending anything outside the app.

## Acceptance — 2026-09-19

Branch: `codex/merchant-provider-workflow`; base: `9a825bbb0fb760f7024c06dbb2252de5d97fca84`.
Changes are uncommitted in the active main checkout; the previously isolated implementation was synchronized into it.

| Command | Actual output |
| --- | --- |
| `pnpm typecheck` | `pnpm -r exec tsc --noEmit`, exit 0 |
| `pnpm test` | `Test Files 52 passed / 1 skipped (53); Tests 661 passed / 2 skipped (663)` |
| `pnpm fixtures:check` | `Test Files 3 passed (3); Tests 79 passed (79)` |
| `pnpm exec vitest run --project milestones --passWithNoTests=false evals/milestones/s4.test.ts` | `Test Files 1 passed (1); Tests 2 passed (2)` |
| `pnpm format` | `Checked 208 files. Fixed 3 files.` (final formatting pass) |
| `pnpm format:check` | `Checked 208 files. No fixes applied.` |
| `pnpm --filter @sei/web build` | `2041 modules transformed; built in 1.16s` |
| `git diff --check` | exit 0 |

The two skipped tests are existing macOS decoder checks on Windows. The S4 integration suite
uses real server routes and injected offline providers to create five consented shopper collections
in each domain, compare a merchant, prove newcomer attribution, draft a proposal, withdraw consent,
and reject the stale draft. No live call occurred. Provider regressions exercise malformed quotes,
unknown citations, outages, unsafe inputs, cancellation and cleanup. UI tests exercise both domains,
confirmation barriers, source evidence, draft editing and browser progress/cancellation.

Browser inspection of the production build completed the synthetic outfit workflow through an
editable draft. It exposed duplicate proof rows, which were removed by offer ID. Fixtures and mocks
are explicitly synthetic; no recorded live provider response was available. Required live account,
quality and embedding checks remain human work. State is in-memory with one-hour expiry.

Scope audit: tracked diff against base and integration target `main`, plus untracked files, is
limited to this assignment's merchant services/UI, provider adapters, additive contracts/ports,
fixtures, tests and plan/config documentation. Dependency manifests, lockfile and private `.env`
are unchanged. No commit, merge, push, message or Shopify Admin write was performed.

## Automatic exploration

Browserbase Search receives up to two fixed complementary category queries, never shopper text or product titles. Results must be public HTTPS product links; own-store and duplicate registered domains are excluded. At most three candidate stores are profiled sequentially under the shared three-minute deadline. Baseten extracts cited category/material/function facts from their verified product records. Search access uses the existing Browserbase API key; projects without Search access show a recoverable warning while retaining the primary catalog.

The comparison screen ranks verified candidate catalogs by additional categories even when no demand cohort qualifies. It exposes product evidence, labels supply fit as inferred, marks expired captures, and offers another exploration. Demand-backed drafts still require eligible anonymous demand evidence; catalog discovery never fabricates that evidence. Cancellation/deadline retains completed catalogs and suppresses late results. Session deletion removes them.

Exploration completion validation: `pnpm test` — 54 files passed, 679 tests passed, 2 existing skips; `pnpm typecheck` — exit 0; explicit S4 milestone suite — 2 tests passed; `pnpm format:check`, web production build and `git diff --check` — exit 0. All discovery, partner verification and provider requests were injected offline.
