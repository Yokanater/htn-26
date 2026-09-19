# M3: Ecosystem Map & Mission Control

| Field | Value |
| --- | --- |
| Requires | M1 green (M2 optional: adds competitor nodes and co-mention edges) |
| Preset | `MILESTONES=m1,m3` or `m1,m2,m3` |
| Target green | Sun 02:00 (in parallel with M4) |
| Strengthens | Finalist ("wow"), Browserbase |
| Card format / agent loop | [README §4](./README.md#4-working-with-agents) |

## 1. The product

> **"Watch a swarm of browsers map your ecosystem live, then explore it as a map."**

This adds three visible layers on top of M1 (or M1 + M2):
1. **Mission control:** during a run, a grid of **parallel live browser sessions** (one tile per slot). Each tile shows the site being read and a ticker of steps (navigate → observe → act → extract). Finished tiles keep their last step and a **Watch capture** link.
2. **Ecosystem map (report hero view):** an interactive graph with the merchant at the center, collaborators on one side, and competitors on the other (when M2 is on). Node size = score, ring = evidence strength, edges = complements / competes / mentioned together. Click a node to open its card.
3. **Partner's side:** for the top 3 collaborators, a **mutual-fit** score and a "their side" panel: why they would say yes, what they get, likely objections. Every line is cited.

With M3's flags off, the product is exactly M1 (or M1 + M2).

## 2. What M3 adds per stage

| Stage | Addition |
| --- | --- |
| `collect` | Session slots + `browser.step` events; browser targets front-loaded so sessions run concurrently |
| `score` | `partner_side` scores for the top 3 collaborators |
| `synthesize` | Sections `ecosystem_map` (deterministic, no LLM) and `partner_view` (LLM) |
| UI | Mission-control grid, map hero view, partner panel |

## 3. Contract changes (additive; bump `SCHEMA_VERSION` minor)

```ts
// contracts/src/run.ts (L4 owns this file; L1 requests it via PR)
//   existing 'browser.session' event gains:  slot?: number
//   new event:
| { type: 'browser.step'; sessionId: string; slot: number;
    action: 'navigate' | 'observe' | 'act' | 'extract' | 'close'; detail: string }

// contracts/src/enrich.ts (L2)
//   CandidateScore.kind gains 'partner_side'

// contracts/src/report.ts (L3)
interface EcosystemMap {
  nodes: Array<{ id: string; entityId: string; label: string;
                 role: 'self' | 'collaborator' | 'competitor';
                 subtype?: 'direct' | 'substitute' | 'adjacent';
                 score?: number; evidenceStrength?: CandidateScore['evidenceStrength'] }>;
  edges: Array<{ from: string; to: string; kind: 'complements' | 'competes' | 'mentioned_with';
                 weight: number /* 0..1 */; evidenceIds: string[] }>;
}
interface PartnerView {
  entityId: string; mutualFit: number /* 0..100, computed in code */;
  whyTheySayYes: Claim[]; whatTheyGet: Claim[]; objections: Claim[];
}
// SectionKey values used: 'ecosystem_map' → ReportSection<EcosystemMap>, 'partner_view' → ReportSection<PartnerView[]>
```

**M3-C0 · Contract PR (L3, 15 min, before all other M3 cards):** add every type and enum above in one PR (`run.ts`, `enrich.ts`, `report.ts`), acked by L1, L2, and L4. Types only. Seed data comes with each feature card: `events.jsonl` (L4), `score.json` (L2), `sections/ecosystem_map.json` (L2), and `sections/partner_view.json` (L3), per README §2 rule 9.

## 4. Flags
`FEATURE_MISSION_CONTROL`, `FEATURE_MAP`, `FEATURE_PARTNER_VIEW` (preset `m3`). Each works independently of the other two.

---

## 5. Work split

| Lane | Cards | Human-only |
| --- | --- | --- |
| **L1** | M3-L1-1 | Confirm the real concurrent-session limit with Browserbase; pick targets that look good on screen |
| **L2** | M3-L2-1, M3-L2-2 | Eyeball the map for 2 stores: is it readable? |
| **L3** | M3-L3-1 | Check the partner-side claims make sense from the partner's point of view |
| **L4** | M3-L4-1 … M3-L4-3 | Visual taste pass; record a live run with the grid visible |

### Lane 1: Collection

#### M3-L1-1 · Session slots and step events
- **Brief:**
  - Extend the session pool from M1-L1-2: each session gets a stable `slot` (0..`sessionsConcurrent − 1`), carried on `browser.session`.
  - Emit `browser.step` for navigate / observe / act / extract / close, with a short human-readable `detail` (for example "Loading more reviews (2/3)"). Throttle to ≤ 2 steps per second per slot.
  - When `FEATURE_MISSION_CONTROL` is on, the collect scheduler front-loads browser targets so all slots are busy at once early in `collect`. The total budget is unchanged.
- **Edit:** `packages/collect/src/browserbase/pool.ts`, `packages/collect/src/browserbase/session.ts`, `packages/collect/src/collect/scheduler.ts`, `packages/collect/test/pool.test.ts`
- **Accept:** a pool test shows slot reuse and ≤ `sessionsConcurrent` concurrent sessions; a scheduler test shows browser targets first when the flag is on and M1 ordering when it's off. Live: ≥ min(3, plan limit) sessions open at once (visible in events).

### Lane 2: Intelligence

#### M3-L2-1 · Ecosystem map section (deterministic)
- **Brief:** an `ecosystem_map` `SectionSynthesizer` with no LLM, exported through `createEnrichStages(env).sections`.
  - **Nodes:** self + top collaborators (≤ 10) + top competitors (≤ 10, only if competitor scores exist).
  - **Edges:**
    - `complements` (self → collaborator, weight = score / 100)
    - `competes` (self → competitor, weight = score / 100)
    - `mentioned_with` (any pair co-mentioned in ≥ 2 evidence units via `Enrichment.mentions` / `subject`; weight = normalized count; `evidenceIds` = those units)
  - Must work when M2 is off (collaborator nodes only).
- **Edit:** `packages/enrich/src/sections/ecosystem-map.ts`, `packages/enrich/src/index.ts` (export), `packages/enrich/test/ecosystem-map.test.ts`, `fixtures/seed/northbound/sections/ecosystem_map.json`
- **Accept:**
  - The seed produces self + 3 collaborators + 3 competitors.
  - **No** edge involves Summit Gear: the refused merge must not leak into the map.
  - A unit fixture with two evidence units that co-mention two map entities creates exactly one `mentioned_with` edge.
  - With competitor scores removed, only collaborator nodes remain.

#### M3-L2-2 · Mutual fit (partner-side score)
- **Brief:** for the top 3 collaborators, compute a `CandidateScore` with `kind: 'partner_side'`. Components:
  - `complement_fit` (reuse)
  - `audience_fit` (reuse)
  - `price_fit_reverse` (merchant median ÷ partner median, same curve as design §7.1)
  - `merchant_evidence_quality` (the merchant's own ratings and independent mentions, as the partner would see them)
  - `value_for_partner` (`llm_judged` via `ComponentJudge`, new component key in `judge.v2`)

  `PartnerView.mutualFit = round(min(collaborator total, partner-side total))`. Runs only when `partner_view` is enabled.
- **Edit:** `packages/enrich/src/score/partner-side.ts`, `packages/enrich/src/score/stage.ts`, `packages/enrich/src/prompts/judge.v2.ts`, `packages/enrich/test/partner-side.test.ts`, `fixtures/seed/northbound/score.json`
- **Accept:** seed tests show Kettle & Pour mutual fit ≥ Oat Harbor mutual fit; M1 score output is unchanged when the section is disabled.

### Lane 3: Reasoning & Pipeline

#### M3-L3-1 · Partner-view synthesizer
- **After:** M3-L2-2 (use the seed `partner_side` scores until then)
- **Brief:** the `partner_view` section (`dependsOn: ['collaborators']`). For each of the top 3: `whyTheySayYes`, `whatTheyGet`, and `objections`, written **from the partner's perspective**. Its bundle includes the partner's own storefront and reviews plus the merchant's first-party and independent evidence. Every claim is cited; `mutualFit` is copied from the score, never generated.
- **Edit:** `packages/reason/src/synth/partner-view.ts`, `packages/reason/src/prompts/section-partner-view.v1.ts`, `fixtures/seed/northbound/sections/partner_view.json`, `packages/reason/test/partner-view.test.ts`
- **Accept:** `FixtureReasoner` seed parity; live on seed inputs passes the citation validator; a test proves `mutualFit` equals the score value.

### Lane 4: Product & Platform

#### M3-L4-1 · Mission-control grid
- **Brief:** `MissionControl` on the run page when `FEATURE_MISSION_CONTROL` is on; toggle between single and grid view.
  - One tile per slot. Live: an iframe of that slot's `liveViewUrl`. Replay: a stylized placeholder, or the screenshot if IS-CAPTURE is on.
  - A domain + favicon header, a step ticker from `browser.step`, and a finished state with **Watch capture**.
  - Counters: sessions open, pages read, evidence captured.
  - Add seed `slot` + `browser.step` events to `events.jsonl`.
- **Edit:** `apps/web/src/features/run/mission-control/**`, `fixtures/seed/northbound/events.jsonl`
- **Accept:** the seed replay fills 3 tiles with tickers; a component test checks slot reuse after `browser.session.closed`. Live: ≥ 3 simultaneous iframes (or the plan limit).

#### M3-L4-2 · Ecosystem map hero view
- **Brief:** register a view for `ecosystem_map` as the **first** report tab ("Map") when enabled. Use `react-force-graph-2d` with fixed radial seeding: self at the center, collaborators on the left arc, competitors on the right arc.
  - Node size = score; ring color = evidence strength; edge style per kind.
  - Hover shows a mini-card; click opens the full card in a side panel (reuses `CandidateCard` / `CompetitorCard`).
  - Legend, a "collaborators only / all" filter, a reduced-motion fallback (static layout), and a mobile fallback (list).
- **Edit:** `apps/web/src/sections/ecosystem-map/**`
- **Accept:** renders the seed with and without competitor nodes; clicking every node opens the right card (automated test over nodes).

#### M3-L4-3 · Partner panel and M3 check
- **Brief:**
  - The `partner_view` view: a mutual-fit badge on the top-3 collaborator cards and a "Their side" expandable panel with the three claim lists.
  - `evals/milestones/m3.test.ts`: a fully faked seed run with `MILESTONES=m1,m3` and with `m1,m2,m3`: `ecosystem_map` and `partner_view` are `ready`, map node counts match presets, and `browser.step` events are present. With `MILESTONES=m1`, no M3 section, event, or view appears.
- **Edit:** `apps/web/src/sections/partner-view/**`, `evals/milestones/m3.test.ts`
- **Accept:** `pnpm milestone:check m3` is green; `m1` and `m2` checks are still green.

---

## 6. Integration
- Run a live store with `MILESTONES=m1,m3` (and `m1,m2,m3` if M2 is green). Watch mission control fill during `collect`, the map render after `assemble`, and the partner panels on the top 3.
- Record `fixtures/real/<slug>-m3/`. **For the demo, the grid looks best live.** Rehearse one live run and keep the replay as the fallback.

## 7. Exit checklist: M3 is a complete product when
- [ ] `pnpm milestone:check m3` is green; earlier checks are still green.
- [ ] Live run: ≥ min(3, plan limit) concurrent tiles with live iframes and step tickers.
- [ ] Map renders for recorded runs both with and without M2; every node opens its card.
- [ ] Partner panel on the top 3 with cited claims; mutual fit shown.
- [ ] Deployed with the new preset; tag `m3-green`.

## 8. Demo if we stop here (90 s)
1. Paste a store → **the mission-control grid lights up with 3+ browsers** reading real review widgets and storefronts in parallel. (25 s)
2. The report opens on the **map**: "this is your ecosystem: partners on the left, rivals on the right, lines where customers mention them together." (20 s)
3. Click Kettle & Pour → card → **Their side**: "why they'd say yes, with receipts." (20 s)
4. Click a citation → **Watch capture** of that exact browser session. (15 s)

## 9. Improvement slots that fit M3
IS-CAPTURE (makes replay tiles show real screenshots; strongly recommended), IS-SENTRY, IS-ASK.

## 10. Risks and fallbacks

| Risk | Fallback |
| --- | --- |
| Plan allows only 1–2 concurrent sessions | Grid adapts to the slot count; the story becomes "watch the agent work" instead of "swarm" |
| Live-view iframes blocked or slow | Placeholder tiles with the step ticker (still informative); screenshots via IS-CAPTURE |
| Map is visually cluttered | Cap nodes at 10 per role; hide `mentioned_with` edges by default |

## 11. Hooks this milestone leaves for later
- **Map nodes are clickable entities:** M4 adds a "Design a bundle" action on collaborator nodes.
- **`browser.step`** is a general progress channel; any future adapter's steps show up in mission control for free.
