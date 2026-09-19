# S2 — Shoppable collections

Requires S1. Preset `s1,s2`. Flag `FEATURE_COLLECTION_MATCHING`.
Exit: in each domain, a confirmed brief yields real seller/variant offers, evidence, alternatives,
known item subtotal, missing slots and explicit unknown constraints. Revision changes invalidate old results.
No unified cart, inferred shipping total, forced multi-store result or automatic purchase.

All cards read AGENTS.md, design v3 and team split v3. Both outfit and setup fixtures are mandatory.
Every Accept also includes `pnpm typecheck`, `pnpm format`, and `pnpm format:check`.
All automated tests are offline. Provider/human checks are separate and never run by coding agents.
Any needed contract extension is a small additive PR with both-domain fixture changes before consumers.
Do not edit dependency manifests. Do not implement a nonexistent old report CLI as a prerequisite.

### S2-L1-1 · Catalog and factual evidence
- Brief: Implement bounded Global Catalog query adapter, variant-level seller mapping, deduplication, product verification via Fetch/browser, typed partial failure and fixture adapters. Safe URL/redirect policy applies to public fetches. Never equate product grouping with seller identity.
- Edit: `packages/collect/**`, `fixtures/seed/outfit/offers.json`, `fixtures/seed/setup/offers.json`
- Read: design §3–5, §8–9; contracts and registered fixtures; core interfaces (read-only unless explicitly in Edit).
- In → Out: slot queries + country/currency -> ProductOffer[] + ProductEvidence[]
- After: S0 recorded catalog/fetch shapes.
- Accept: `pnpm vitest run packages/collect`; same product from different sellers remains separate; missing variants/attributes stay unknown; caps and unsafe redirects tested.
- Human check: Open actual variants in each domain and verify price/currency/availability and product URLs.

### S2-L1-2 · Offer tiles and proof
- Brief: Build product tile, alternative picker and public evidence drawer. Show sourced images, exact variant details, captured date and external destination. Broken images have a readable fallback.
- Edit: `apps/web/src/features/shopper/products/**`
- Read: design §2, §5.2–5.3; contracts and registered fixtures; core interfaces (read-only unless explicitly in Edit).
- In → Out: offer + checks + evidence -> accessible selection components
- After: S0 DTO; can start with fixtures.
- Accept: `pnpm vitest run apps/web/src/features/shopper/products`; unknown shipping/size and stale facts visible.
- Human check: Compare two alternatives for an outfit and a setup without confusing variant selection.

### S2-L2-1 · Constrained collection engine
- Brief: Normalize attributes with recorded Baseten output plus deterministic fallback; hard-check constraints and bounded beam search. Missing slots are valid partial outcomes. Currency and amount math are deterministic; rank coverage/feasibility before style. No demand-based ranking yet.
- Edit: `packages/enrich/src/matching/**`, `packages/enrich/src/index.ts`, `packages/enrich/test/matching.test.ts`, `fixtures/seed/outfit/matches.json`, `fixtures/seed/setup/matches.json`
- Read: design §4–5; contracts and registered fixtures; core interfaces (read-only unless explicitly in Edit).
- In → Out: confirmed brief + offers -> CollectionMatch[]
- After: S0 fixtures (runs in parallel with S1).
- Accept: `pnpm vitest run packages/enrich/test/matching.test.ts`; cover both domains, unknown and violated hard constraints, impossible budget, currency mismatch, no forced extra seller, deterministic ties.
- Human check: Blindly compare coherence and constraint compliance against independent per-item search.

### S2-L3-1 · Run orchestration and collection workspace
- Brief: Build query planning and checkpointed pipeline behind core interfaces; enforce confirmation barrier, timeout, cancellation and revision invalidation. Add evidence-bounded explanations and shopper workspace using L1 tiles. Inject collection engine; do not import enrich from reason.
- Edit: `packages/reason/src/matching/**`, `packages/reason/src/index.ts`, `packages/pipeline/**`, `apps/web/src/features/shopper/collection/**`
- Read: design §5, §7–9; contracts and registered fixtures; core interfaces (read-only unless explicitly in Edit).
- In → Out: confirmed brief -> queries -> offers -> match -> explained collection
- After: S0 interfaces; adapters can be fake until integration.
- Accept: `pnpm vitest run packages/pipeline packages/reason apps/web/src/features/shopper/collection`; cancellation closes resources and old revision cannot update UI.
- Human check: Change budget mid-run in both domains and inspect partial results after a provider failure.

### S2-L4-1 · Match routes and integration
- Brief: Mount owner-authorized match/SSE endpoints, bounded requests, replay mode and capability-gated UI. Wire provider factories once. Recorded events cannot become live demand.
- Edit: `apps/server/src/routes/{matches,events}.ts`, `apps/server/src/providers.ts`, `apps/server/src/app.ts`, `apps/server/test/matches.test.ts`, `evals/milestones/s2.test.ts`
- Read: design §8–10; contracts and registered fixtures; core interfaces (read-only unless explicitly in Edit).
- In → Out: brief revision -> run handle -> resumable events
- After: S1 API; integrate L1/L2/L3 fakes first.
- Accept: `pnpm vitest run apps/server/test/matches.test.ts`; S2 suite runs both domains with fake providers and asserts known-constraint validity, revisions and ownership.
- Human check: Two complete live/replayed flows with labels, measured latency and captured evidence.
