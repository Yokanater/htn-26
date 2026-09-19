# Team split v3 — two surfaces, one demand loop

This replaces the old report-first lane schedule. Read [design](SHOPIFY_ECOSYSTEM_INTELLIGENCE_DESIGN.md)
and [active milestone cards](milestones/README.md). Four humans own four lanes. Coding agents may
implement cards in isolated worktrees; people own product judgment, real API spikes and integration.

## 1. Outcomes and workload

| Lane | Owns the outcome | Core work | UI work |
| --- | --- | --- | --- |
| L1 Catalog & Evidence | Every suggested item is a real, correctly identified offer | Shopify/Browserbase adapters, variant facts, evidence, merchant catalog | shopper media intake and product tiles |
| L2 Matching & Demand | Collections obey constraints; counts represent actual consented choices | match engine, attribute normalization, ledger projections, cohort aggregation, supply mapping | none; provides typed fixtures to both UIs |
| L3 Intent & Experience | Both domains yield an understandable shopper experience | vision/text intent, query plans, orchestration, explanation and proposal prompts | shopper brief editor and collection workspace |
| L4 Platform & Merchant | A reliable two-sided application with private data boundaries | sessions, uploads, routes, persistence adapters, wiring, deployment | shell, merchant opportunities and proposal editor |

L4 no longer builds every screen. L1 owns reusable media/product components; L3 owns the shopper
workspace; L4 owns the merchant workspace. L2 starts on fixture-driven matching immediately and
does not wait for vision or catalog. L1's merchant profiler reuses the catalog normalizer. L3's
proposal prompt reuses evidence rendering; no new generic report engine. If overloaded, move an
entire unstarted card with its Edit paths and tests to a named helper; never have two agents edit it.

## 2. Exact path ownership

| Owner | Paths |
| --- | --- |
| L1 | `packages/collect/**`; `apps/web/src/features/shopper/media/**`; `apps/web/src/features/shopper/products/**`; matching tests colocated there |
| L2 | `packages/enrich/**`; `packages/db/**`; `ml/**` (optional only) |
| L3 | `packages/reason/**`; `packages/pipeline/**`; `apps/web/src/features/shopper/brief/**`; `apps/web/src/features/shopper/collection/**`; `docs/CODEX_LOG.md` |
| L4 | remaining `apps/**`; `packages/telemetry/**`; root configuration; `evals/**` |

Shared files have one editor: contracts/intent.ts L3; shopping.ts L1 with L2 review; demand.ts L2;
opportunity.ts L3; api.ts and common.ts L4. Core shopping.ts L3 (interface coordinator), categories.ts
L3, demand.ts L2, milestones.ts L4. Each lane owns its fixture files; contract PR coordinator
registers fixture schemas once. CODEOWNERS orders UI exceptions after broad apps ownership.

## 3. S0 foundation and provider spikes (first 60–90 minutes)

The bootstrap revision supplies the initial schemas, category registry, interfaces, synthetic
fixtures and presets. Review those together before dispatching cards; do not retranscribe v2.

| Human pair | Spike | Recorded output and stop condition |
| --- | --- | --- |
| L1 + L3 | Global Catalog: one query per domain, variants/sellers/media/filter shapes | redacted outfit/setup responses; stop guessing fields if unavailable; use verified storefront fallback |
| L3 | Vision + strict JSON on one permitted image per domain | model ID, latency, valid/invalid outputs; correction UX remains required |
| L2 | Baseten normalization on both shortlists | selected model slug and responses; deterministic fallback if quality/access fails |
| L1 + L4 | Static fetch vs browser evidence and account quota | one factual capture; no dependency on many live browser tiles |
| L4 + L1 | Upload decoding/normalization with installed libraries | prove malformed-image rejection and metadata removal; missing library is a human dependency change |
| L4 | Session + file-store deployment and demo domain | owner access boundary; no open private asset routes |

No coding agent makes a live provider call. Save only permitted, redacted examples. No API keys,
personal uploads, or real shopper event dumps in fixtures. Check the actual submission time and
prize rules with the event guide; old deadline/prize claims are not authoritative.

## 4. Parallel schedule and handoffs

| Relative block | L1 | L2 | L3 | L4 |
| --- | --- | --- | --- | --- |
| 0–1.5 h | catalog/media spike | matcher fixtures, normalize spike | intent spike, contract review | session/upload spike, contract review |
| 1.5–4 h | S1 media component; S2 provider | S2 matcher against fixtures | S1 intent/editor; S2 query plan | S1 private assets/routes/shell |
| 4–7 h | S2 product evidence + tiles | S2 finish; S3 projection | S2 orchestration/workspace | S2 integration + decision/consent route skeleton |
| 7–10 h | S4 merchant catalog | S3 aggregates + S4 supply mapping | S3 feedback UX; S4 proposal prompt | S3 privacy/deletion + merchant UI using fixtures |
| 10–13 h | both-domain quality fixes | aggregate adversarial checks | S4 full journey and explanations | S4 integration/deploy |
| remaining protected time | verify products | verify counts | rehearse storyline | backup recording/submission |

