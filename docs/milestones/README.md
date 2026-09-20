# Active milestones — Shopify Intent Studio v3

The [design](../SHOPIFY_ECOSYSTEM_INTELLIGENCE_DESIGN.md) is the product/technical specification;
[team split](../TEAM_WORK_SPLIT.md) assigns ownership. This is the only active delivery ladder.
All milestones support **outfits and room/desk setups equally**. IDs `s1`–`s5` distinguish this
plan from archived `m1`–`m5`; legacy IDs remain compatible, not active build instructions.

## 1. Ladder

| ID | Product increment | Requires | Feature flags | Definition of useful |
| --- | --- | --- | --- | --- |
| S0 | contracts, fixtures, provider spikes | — | — | both-domain offline foundation; not a shipped product |
| [S1](S1_INTENT_CAPTURE.md) | Inspiration to confirmed intent | — | Always available | image/text -> corrected brief in both domains |
| [S2](S2_COLLECTION_MATCHING.md) | Shoppable collections | S1 | Always available | real sourced alternatives and honest constraints |
| [S3](S3_DEMAND_LEDGER.md) | Confirmed demand | S2 | Always available | explicit choices + consent + correct private aggregates |
| [S4](S4_MERCHANT_OPPORTUNITIES.md) | Demand-backed collaborations | S3 | Always available | merchant/newcomer query -> supported editable proposal |
| [S5](S5_DRAFT_ACTIVATION.md) | Draft activation (optional) | S4 | FEATURE_DRAFT_ACTIVATION | approved concept saved to owned Shopify store |

The intended hackathon submission is **S1–S4**. S2 is independently useful to shoppers but does
not demonstrate the whole thesis. S3 without S4 is not a completed two-sided product.

## 2. Presets, sections and guardrails

S1–S4 are planning labels, not runtime switches. The app always exposes intent, collections, demand and opportunities. `MILESTONES` and their four `FEATURE_*` settings no longer restrict routes, matching or UI. Existing environment values are ignored; no private environment migration is required. Provider selection, explicit consent, brief confirmation and session ownership still apply. S5 activation remains outside this change.

Fake providers are the example default. Real adapters are enabled only after human spikes.
Synthetic seeds/replay stay labeled and separate from live demand regardless of feature flags.

## 3. Delivery and cuts

Use team split §4's relative blocks, with the real deadline confirmed by a human. Protect the final
three hours. Finish one thin end-to-end path in **each** domain before adding depth. Share the
pipeline and use domain configuration so supporting both does not mean writing two products.

Cut order: S5 -> graphs/browser dashboard -> vision regions -> optional reranker/embeddings ->
extra collection alternatives. Never cut consent, unknown-state handling, provenance or one domain.
If S1–S4 cannot complete, submit an honestly scoped shopper product and describe demand work as
unfinished; do not claim a closed loop that only exists in mock UI.

## 4. Cards and working loop

### 4.1 Card format

Each linked milestone has cards with Brief, Edit, Read, In/Out, After, Accept and Human check.
All cards inherit AGENTS.md and the shared validation commands. Index export changes belong to
their package owner. Shared contract extensions land first with updated fixtures.

### 4.2 Per-card loop

One worktree per agent; check current branch/user edits; read cited design sections; implement only
the card paths; use fakes/recordings; run acceptance + typecheck + format; human reviews the actual
output; integrate in small increments. No dependencies changed by agents. Do not run absent legacy
CLI scripts just because package.json reserves their names.

### 4.3 Human work

S0 live provider spikes, category quality judgment, session/consent usability, merchant feedback,
deployment credentials and external write execution. Agents must not perform live API calls.

### 4.4 Bootstrap is not a milestone implementation

REVAMP-0 delivers the interfaces, schemas, seed validation, capability endpoint and testable preset
foundation. Provider adapters, uploads, matching, consent persistence and aggregate computation are
still cards. Track this explicitly in [bootstrap status](../BOOTSTRAP_STATUS.md).

### 4.5 Assist log

Update CODEX_LOG.md with measured outcomes; confirm sponsor rules separately.

## 5. Exit ritual

For S<N>: card tests pass, `pnpm typecheck`, `pnpm fixtures:check`, `pnpm test`, `pnpm format`,
`pnpm format:check`, plus `pnpm exec vitest run --project milestones --passWithNoTests=false
evals/milestones/s<N>.test.ts`. The named file must exist and exercise the increment, not just
assert its flag. No live providers in tests. Record separate human live checks for **both** domains,
an honest fake/replay fallback and known failures. Required schema fixture files may not be skipped.

S0 checks `evals/milestones/bootstrap.test.ts`; it must not masquerade as S1–S5 acceptance.

## 6. Optional work

Browserbase capture/progress and Baseten extraction/experiment selection are required parts of the
merchant S4 workflow, scoped in [merchant implementation](../MERCHANT_IMPLEMENTATION.md). They are
not deferred cosmetic sponsor integrations. External Shopify activation remains optional S5.

Only after S4: more categories, formal merchant onboarding, measured ranking improvements,
transactional storage, richer evidence rendering. No sponsor integration solely to add a logo.
