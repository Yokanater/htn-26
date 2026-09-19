# M1: Collab Finder

| Field | Value |
| --- | --- |
| Requires | Nothing (includes Step 0) |
| Preset | `MILESTONES=m1` |
| Target green | Sat 18:00 |
| Strengthens | Shopify, Browserbase, Baseten, OpenAI |
| Card format / agent loop | [README §4](./README.md#4-working-with-agents) |

## 1. The product

> **"Find your next Shopify collab partner in 2 minutes, with receipts."**

A merchant pastes their Shopify store URL, confirms the inferred profile, and watches the agent browse live. The result is **5–10 real Shopify brands** to partner with. Every card has:
- a concrete joint offer: type (bundle, co-marketing, gift-with-purchase, content, event, channel), title, value for each side, customer benefit, and a first validation step
- a score breakdown (hover shows each component's method and rationale) and an evidence-strength badge
- **receipts:** every claim opens its exact quote, source, date, capture method, and a replay of the browser capture

**Out of scope for M1:** competitors, discourse, SWOT, drafts, map. The product is complete without them.

## 2. Scope by stage

| Stage | M1 scope | Design ref |
| --- | --- | --- |
| Profile | Full: raw signals (L1) → normalize (L3) → confirm (L4) | §5.1–5.2 |
| `plan` | **Complement jobs + collaborator discovery only** (section-aware) | §5.3 |
| `discover` | Global Catalog complement queries; BB Search for brand coverage; qualify; cap 12 | §5.4 |
| `collect` | Adapters `storefront`, `editorial`, `reviews-widget` on candidates | §5.5 |
| `enrich` | Tag + embed | §5.6 |
| `resolve` | Entity rules + adjudicator; **no discourse clustering** | §5.7 |
| `score` | Collaboration score only | §5.8, §7.1 |
| `synthesize` | `collaborators` section | §5.9 |
| `verify` | Citation validator only | §5.10 |
| `assemble` | Full; other sections absent (not rendered) | §5.11 |

## 3. Contracts
Everything in design §4 is frozen at `contracts-v1.0.0` in Step 0; M1 adds nothing beyond it. Card M1-L4-0 adds `packages/core/src/milestones.ts` (README §3).

## 4. Step 0 (together, 90 min)
Follow **split §3**. The one change: card **M1-L4-0** replaces the L4 scaffold checklist, because it adds `AGENTS.md`, milestone presets, and the `milestone:check` runner. The other lanes do their spikes (split §3.1) and then their contract and seed-fixture files (split §3.2) exactly as written.

---

## 5. Work split

| Lane | Cards | Human-only |
| --- | --- | --- |
| **L1 Collection** | M1-L1-1 … M1-L1-5 | Spikes; hand-write the real dev profile and plan for 2 stores; publish `fixtures/real/` by 16:30; pick demo stores |
| **L2 Intelligence** | M1-L2-1 … M1-L2-5 | BEI deploy; tagger model bake-off; sanity-check the ranking on 2 real stores |
| **L3 Reasoning & Pipeline** | M1-L3-1 … M1-L3-5 | Model choice; prompt tuning on real data; integration captain; Codex log |
| **L4 Product & Platform** | M1-L4-0 … M1-L4-6 | Hosting account + server env; demo recordings; demo script |

### Lane 1: Collection

#### M1-L1-1 · URL safety and crawl policy
- **Brief:** implement design §5.0: `canonicalizeUrl`, `assertSafeUrl` (scheme, IP-literal, localhost, private/link-local ranges after `dns.lookup`), and `registrableDomain` (via `tldts`). Also `RobotsPolicyChecker` implementing `PolicyChecker` using `robots-parser`: robots.txt fetched through the injected `PageFetcher`, cached per domain for 24 h, with `policy.json` allow/deny overrides.
- **Edit:** `packages/collect/src/url-safety.ts`, `packages/collect/src/policy.ts`, `packages/collect/src/policy.json`, `packages/collect/test/url-safety.test.ts`, `packages/collect/test/policy.test.ts`
- **Read only:** `packages/core/src/collect.ts`
- **Accept:** `pnpm vitest run packages/collect/test/url-safety.test.ts packages/collect/test/policy.test.ts`, with at least 12 URL cases (missing scheme, `utm_*` stripping, `localhost`, `10.0.0.1`, `[::1]`, `.internal`, uppercase host, trailing fragment) and disallow/allow robots cases.

#### M1-L1-2 · Browserbase client
- **Brief:** `BrowserbaseClient` per design §6.1:
  - `search()` via `bb.search.web`
  - `fetch()` via `bb.fetchAPI.create`, wrapped in `ctx.cache`
  - `withSession(purpose, fn)`: creates Stagehand (`env: 'BROWSERBASE'`, model `STAGEHAND_MODEL`) and reads the session ID and live-view URL. It emits `browser.session`, enforces a 45 s deadline and a `sessionsConcurrent` pool, and always closes in `finally`, emitting `browser.session.closed` with `replayUrl`.
  - Also export `FixturePageFetcher`, `FixtureSearchProvider`, and `FixtureBrowserRunner`, which read `fixtures/spikes/browserbase/`.
- **Edit:** `packages/collect/src/browserbase/**`, `packages/collect/src/fakes/**`, `packages/collect/src/cli/smoke-bb.ts`, `packages/collect/test/browserbase.test.ts`
- **Read only:** `fixtures/spikes/browserbase/**`, `packages/core/src/collect.ts`, `packages/core/src/context.ts`
- **Accept:** `pnpm vitest run packages/collect/test/browserbase.test.ts`. Live: `pnpm tsx packages/collect/src/cli/smoke-bb.ts` prints 3 search hits, a fetched markdown length, and a session ID + live-view URL, then confirms the session closed.
- **Human check:** paste the live-view URL into an `<iframe>` test page and confirm it renders. Record the plan's concurrent-session limit in `.env.example`.

#### M1-L1-3 · Storefront profiler
- **After:** M1-L1-1 (URL helpers; M1-L1-2 can be faked)
- **Brief:** `collectStoreSignals(url, ctx): RawStoreSignals` per design §5.1: the fingerprint weights table, `/products.json` (≤ 3 pages), `/collections.json`, homepage and About page via Fetch markdown, `ProductSummary` mapping (minor units), and first-party evidence. CLI: `pnpm collect:profile <url> --out <dir>`.
- **Edit:** `packages/collect/src/shopify/fingerprint.ts`, `packages/collect/src/shopify/storefront.ts`, `packages/collect/src/cli/profile.ts`, `packages/collect/test/fingerprint.test.ts`, `packages/collect/test/storefront.test.ts`
- **Read only:** `fixtures/spikes/browserbase/**`, `packages/contracts/src/collect.ts`
- **Accept:** tests on recorded responses (a Shopify store scores ≥ 0.9, a non-Shopify site < 0.3). Live: `pnpm collect:profile <real-store> --out .data/dev/<slug>` writes a `raw-signals.json` that passes `pnpm fixtures:check`.

#### M1-L1-4 · Global Catalog discovery
- **After:** M1-L1-2
- **Brief:**
  - `ShopifyCatalogClient.searchProducts(q)`: JSON-RPC `tools/call` → `search_catalog` at `https://catalog.shopify.com/api/ucp/mcp`, with `meta["ucp-agent"].profile = SHOPIFY_UCP_AGENT_PROFILE_URL`. Parse `result.structuredContent`, else `JSON.parse(result.content[0].text)`. Map results to `CatalogProduct` (minor units, `inferredFields`).
  - `aggregateBySeller` → `Candidate` (design §5.4 steps 2, 3, and 6).
  - BB Search brand-coverage hits for the top candidates; qualify non-catalog brands by fingerprint (≥ 0.6); exclude the merchant's own domain and excluded brands.
  - `discover` stage handling tasks with intent `collaborator_discovery` / `validation`; CLI `pnpm collect:discover --run-dir <dir>`.
  - **Fallback provider:** `SearchDiscoveryProvider` (BB Search + fingerprint) when `CATALOG_PROVIDER=search`, emitting warning `shopify_membership_inferred`.
- **Edit:** `packages/collect/src/shopify/catalog.ts`, `packages/collect/src/discover/**`, `packages/collect/src/cli/discover.ts`, `packages/collect/test/catalog.test.ts`, `packages/collect/test/discover.test.ts`
- **Read only:** `fixtures/spikes/catalog/**`, `fixtures/seed/northbound/plan.json`
- **Accept:** parser and aggregation tests on recorded spike responses. Live: `pnpm collect:discover --run-dir .data/dev/<slug>` yields ≥ 10 collaborator candidates, each with a seller domain, none equal to the merchant's.
- **Human check:** open `discover.json`; confirm 5 random sellers are real, active Shopify brands.

#### M1-L1-5 · Collect stage and adapters
- **After:** M1-L1-2, M1-L1-4
- **Brief:**
  - The `collect` stage per design §5.5: targets = each candidate's storefront (≤ 2 pages) + reviews on its top matched product + editorial search hits. Follow the escalation ladder (Fetch markdown → Fetch raw → session → Stagehand).
  - Adapters: `storefront`, `editorial` (paragraphs that mention the candidate), and `reviews-widget` (Stagehand `observe` the widget → `act` "load more" ≤ 3 times → `extract` a Zod `ReviewList { reviews: [{ rating, title, body, postedAt }] }`).
  - Per-domain budget, circuit breaker (3 failures), `contentHash` dedupe, `authorHash`. Merge discover's evidence.
  - CLI: `pnpm collect:run --run-dir <dir>`.
- **Edit:** `packages/collect/src/collect/**`, `packages/collect/src/adapters/{storefront,editorial,reviews-widget,generic}.ts`, `packages/collect/src/cli/collect.ts`, `packages/collect/test/adapters.test.ts`, `packages/collect/test/collect-stage.test.ts`
- **Read only:** `fixtures/spikes/**`, `packages/contracts/src/collect.ts`
- **Accept:** adapter replay tests. Live: `pnpm collect:run --run-dir .data/dev/<slug>` produces ≥ 60 evidence units, ≥ 1 `stagehand` capture, in < 120 s.
- **Human check:** read 10 random evidence units. Is the text clean? Is `subject` right? Are there no author names?

**L1 human-only:**
- Step 0 spikes.
- Hand-write `fixtures/dev/<slug>/profile.json` + `plan.json` for 2 real stores, with 6–8 product-language complement queries each.
- **Publish `fixtures/real/<slug>/` (profile, plan, discover, collect) by 16:30** so L2 and L3 get real data.
- Pick the demo stores.

### Lane 2: Intelligence

#### M1-L2-1 · Baseten tagger
- **Brief:** `BasetenTagger` implementing `Tagger` (design §6.2): the OpenAI SDK with `baseURL = BASETEN_MODEL_API_BASE_URL`, `model = BASETEN_TAGGER_MODEL`, 10 units per call, temperature 0, and `response_format` `json_schema` (or `json_object`, per the Block 0 bake-off) validated by a Zod `TaggerOutput`. One repair retry with the validation error; split the batch in half on timeout. Also a `RuleTagger` fake (keyword rules) that reproduces the seed labels.
- **Edit:** `packages/enrich/src/baseten/tagger.ts`, `packages/enrich/src/baseten/tagger-prompt.ts`, `packages/enrich/src/fakes/rule-tagger.ts`, `packages/enrich/test/tagger.test.ts`
- **Read only:** `fixtures/spikes/baseten/**`, `fixtures/seed/northbound/collect.json`, `packages/core/src/enrich.ts`
- **Accept:** `pnpm vitest run packages/enrich/test/tagger.test.ts` (parsing, repair, split-on-timeout, using recorded responses). Live: 50 units from `fixtures/real/<slug>/collect.json` come back ≥ 95% schema-valid.

#### M1-L2-2 · Embeddings
- **Brief:** `BeiEmbedder` implementing `Embedder` (`openai.embeddings.create` against `BASETEN_EMBED_BASE_URL`, batches of 64, records `model` and `dims`), plus `HashingEmbedder`: unigram + bigram feature hashing into 512 dims, L2-normalized, deterministic.
- **Edit:** `packages/enrich/src/baseten/embedder.ts`, `packages/enrich/src/fakes/hashing-embedder.ts`, `packages/enrich/src/vector.ts` (cosine, mean, MMR helpers), `packages/enrich/test/embedder.test.ts`
- **Accept:** for both implementations, cosine(paraphrase pair) > cosine(unrelated pair) on 5 fixed pairs. The live test is skipped when there is no key.

#### M1-L2-3 · Enrich stage
- **After:** M1-L2-1, M1-L2-2
- **Brief:** the `enrich` stage per design §5.6: filters, tagging, **quote substring validation** (after whitespace normalization), embedding text rules, and a switch to the OpenAI fallback (`ENRICH_PROVIDER=openai`) when > 50% fail. Records model IDs; rounds vectors to 4 decimals when writing fixtures. CLI: `pnpm enrich:run --run-dir <dir> [--fake]`.
- **Edit:** `packages/enrich/src/enrich/**`, `packages/enrich/src/cli/enrich.ts`, `packages/enrich/test/enrich-stage.test.ts`
- **Accept:** `pnpm enrich:run --run-dir fixtures/seed/northbound --fake` reproduces the seed `enrich.json` labels. Live on `fixtures/real/<slug>` gives ≥ 90% `status: ok`.

#### M1-L2-4 · Entity resolution
- **Brief:** the `resolve` stage **without clustering**: merge rules in design §5.7 order, evidence attachment, `mergeLog`, `refusedMerges`, and emits `entity.merged`. Also `ReasonerAdjudicator` (prompt `adjudicate.v1`, `fast` model, via the `Reasoner` interface; test with an inline fake Reasoner). Output `ResolveResult` with `clusters: []`.
- **Edit:** `packages/enrich/src/resolve/entities.ts`, `packages/enrich/src/resolve/stage.ts`, `packages/enrich/src/prompts/adjudicate.v1.ts`, `packages/enrich/src/cli/resolve.ts`, `packages/enrich/test/resolve.test.ts`
- **Accept:** on the seed, Summit Roast Shop merges into `ent_summit` (same registrable domain) and Summit Gear is **refused**, with a reason.

#### M1-L2-5 · Collaboration score and evidence bundles
- **After:** M1-L2-4
- **Brief:**
  - The `score` stage for `kind: 'collaborator'`: the computed components and penalties exactly as design §7.1, and evidence strength per §7.3.
  - `ReasonerComponentJudge` (prompt `judge.v1`) for `complement_fit`, `novelty`, and the judged half of `audience_fit`.
  - `selectBundle(section, pool, enrichments, tokenCap)`: MMR (λ 0.7) with the design §9.2 constraints.
  - Weights live in `packages/enrich/src/score/weights.ts`, so they can be tuned without code changes.
- **Edit:** `packages/enrich/src/score/**`, `packages/enrich/src/bundle/select.ts`, `packages/enrich/src/prompts/judge.v1.ts`, `packages/enrich/src/cli/score.ts`, `packages/enrich/test/score.test.ts`, `packages/enrich/test/bundle.test.ts`
- **Accept:** seed ranking Kettle > Clay > Oat; every component has a method, rationale, and evidence IDs; bundle tests check the token cap and the ≥ 25% non-first-party rule.
- **Human check:** on 2 real stores, do the top 5 make intuitive sense? Tune `weights.ts` only.

**L2 human-only:** start the BEI deployment in Step 0; run the tagger bake-off; check the rankings on real stores.

### Lane 3: Reasoning & Pipeline

#### M1-L3-1 · Reasoner
- **Brief:** `OpenAIReasoner` implementing `Reasoner` (design §6.3): `responses.parse` + `zodTextFormat`, model alias → env (`reasoning` / `fast`), timeouts 90 s / 30 s, 2 retries on 429/5xx with jitter, request-ID logging, and token accounting into `ctx.budget`. Also `FixtureReasoner`, which returns canned outputs from `<dir>/reasoner/<callName>.json`.
- **Edit:** `packages/reason/src/openai/**`, `packages/reason/src/fakes/fixture-reasoner.ts`, `packages/reason/test/reasoner.test.ts`
- **Accept:** unit tests with a mocked client (retry, timeout, parse failure). A live smoke test returns a parsed nested object with nullable fields. **Merge this early**, since L2's prompts switch to it.

#### M1-L3-2 · Profile normalizer and section-aware planner
- **After:** M1-L3-1
- **Brief:**
  - `normalizeProfile(raw, userContext, ctx)` per design §5.1: the price band is computed in code, plus the `needsConfirmation` rules. CLI `pnpm reason:profile --raw <file> --out <dir>`.
  - `plan` stage (`plan.research.v1`) that reads `run.options.sections`. With only `collaborators` enabled, it produces complement jobs, collaborator-discovery catalog queries (product language, no brand names), and validation tasks, capped per design §13.1. CLI `pnpm reason:plan --run-dir <dir>`.
- **Edit:** `packages/reason/src/profile/**`, `packages/reason/src/plan/**`, `packages/reason/src/prompts/{profile-normalize,plan-research}.v1.ts`, `packages/reason/src/cli/{profile,plan}.ts`, `packages/reason/test/{profile,plan}.test.ts`
- **Accept:** tests with `FixtureReasoner`. Live: L1's real `raw-signals.json` → a sensible profile; the plan has 6–12 catalog queries and no brand names in catalog queries (asserted).

#### M1-L3-3 · Section registry and collaborators synthesizer
- **After:** M1-L3-1
- **Brief:**
  - `registerSection(synth)` / `getSections(enabledKeys)` registry.
  - The `collaborators` `SectionSynthesizer`: input = profile + scored collaborator candidates + `selectBundle('collaborators', …)`, rendered as `<evidence>` blocks (design §9.2). Until L2's `selectBundle` merges, use a naive top-K by `relevance`.
  - An LLM schema using `.nullable()`, and a mapper to `CollaborationCandidate`. Ranking follows code scores; the model writes the claims and the activation.
  - Prompt rules from design §9.1.
- **Edit:** `packages/reason/src/synth/registry.ts`, `packages/reason/src/synth/collaborators.ts`, `packages/reason/src/synth/render-evidence.ts`, `packages/reason/src/prompts/section-collaborators.v1.ts`, `packages/reason/test/collaborators.test.ts`
- **Accept:** with `FixtureReasoner`, the seed yields the seed collaborators section. Live on seed inputs, the output passes the citation validator (M1-L3-4).

#### M1-L3-4 · Citation validator and assemble
- **Brief:** `validateCitations(section, bundleIds)` per design §5.10.1: an ID must be in **that call's** bundle, inference claims need `reasoning`, failing claims are dropped with `droppedClaims++`, and > 30% dropped triggers one retry with the errors appended. Then the `verify` stage (citations only in M1) and the `assemble` stage (`evidenceIndex` with `replayUrl`, entities map, `RunStats`, run status rules from design §5.11).
- **Edit:** `packages/reason/src/verify/citations.ts`, `packages/reason/src/verify/stage.ts`, `packages/reason/src/assemble/**`, `packages/reason/test/{citations,assemble}.test.ts`
- **Accept:** property test (an injected unknown ID is always dropped; valid claims are never dropped); the seed assembles with `citationCoverage = 1`.

#### M1-L3-5 · Pipeline runner
- **Brief:**
  - `packages/pipeline`: a stage registry. Each lane exports `create*Stages(env)` returning `{ stages, sections? }`; the pipeline registers every lane's `sections` into the section registry, so any lane can contribute a report section without editing another lane's files.
  - `LiveRunner` implementing `PipelineRunner`: topological order, skips stages with no enabled consumer, checkpoints each output through `RunStore`, supports `--from/--until`, emits events, enforces the budget, `AbortSignal`, and soft/hard deadlines.
  - `FileRunStore` using the design §10.3 layout plus an `EventEmitter` for `subscribe`.
  - `FixtureStage` serves `<stage>.json` from a run directory. For `synthesize`, it reads `report.json → sections` and overlays any `sections/<key>.json` files (README §2 rule 9).
  - Reads `MILESTONES` via `resolveMilestones` into `run.options.sections`.
  - CLI: `pnpm pipeline:run --run-dir <dir> [--from s] [--until s] [--fake plan,discover,...]`.
- **Edit:** `packages/pipeline/**`
- **Read only:** `packages/core/src/{pipeline,store,milestones}.ts`
- **Accept:** a fully faked run on a copy of the seed reproduces its `report.json` (collaborators section). `--from synthesize` skips upstream work. A `FileRunStore` contract test suite (reused later by IS-PG) passes.

**L3 human-only:** choose the models; tune prompts on 2 real stores (bump prompt versions); act as integration captain for §6; curate `docs/CODEX_LOG.md`.

### Lane 4: Product & Platform

#### M1-L4-0 · Scaffold, AGENTS.md, milestone presets (Step 0, first 25 min)
- **Brief:**
  - Everything in split §3.1's L4 checklist.
  - `AGENTS.md` with the contents required by README §4.4.
  - `packages/core/src/milestones.ts` (README §3) with `resolveMilestones`.
  - Root script `"milestone:check": "vitest run --dir evals/milestones"` (usage: `pnpm milestone:check m1`).
- **Edit:** repo root config files, `AGENTS.md`, `apps/**` skeletons, `packages/*/package.json`, `packages/*/src/index.ts`, stub files listed in split §3.1, `packages/core/src/milestones.ts`, `evals/milestones/.gitkeep`, `docs/CODEX_LOG.md`
- **Accept:** `pnpm install && pnpm typecheck && pnpm test` are green on a clean clone; `pnpm dev` serves the hello pages.

#### M1-L4-1 · Server API and composition root
- **Brief:**
  - Hono app with the design §11 routes needed for M1 (profiles, runs, events, cancel, evidence, feedback, demo runs, healthz).
  - `providers.ts` composition root: env switches per design §3.6; calls `create*Stages(env)` when available, else `FixtureStage`.
  - `MemoryRunStore` (swapped for L3's `FileRunStore` when it merges); error envelope; a feature-router registry (`registerRoutes(flag, router)`) so later milestones mount routes without editing core files.
  - Fake profile path: `POST /api/profiles` returns the seed profile after 2 s.
- **Edit:** `apps/server/src/**` (except `replay.ts`, `sse.ts`), `apps/server/test/api.test.ts`
- **Accept:** API tests cover every route on the seed; a flagged-off test router isn't mounted.

#### M1-L4-2 · ReplayRunner and SSE
- **Brief:** `ReplayRunner` implementing `PipelineRunner`: reads a run directory, re-emits `events.jsonl` with the original delays × `REPLAY_SPEED` into the RunStore, and exposes sections on `section.ready`. SSE `GET /api/runs/:id/events`: `listEvents(afterSeq)` then `subscribe`, `id:` = seq, `Last-Event-ID` resume, 15 s heartbeat.
- **Edit:** `apps/server/src/replay.ts`, `apps/server/src/sse.ts`, `apps/server/test/{replay,sse}.test.ts`
- **Accept:** a seed replay at `REPLAY_SPEED=10` finishes in about 9 s; a reconnect with `Last-Event-ID` produces no duplicates.

#### M1-L4-3 · Intake and profile review
- **Brief:**
  - Web shell: React Router, TanStack Query, Tailwind + shadcn, a Polaris-like look, API client, `useRunEvents` reducer.
  - Intake: URL field, collapsed optional context, and "Try a demo store" chips from `GET /api/demo/runs`.
  - Profile review (design §12.1): Shopify confidence badge with signals, editable chips, price band, positioning, `needsConfirmation` callouts, **Start research**.
  - A **UI section registry** `registerSectionView(key, { tab, title, component })`, with a generic claims renderer for unknown keys.
- **Edit:** `apps/web/src/{app,api,hooks,sections/registry.ts}/**`, `apps/web/src/features/{intake,profile}/**`
- **Accept:** `pnpm --filter web test` (component tests for the badge and chips); a manual flow on replay works.

#### M1-L4-4 · Live run view
- **After:** M1-L4-3
- **Brief:** `StageTimeline`; `LiveBrowserPanel` (iframe of the newest open session's `liveViewUrl`, a "now visiting" URL, a session counter, an animated placeholder when none is open); `DiscoveryFeed` (candidates found, evidence counts by source type, merges, warnings); an "Open report" button when a section is ready.
- **Edit:** `apps/web/src/features/run/**`
- **Accept:** the seed replay visibly progresses through all stages; the panel switches sessions on `browser.session` events.

#### M1-L4-5 · Collaborators report and evidence drawer
- **After:** M1-L4-3
- **Brief:**
  - Report page: header stats, tabs driven by the section registry.
  - Collaborators view: `CandidateCard`, `ScoreBar` (hover shows value, method, rationale, evidence per component), `EvidenceBadge`, `ClaimText` with numbered citation chips (inference claims italic, with a "why" popover), and the activation block.
  - `EvidenceDrawer`: quote highlighted in context, source, dates, capture method, **Watch capture** link, and an "inferred by Shopify" hint.
  - 👍/👎 feedback.
- **Edit:** `apps/web/src/features/report/**`, `apps/web/src/sections/collaborators/**`, `apps/web/src/components/{claim,score,evidence}/**`
- **Accept:** every citation chip in the seed report opens the right evidence (automated test that iterates all chips); `low_evidence` and inference claims render distinctly.

#### M1-L4-6 · Deploy and the M1 milestone check
- **Brief:**
  - Multi-stage `Dockerfile` (the web build is copied to `apps/server/public`) + `docker-compose.yml` (server + Caddy; Postgres profile disabled).
  - Deploy the replay build first, then the live build after §6.
  - `evals/milestones/m1.test.ts`: a fully faked pipeline on the seed with `MILESTONES=m1` asserts the collaborators section is `ready`, `citationCoverage === 1`, and no other sections are present.
- **Edit:** `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `evals/milestones/m1.test.ts`, `docs/DEMO_SCRIPT.md`
- **Accept:** `pnpm milestone:check m1` is green; the public HTTPS URL serves a seed replay.

**L4 human-only:** hosting account and server env; record demo runs (§6 I6); first draft of the demo script.

---

## 6. Integration (L3 captains, per split §8)

These are the I1–I6 swaps from split §8, limited to the collaborator path:

| Swap | Driver | Pass criteria (M1) |
| --- | --- | --- |
| I1 Profile live | L1 + L3 | Valid profile < 30 s for 2 real stores |
| I2 Plan → discover → collect live | L1 | ≥ 10 collaborator candidates, ≥ 60 evidence, ≥ 1 session, < 150 s |
| I3 Enrich → resolve → score live | L2 | ≥ 90% enrichment ok; all candidates scored |
| I4 Synthesize → verify → assemble live | L3 | Collaborators `ready`, coverage = 1 |
| I5 Server on LiveRunner | L4 | Full UI flow on a real store with a live browser panel |
| I6 Record | L4 + L1 | `fixtures/real/<slug>-m1/` replays identically |

## 7. Exit checklist: M1 is a complete product when
- [ ] `pnpm milestone:check m1` is green on `main`.
- [ ] Two real stores run end to end in the UI in < 4 min each, with ≥ 5 collaborators each, all Shopify-verified (catalog seller, or fingerprint ≥ 0.6).
- [ ] `citationCoverage = 1` on both; every chip opens evidence; session captures show **Watch capture**.
- [ ] At least one live browser session is visible in the run view during a live run.
- [ ] Both runs are recorded and replay from the demo chips on the deployed URL.
- [ ] The M1 pitch is in `docs/DEMO_SCRIPT.md` and the Devpost draft. Tag `m1-green`.

## 8. Demo if we stop here (60–90 s)
1. "Small Shopify brands grow through collabs, but finding the right partner takes weeks." (10 s)
2. Paste a store → profile with Shopify signals → confirm. (15 s)
3. Live run: the embedded browser reads real review widgets while Shopify brands stream in from the Global Catalog. (20 s)
4. Top collaborator card: joint offer, score breakdown → click a citation → exact quote → **Watch capture**. (25 s)
5. "Every claim has a receipt. Browserbase browses, Baseten tags at volume, OpenAI writes only what the evidence supports." (10 s)

## 9. Improvement slots that fit M1
IS-SENTRY, IS-CAPTURE, IS-DOMAIN, IS-EXPORT, IS-GPTZERO, IS-PG (README §6).

## 10. Risks and fallbacks

| Risk | Fallback |
| --- | --- |
| Global Catalog is blocked (registration or agent profile) | `CATALOG_PROVIDER=search` (M1-L1-4 fallback), with a warning in the report |
| Stagehand shapes differ from the docs | Wrapped in `withSession`; fix the adapter against recorded spike output |
| BEI not ready | `HashingEmbedder` in dev; OpenAI embeddings fallback in live runs |
| Live run too slow for the demo | Replay the recorded run of the same store |

## 11. Hooks this milestone leaves for later
- **Section-aware planner and registries** (backend `registerSection`, UI `registerSectionView`, server `registerRoutes`): M2–M5 plug in without editing M1 files.
- **The `reviews-widget` adapter** is reused by M2 for competitor discourse.
- **`browser.session` events and the session pool** are extended by M3 mission control.
- **Catalog `media`** is already in the raw spike data; M4 adds `ProductSummary.imageUrl`.
- **`ActionProvider` and `ActionDraft` contracts** already exist (design §4.7); M4 implements them.
