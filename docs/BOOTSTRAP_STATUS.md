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

The current L4 integration branch composes the delivered L1, L3, and L4 slices:

- L1 media validation, browser normalization, product evidence components, and bounded catalog
  utilities are present.
- L3's fake-backed, budgeted intent interpreter now powers L4's private brief API. Its editable brief
  component is mounted in the shopper journey for both domains.
- L4 owner sessions, same-origin writes, private assets, expiry/deletion, compare-and-set brief
  revisions, the shopper shell, and the labeled merchant preview are connected.

The runnable path is text description -> editable draft -> explicit confirmation. The L1 image
component normalizes and previews images in the browser, but the server continues to reject image
submission until the approved decoder is installed and injected. Catalog search, matching, consented
demand projection, and merchant profiling are not mounted yet; the merchant card remains explicitly
synthetic. No live provider was called during integration.


## General object detection — 2026-09-19

The runtime now uses the OpenAI vision adapter for text and image interpretation when
OPENAI_API_KEY and OPENAI_MODEL_VISION are set. Missing configuration returns a typed 503;
it never silently substitutes fixture answers. Tests still inject the offline interpreter.
The setup domain now means general products, preserving existing DTO values. One to six
actual objects are supported, including a single-object seed fixture.

Local macOS uploads use the installed sips decoder with a pixel limit, deadline, resize,
fresh PNG encoding, and metadata-chunk removal. Other deployment platforms still need an
injected decoder. Owner sessions and assets remain in memory and expire on server restart.

A user-authorized live browser check uploaded a synthetic red mug image and received one
live item: a plain red coffee mug. Catalog matching remains a separate unfinished integration.

### S2-L4-1 shopper demo integration

The integration worktree now mounts owner-scoped confirmed-brief search routes and polls bounded
collection runs. It wires the L2 matcher, L3 runner/workspace, L1 product/evidence components,
and a live storefront discovery adapter. The UI continues from confirmation through product results,
a visit-local shortlist, downloadable links, and merchant handoff. Cancellation and brief revision
checks prevent outdated runs from continuing to update the workspace. Search ends within three
minutes. Unknown shipping and unsupported currencies remain unresolved rather than passing checks.

This implementation uses polling rather than SSE and in-memory run state; it is a skeletal demo,
not durable job infrastructure. S3 demand persistence and live merchant opportunity integration remain
pending. See DEMO_SCRIPT.md for configuration and the implemented demonstration sequence.
