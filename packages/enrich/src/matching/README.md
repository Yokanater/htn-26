# S2-L2-1 · Constrained collection engine (L2)

Handoff for [S2-L2-1](../../../../docs/milestones/S2_COLLECTION_MATCHING.md). Branch `codex/S2-L2-1`,
base `8e83684` (bootstrap). Updated 2026-09-19.

**Status:** implemented and tested offline for outfits and setups. Not yet wired into a route
(S2-L4-1), not behind a feature flag yet (the flag applies at wiring), not human-checked.

## What it does

Confirmed brief + offers per slot -> up to three `CollectionMatch` results, best first.

- Every offer gets hard checks in a fixed order: `price` (brief currency, never converted),
  `availability`, `ships_to`, then the slot's constraints: `size`, `dimension:<axis>`, `mounting`,
  `exclude_material:<material>`. A known violation (`fail`) removes the offer. Missing data is
  `unknown`: the offer stays eligible but its collection cannot be `ready`.
- Beam search (width 20, 8 candidates per slot, explicit "missing" option per slot). Ranking:
  required slots covered → within budget → fewer unverified checks → optional slots covered →
  relevance → lower subtotal → fewer merchants → offer IDs (stable replay).
- A known over-budget total ranks below an unverified check: over budget is a known violation,
  unknown is not. An impossible budget returns `partial` with a warning, not a dropped item.
- Never adds a merchant to make a pair. Deduplicates one seller variant (merchant + product +
  variant); the same product from another seller stays separate. One variant never fills two slots.
- Unknown price is never zero: any unpriced selection makes `itemSubtotal` null.
- Offers whose `sampleOrigin` differs from the run's are excluded; seed/replay results carry a
  provenance warning.
- Extra collections must keep the best one's required coverage, may not be over budget unless the
  best is, and may not be a subset of an earlier collection.
- Deterministic normalization (`normalize.ts`): size aliases (`Medium` → `M`), lengths with an
  explicit unit (`47 in`, `1300 mm`) → cm, material phrases, mounting wording. A bare number
  without a unit, a combined `100 x 60 x 75` string, or incomparable sizes (`US 8` vs `M`) stay
  unknown. No model call anywhere; relevance is a transparent 0–1000 score, not a probability.

## Public API (`@sei/enrich`)

| Export | Use |
| --- | --- |
| `matchCollections(brief, candidatesBySlot, options)` | Engine; `options.sampleOrigin` is required |
| `createCollectionMatcher(options?)` | Implements the current `CollectionMatcher` port (L4 wires it) |
| `groupOffersBySlot(brief, offers)` | Stopgap slot assignment by exact category (see limitations) |
| `evaluateOffer(brief, slot, offer)` | The hard checks for one offer |
| `normalizeOfferAttributes(offer)` | Deterministic normalizer; `options.normalize` replaces it |
| `CHECK_KEYS`, `MATCHING_LIMITS` | Provisional check key names; beam/candidate/collection caps |

## Fixtures

`fixtures/seed/{outfit,setup}/matches.json` are now the engine's real output (the placeholder
`fixture_eligibility` check was replaced). A test requires the engine to reproduce them exactly.
IDs and selections are unchanged, so demand events and `evals/milestones/bootstrap.test.ts` still
cross-reference. Adversarial offers are built inside `test/matching.test.ts`; `offers.json` is L1's.

## Validation (2026-09-19, offline)

| Command | Result |
| --- | --- |
| `pnpm vitest run packages/enrich/test/matching.test.ts` | 60 passed |
| `pnpm typecheck` | exit 0 |
| `pnpm format` / `pnpm format:check` | no fixes on final pass |
| `pnpm fixtures:check` | 66 passed |
| `pnpm test` | 168 passed |
| `pnpm exec vitest run --project milestones --passWithNoTests=false evals/milestones/bootstrap.test.ts` | 3 passed |

Six deliberately broken ranking rules (merchant tie-break, budget, variant dedupe, unverified
ranking, over-budget extras, provenance filter) each fail the suite in both domains.

## Known limitations (need other lanes)

1. **Slot assignment (L3, `core/shopping.ts`):** `CollectionMatcher.match` receives one flat offer
   list, so `createCollectionMatcher` assigns offers by exact category. Once the port carries each
   query's slot ID, the pipeline should call `matchCollections` with per-slot candidates.
2. **Check/attribute names (L1 + L2):** `CHECK_KEYS` and the attribute keys read in `normalize.ts`
   (`size`, `width_cm`/`width`, `material`, `mounting`, …) are provisional. Web and `reason` cannot
   import enrich, so the agreed list belongs in `@sei/contracts` (`shopping.ts`, L1 editor).
3. **Alternative checks (L1 contract):** `SlotMatch.checks` covers only the selected offer, so tiles
   cannot show "shipping unknown" for alternatives without an additive contract field.
4. **Evidence field names (L1):** decided checks cite evidence whose `field` matches the check
   (`price`, `availability`, `shipping`, `size`, `width_cm`, …), else `product_record` captures.
5. **Baseten normalization (L2 human spike):** no recording exists in `fixtures/spikes/`. The
   `options.normalize` hook is where a recorded/model-backed normalizer plugs in.

## Human checks still required

Blind-compare coherence and constraint compliance against independent per-item search, in both
domains, once real catalog recordings exist.

## Next steps

- S2-L4-1 wires `createCollectionMatcher` in `apps/server/src/providers.ts` behind
  `FEATURE_COLLECTION_MATCHING`; S2-L3-1 pipeline injects it.
- Before S3-L2-1, L2 needs an additive contract card for `contracts/demand.ts` (merchant support,
  gap counts, suppression), a written consent/version rule with L4, `brief_confirmed` events in the
  demand fixtures (requires L4 to relax two assertions in `evals/milestones/bootstrap.test.ts`), and
  a decision on aggregate ID/version assignment and published count ranges.
- Before S4-L2-1: an opportunity-facts type in `core/demand.ts`, stable merchant IDs derived from
  the canonical store domain (L1), and a fixed per-domain category list (L3) so cohorts and
  newcomer catalogs map to the same categories.