These are planning estimates, not promises. Reserve at least the final three hours for live checks,
rehearsal and submission. S5 only if S1–S4 are green with >=3 hours before feature freeze and its
Admin API spike has already passed. If time is shorter, cut S5, elaborate reranking, visual graph,
and image regions. Do not cut one domain or label synthetic cohorts as real to claim completion.

## 5. Work agreements

- One worktree per running agent; no automatic commits or PRs required by this plan. Use the
  repository branch convention, and explicit card ID in any commit message.
- Only card Edit paths. The user-authorized `REVAMP-0` is a one-time cross-lane docs/bootstrap
  migration, scoped in BOOTSTRAP_STATUS.md; it does not authorize provider calls/dependency edits.
- Shared schema changes are additive and land with fixtures before dependent cards. One brief
  joint review, not a promised 15-minute turnaround during every milestone.
- Public exports go through package index.ts; siblings use injected core interfaces. Preserve
  existing package imports/dependencies. No model/provider types leak into browser contracts.
- Use bounded card agents as useful, but human attention—not agent count—limits concurrency.
  Different files are insufficient isolation if the cards disagree on an evolving contract.
- Notify the integration captain (L4) on schema or API changes. L3 coordinates shared interfaces.
- Each handoff includes input/output fixture paths, exported function/type names, failure cases,
  Accept output, and the next human check. “Tests pass” without this does not close a card.

## 6. Integration sequence

1. L4 mounts fake-backed route and UI slices; L1/L3 wire components against the same DTO fixtures.
2. Human verifies intent for **both** domains, then swaps vision only.
3. Human verifies seller/variant mapping for both, then swaps catalog only.
4. Human checks constraint outcomes, then enables matching/explanations.
5. Enable decision ledger; exercise duplicates, revision conflicts, opt-out, withdrawal and deletion.
6. Enable merchant aggregates and opportunities on labeled synthetic data, then eligible real data.
7. New merchant mapping must say inferred when there is no observed pair support.
8. Record both domains, switch all providers to replay and verify replay cannot enter live counts.

## 7. Quality ownership and acceptance

L1 checks factual validity and variant identity. L2 checks constraints/counts/deduplication. L3
checks visual interpretation and factual support in copy. L4 checks private-data boundaries and
both UI journeys. Each person reviews another lane's primary output once before release.

Every card: targeted tests + `pnpm typecheck` + `pnpm format` + `pnpm format:check`. Milestone
integration: `pnpm fixtures:check`, `pnpm test`, and the explicit milestone suite once implemented.
The root `milestone:check` script currently permits missing tests; use `pnpm exec vitest run
--project milestones --passWithNoTests=false <suite-path>` as the required non-vacuous gate.
S0 is bootstrap only; passing presets is not passing S1–S5. Human live checks are separately recorded.

## 8. Scope boundaries

The original competitor/discourse/SWOT, browser-grid, distillation, database and sponsor-add-on
cards are archived. They are not spare work for an idle lane. An idle lane first improves the
other lane's fixtures, checks both domains, or helps integration through an explicitly reassigned
card. Keep consent, provenance, revision validity and unknown constraints in the minimum product.

## 9. Runtime failure decisions

| Failure | Decision |
| --- | --- |
| Vision unavailable | user writes/edits brief; clearly label image analysis unavailable |
| Catalog access fails | verified public storefront discovery fallback; never pretend seed is live |
| No complete collection | partial result with exact missing slots/constraints |
| Baseten unavailable | deterministic matching/normalization path; no custom deployment detour |
| Fewer than threshold consented sessions | insufficient evidence; separate synthetic demonstration |
| Withdrawal/deletion | immediately invalidate impacted aggregate reads; recompute before serving |
| S4 behind schedule | swarm the two-sided loop, not optional Shopify write-back |

## 10. Documentation and demo ownership

L3 curates the actual coding-assist log. L4 keeps DEMO_SCRIPT.md and BOOTSTRAP_STATUS.md accurate.
Log measured outcomes, including failures. Do not claim a sponsor award requirement or eligibility
without confirming current rules. Demonstrate the consumer-to-merchant connection equally for both
categories; explain which data is synthetic and which observations are real.

## 11. Compatibility

### 11.1 Integration captain

L4 owns composition root and integration, L3 owns interface coordination. Each lane merges only
reviewed cards. Revert a failed adapter to fake in demo configuration, not by silently mixing data.

### 11.2 Ownership

See §2 and CODEOWNERS. Subdirectory exceptions are intentional and supersede broad apps ownership.

### 11.3 Contract evolution

Preserve common exports and legacy `m1`–`m5` definitions. New `s1`–`s5` identify this plan without
silently changing private `.env` meanings. Do not mix families. New schemas are additive; future
changes preserve stored fixture compatibility or include an explicit versioned migration.

### 11.4 Human-only actions

Provider credentials, initial live calls, deployment secrets, semantic quality judgments, real user
research, final writes to external stores and final submission remain human tasks.

### 11.5 Log

Record meaningful work in `docs/CODEX_LOG.md`: time, lane, card, assistance, measured outcome.
