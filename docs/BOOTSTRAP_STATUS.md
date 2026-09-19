# Bootstrap migration — REVAMP-0

The user authorized revising the product plan first, then updating the existing bootstrap. This
is a one-time cross-lane migration on the existing bootstrap branch; no dependency manifest,
lockfile, private environment file, external service, or store is changed.

## Scope

- Replace active design, team split, milestone README; add S1–S5 cards and demo script.
- Archive v2 plans and leave old milestone filenames as explicit redirects to the new ladder.
- Update AGENTS.md and CODEOWNERS to reflect the two-sided product and split UI ownership.
- Add browser-safe intent/product/match/demand/opportunity contracts, category configuration,
  core interfaces, synthetic outfit/setup fixtures, and non-vacuous fixture validation.
- Preserve common primitives and legacy m-presets; add s-presets, effective flag dependency checks
  and explicit plan-family separation. Default the example configuration to s1 and fake providers.
- Expose sanitized capabilities through the bootstrap server; update the placeholder landing copy
  to explain both surfaces and both domains without pretending feature implementation exists.
- Run offline acceptance, typecheck and formatting. Record exact results below after implementation.

## What remains after bootstrap

S1 image decoder spike/private uploads/vision editor; S2 catalog adapters/matching/run engine;
S3 decision ledger/consent persistence/aggregation/erasure; S4 merchant mapping/proposal UI;
S5 optional draft action. The milestone suites for these features must be implemented by their
cards. Bootstrap tests never claim these features ship.

## Dependency and access risks

The installed stack supports core contracts/server/web work. Image normalization needs a verified
installed decoder; if unavailable, a human dependency change is required before image upload can
ship. No dependency is added by REVAMP-0. Actual provider access/model choice/quota and image
matching quality require human spikes in both domains. No live API call is performed in this task.

## Validation

Completed offline on 2026-09-19. No live providers were called.

| Command | Observed output |
| --- | --- |
| `pnpm typecheck` | `pnpm -r exec tsc --noEmit` — exit 0 |
| `pnpm test` | `Test Files 10 passed (10); Tests 108 passed (108)` |
| `pnpm fixtures:check` | `Test Files 3 passed (3); Tests 66 passed (66)` |
| `pnpm exec vitest run --project milestones --passWithNoTests=false evals/milestones/bootstrap.test.ts` | `Test Files 1 passed (1); Tests 3 passed (3)` |
| `pnpm format` / `pnpm format:check` | `Checked 78 files. No fixes applied.` on final pass |
| `pnpm --filter @sei/web build` | `2019 modules transformed; built in 3.25s` |
| `git diff --check` | exit 0, no whitespace errors |

Initial typecheck caught two unparsed `response.json()` assertions; fixed using CapabilitiesSchema.
Vitest initially could not write its config cache under the filesystem sandbox; the authorized
rerun passed. These results validate the foundation only, not image matching or live market demand.

Implemented exports: intent/offer/match/consent/event/aggregate/opportunity schemas, shopping/demand
provider and store interfaces, equal-domain configuration, s-presets and capability metadata.
Sixteen required JSON fixtures (eight per domain) validate without skips; the integration suite checks
references, fictional provenance and the withdrawn-session fixture story. Actual projection is S3.

## Integration status — 2026-09-19

The integration branch (`codex/s1-integration`) composes the delivered L1, L2, L3 and L4 slices:

- L1 media validation, browser normalization, product tiles/evidence drawer, and the catalog adapter.
- L3's budgeted intent interpreter powers the private brief API; its editable brief component and
  collection workspace are mounted in the shopper journey for both domains.
- L2's constrained collection engine and L3's checkpointed run pipeline are wired by the server
  composition root (`apps/server/src/providers.ts`).
- L4 owner sessions, same-origin writes, private assets, expiry/deletion, compare-and-set brief
  revisions, match/SSE routes, the shopper shell and the labeled merchant preview.

The runnable path is text or image -> editable draft -> explicit confirmation -> "Find products" ->
streamed collection with cited checks, named gaps and alternatives. Gates:
`evals/milestones/s1.test.ts` and `evals/milestones/s2.test.ts` (both domains).

Known limits, all requiring a human decision or spike:

- **Uploads are sanitized, not decoded.** No image library is installed and dependencies are
  human-only, so `apps/server/src/services/image.ts` validates container structure, checksums and
  size/pixel limits, rejects animation, strips EXIF/XMP/ICC/text and trailing bytes, but never
  decodes pixels. Swap in a real decoder behind the `ImageNormalizer` seam if one is approved.
- **Vision is synthetic unless configured.** `VISION_PROVIDER=openai` (with `OPENAI_API_KEY` and
  `OPENAI_MODEL_VISION`) uses the L3 adapter and marks drafts `live`; it has never been run against
  the real API. The default returns canned drafts marked `seed`.
- **The catalog is the synthetic seed inventory** (`CATALOG_PROVIDER=fake`). Seed offers only match
  `seed` briefs, so a `live` brief finds nothing until a live catalog adapter is approved.
- Runs, checkpoints and sessions are in memory; a restart drops them.
- Demand projection, consent and merchant profiling (S3/S4) are not mounted; the merchant card
  remains explicitly synthetic. No live provider was called during integration.
