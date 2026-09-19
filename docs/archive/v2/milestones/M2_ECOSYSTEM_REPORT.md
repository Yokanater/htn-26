# M2: Ecosystem Report

| Field | Value |
| --- | --- |
| Requires | M1 green |
| Preset | `MILESTONES=m1,m2` |
| Target green | Sat 22:30 |
| Strengthens | Rox (messy data), OpenAI, Baseten |
| Card format / agent loop | [README §4](./README.md#4-working-with-agents) |

## 1. The product

> **"Partners, rivals, what their customers say, and what to do next, all with receipts."**

This is M1 plus two tabs:
- **Competitors & Discourse:**
  - 5–10 competitors, each classified as direct, substitute, or adjacent with a testable reason, a decomposed score, and strengths and weaknesses.
  - Customer discourse themes per competitor, split into **praise, complaints, switching triggers, and unmet needs**. Each theme has a sample-size label ("14 mentions · 9 authors · 3 sources · Mar–Sep 2026"), representative quotes, contradictions, and bias notes. Weak signals are collapsed.
- **SWOT & Actions:** 3–5 cited items per quadrant, then 3 prioritized actions, each with a falsification test and a success metric.

**Messy-data handling is visible:** merged and refused entity merges, contradicting sentiment, excluded first-party marketing, and named partial failures.

## 2. What M2 adds per stage

| Stage | Addition | Design ref |
| --- | --- | --- |
| `plan` | Competitor hypotheses (direct, substitute, adjacent) + discourse queries when `FEATURE_FULL_REPORT` | §5.3 |
| `discover` | Competitor catalog queries (own category + substitutes); role hypothesis `competitor`/`unknown` | §5.4 |
| `collect` | Reviews on competitors' top products; editorial comparisons; forum adapter (only for an approved domain); ≥ 25% of the page budget goes to independent discourse | §5.5 |
| `resolve` | **Discourse clustering** → `DiscourseCluster[]` | §5.7, §8 |
| `score` | Competitor score; the `direct_competition` penalty now affects collaborators | §7.2, §7.1 |
| `synthesize` | Sections `competitors`, `discourse`, `swot`, `actions` | §5.9 |
| `verify` | Consistency check | §5.10.2 |

## 3. Contracts
No new types; everything is in design §4 (`CompetitorProfile`, `DiscourseTheme`, `SwotReport`, `RecommendedAction`, `DiscourseCluster`). The seed already contains M2 data (split §3.3).

## 4. Flags
`FEATURE_FULL_REPORT` (via preset `m2`). With it off, the planner, discover, collect, and resolve behave exactly as in M1: no competitor tasks and no clustering.

---

## 5. Work split

| Lane | Cards | Human-only |
| --- | --- | --- |
| **L1** | M2-L1-1, M2-L1-2 | Forum decision (robots/terms); sanity-check competitor sets on 2 stores |
| **L2** | M2-L2-1 … M2-L2-3 | Tune the clustering threshold on real data |
| **L3** | M2-L3-1 … M2-L3-4 | Prompt tuning for themes and SWOT; check contradictions on real data |
| **L4** | M2-L4-1 … M2-L4-3 | Record the M2 demo runs |

### Lane 1: Collection

#### M2-L1-1 · Competitor discovery
- **Brief:** extend `discover` for tasks with intent `competitor_discovery`: catalog queries for the merchant's own category and substitutes; aggregate by seller; role hypothesis (`competitor` when found only via competitor queries, `unknown` when found via both); a cap of 12 per role; BB Search hits for comparison and "alternative" queries become collection targets. Gated by the plan's tasks, so nothing changes when `FEATURE_FULL_REPORT` is off.
- **Edit:** `packages/collect/src/discover/**`, `packages/collect/test/discover-competitors.test.ts`
- **Accept:** a test proves the M1 behavior is unchanged when the plan has no competitor tasks. Live: ≥ 5 competitor candidates for 2 real stores, none equal to the merchant's domain.

#### M2-L1-2 · Discourse collection
- **After:** M2-L1-1
- **Brief:** collection targets for competitors: `reviews-widget` on their top 1–2 matched products (reuses M1's adapter), `editorial` on comparison hits, and `forum` **only** for domains in `policy.json` `approvedForums`. Budget rebalancing: ≥ 25% of fetches and sessions go to independent discourse. `isFirstParty` is set for text on a brand's own domain that isn't a customer review.
- **Edit:** `packages/collect/src/collect/targets.ts`, `packages/collect/src/adapters/forum.ts`, `packages/collect/src/policy.json`, `packages/collect/test/discourse-targets.test.ts`
- **Accept:** a target-planning unit test enforces the budget split. Live: ≥ 40 non-first-party discourse units across ≥ 3 competitors.
- **Human check:** confirm no forum domain was crawled without an explicit approval entry.

### Lane 2: Intelligence

#### M2-L2-1 · Discourse clustering
- **Brief:** `clusterDiscourse(evidence, enrichments, entities)`: agglomerative clustering per (entity group, `discourseType`), cosine distance, average linkage, threshold from `score/weights.ts` (default 0.78). Order members by centrality. A cluster becomes a **theme candidate** with ≥ 2 evidence items from ≥ 2 sources; singletons become weak signals. `provisionalLabel` = most frequent normalized aspect. Computes `sample` and `sentimentSpread`. Wired into `resolve` only when `run.options.sections` includes `discourse`.
- **Edit:** `packages/enrich/src/resolve/cluster.ts`, `packages/enrich/src/resolve/stage.ts`, `packages/enrich/test/cluster.test.ts`
- **Accept:** on the seed (hashing embedder), the output is exactly the 5 seed clusters, including the `clu_shipping` singleton; M1 behavior is unchanged without the section.
- **Human check:** on real data, look at the 3 largest clusters. Adjust the threshold if they're mixed or over-split.

#### M2-L2-2 · Competitor score
- **Brief:** the `score` stage for `kind: 'competitor'` per design §7.2: product overlap (Jaccard on categories + mean top-3 cosine of product titles), price-range overlap, positioning cosine, recency-weighted discourse volume, source diversity; the judged half of audience via `ComponentJudge`. Then apply the collaborator `direct_competition` penalty (−25 when competitor total ≥ 60).
- **Edit:** `packages/enrich/src/score/competitor.ts`, `packages/enrich/src/score/stage.ts`, `packages/enrich/test/score-competitor.test.ts`
- **Accept:** seed order Summit > Pods > BeanBox; a test ensures an entity scoring as both keeps a penalized collaborator score.

#### M2-L2-3 · Section bundles for M2
- **Brief:** `selectBundle` profiles for `competitors` (competitor storefront + reviews + editorial), `discourse` (cluster members, top 5 central per theme candidate plus contradicting members), and `swot` (upstream-cited evidence + first-party profile evidence). The domain cap (30%) and the non-first-party floor (25%) are enforced per profile.
- **Edit:** `packages/enrich/src/bundle/**`, `packages/enrich/test/bundle-m2.test.ts`
- **Accept:** each profile respects the caps on seed and real fixtures; the discourse bundle includes both sides of `clu_stale` / `clu_flex`.

### Lane 3: Reasoning & Pipeline

#### M2-L3-1 · Full-report planning
- **Brief:** when `sections` includes `competitors`/`discourse`, `plan.research.v2` adds competitor hypotheses with catalog queries and discourse queries (`"<category> complaints"`, `"<brand> vs <brand>"`, `"switched from <brand>"`, `"best <category> <year>"`). Keep `v1` as the M1 prompt so M1 runs are unchanged.
- **Edit:** `packages/reason/src/plan/**`, `packages/reason/src/prompts/plan-research.v2.ts`, `packages/reason/test/plan-m2.test.ts`
- **Accept:** the M1 preset still selects `v1`; the M2 preset produces ≤ 40 tasks with ≥ 25% discourse tasks.

#### M2-L3-2 · Competitors and discourse synthesizers
- **Brief:**
  - `competitors` section: classification with a testable reason claim, strengths, weaknesses, and `themeIds`.
  - `discourse` section: from theme-candidate clusters, write the label, summary claim, and `sampleLabel` (computed in code, not by the model), plus contradictions and bias notes; exclude first-party evidence.
  - Both run in parallel; prompt rules from design §9.1.
- **Edit:** `packages/reason/src/synth/{competitors,discourse}.ts`, `packages/reason/src/prompts/section-{competitors,discourse}.v1.ts`, `packages/reason/test/{competitors,discourse}.test.ts`
- **Accept:** with `FixtureReasoner`, seed parity. Live on seed inputs: passes the citation validator; `clu_stale` + `clu_flex` produce a contradiction on Summit Roast.

#### M2-L3-3 · SWOT and actions synthesizers
- **After:** M2-L3-2
- **Brief:** `swot` (`dependsOn`: collaborators, competitors, discourse): 3–5 non-overlapping items per quadrant; strengths and weaknesses about the merchant, opportunities and threats about the market; confidence plus evidence on every item; `insufficientEvidence` instead of speculation. `actions` (`dependsOn`: swot): 3 actions ordered by impact × confidence ÷ effort, each with `falsificationTest` and `successMetric`.
- **Edit:** `packages/reason/src/synth/{swot,actions}.ts`, `packages/reason/src/prompts/section-{swot,actions}.v1.ts`, `packages/reason/test/{swot,actions}.test.ts`
- **Accept:** seed parity; a test rejects duplicate items across quadrants.

#### M2-L3-4 · Consistency verifier
- **Brief:** a consistency-check registry (`registerConsistencyCheck(check)`), so later milestones add checks without editing this file. The first checks:
  - deterministic: an entity that is both collaborator and direct competitor; duplicate SWOT items
  - LLM: `verify.consistency.v1` (`fast`) for SWOT items contradicting themes

  Apply deterministic fixes where possible (drop duplicates; keep the competitor role and move the collaborator to `risks`); the rest become warnings. Runs only when ≥ 2 sections are enabled.
- **Edit:** `packages/reason/src/verify/consistency.ts`, `packages/reason/src/verify/stage.ts`, `packages/reason/test/consistency.test.ts`
- **Accept:** an injected conflicting fixture is fixed or warned; the M1 preset skips this verifier.

### Lane 4: Product & Platform

#### M2-L4-1 · Competitors & Discourse tab
- **Brief:** register a view for `competitors` + `discourse` in one tab.
  - `CompetitorCard`: classification pill, `ScoreBar`, strengths and weaknesses as `ClaimText`.
  - `ThemeList` per competitor: four columns (praise, complaints, switching, unmet), `sampleLabel`, a "small sample" badge under 5, representative quotes, contradiction callouts, collapsed weak signals.
  - A "Data quality" disclosure: merges and refused merges from `resolve`, excluded first-party count.
- **Edit:** `apps/web/src/sections/{competitors,discourse}/**`
- **Accept:** component tests on the seed: the Summit Roast contradiction renders, and the refused Summit Gear merge appears under data quality.

#### M2-L4-2 · SWOT & Actions tab
- **Brief:** `SwotGrid` (2×2, each item a `ClaimText` with a confidence dot) and `ActionCard` (impact/effort/confidence chips, falsification test, success metric, related items that link to their cards). `insufficientEvidence` renders as muted "Not enough evidence for: …".
- **Edit:** `apps/web/src/sections/{swot,actions}/**`
- **Accept:** the seed renders every quadrant and 3 actions; chips resolve.

#### M2-L4-3 · Degradation UX and M2 check
- **Brief:**
  - `WarningBanner` naming missing or partial sections; per-section status badges; header stats extended (themes, competitors).
  - `evals/milestones/m2.test.ts`: fully faked seed run with `MILESTONES=m1,m2` has all 5 sections `ready` and coverage 1; with the discourse fixture removed, the report is `partial`, other sections render, and the banner names the missing section.
- **Edit:** `apps/web/src/features/report/warnings/**`, `evals/milestones/m2.test.ts`
- **Accept:** `pnpm milestone:check m2` is green, and `pnpm milestone:check m1` is still green.

---

## 6. Integration
Rerun swaps **I2–I6** (split §8) with `MILESTONES=m1,m2`. M2-specific pass criteria:
- I2: ≥ 5 competitor candidates, ≥ 40 non-first-party discourse units.
- I3: ≥ 3 theme candidates.
- I4: all 5 sections `ready`/`partial`, coverage = 1, consistency errors = 0.

## 7. Exit checklist: M2 is a complete product when
- [ ] `pnpm milestone:check m1` **and** `m2` are green.
- [ ] Two real stores: all three tabs populated; ≥ 3 themes with sample labels; SWOT has 3–5 items per quadrant; 3 actions.
- [ ] Degraded path proven live: with `ENRICH_PROVIDER` forced to fail, the report still renders with a warning.
- [ ] Runs recorded to `fixtures/real/<slug>-m2/`; deployed with `MILESTONES=m1,m2`; tag `m2-green`.

## 8. Demo if we stop here (90 s)
M1 beats (compressed to 40 s), then:
1. Competitors tab: "Summit Roast is praised for flexible subscriptions **and** criticized for stale roast dates. We show both, with sample sizes, instead of averaging them away." (20 s)
2. Data quality: "Summit Roast Shop merged; Summit Gear, a camping brand with a similar name, correctly **not** merged." (10 s)
3. SWOT → the top action with its falsification test: "every recommendation comes with the cheapest way to prove it wrong." (20 s)

## 9. Improvement slots that fit M2
IS-DISTILL (strongest Baseten story), IS-ASK, IS-POLICIES, IS-TRENDS, IS-GPTZERO (README §6).

## 10. Risks and fallbacks

| Risk | Fallback |
| --- | --- |
| Too little independent discourse | Reviews on more competitor products; weak signals shown honestly; `insufficientEvidence` |
| Clusters are noisy | Raise the threshold; fewer, cleaner themes |
| SWOT is generic | Prompt requires every item to cite ≥ 1 merchant-specific or competitor-specific evidence ID; the validator drops the rest |

## 11. Hooks this milestone leaves for later
- `DiscourseCluster` and competitor entities feed the **M3 map** (competitor nodes, `mentioned_with` edges).
- Theme unmet needs feed the **M4 bundle copy** ("customers of X wish for …").
- The consistency verifier is a registry of checks, so later milestones can add checks.
