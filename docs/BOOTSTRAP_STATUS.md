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

Pending the bootstrap implementation. Replace this paragraph with measured commands/results;
do not infer feature completion from presets or schema tests.
