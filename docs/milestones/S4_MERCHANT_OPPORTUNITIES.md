# S4 — Demand-backed merchant collaborations

Requires S3. Preset `s1,s2,s3,s4`. Flag `FEATURE_MERCHANT_OPPORTUNITIES`.
This completes the intended two-sided product. Exit: existing and newly profiled stores can inspect
safe eligible cohort evidence and generate a supported proposal in each domain. New supply matches
are labeled inferred and do not inherit another merchant's observed support.

All cards read AGENTS.md, design v3 and team split v3. Both outfit and setup fixtures are mandatory.
Every Accept also includes `pnpm typecheck`, `pnpm format`, and `pnpm format:check`.
All automated tests are offline. Provider/human checks are separate and never run by coding agents.
Any needed contract extension is a small additive PR with both-domain fixture changes before consumers.
Do not edit dependency manifests. Do not implement a nonexistent old report CLI as a prerequisite.

### S4-L1-1 · Merchant catalog profile
- Brief: Reuse verified product collection to profile public merchant domains, canonicalize redirects safely, and expose product categories/constraints. URL input does not establish store ownership or partner willingness.
- Edit: `packages/collect/src/merchant/**`, `packages/collect/src/index.ts`, `packages/collect/test/merchant.test.ts`
- Read: design §3, §6.3, §8; contracts and registered fixtures; core interfaces (read-only unless explicitly in Edit).
- In → Out: public merchant URL -> normalized public catalog and evidence
- After: S2 catalog adapter; may start during S3.
- Accept: `pnpm vitest run packages/collect/test/merchant.test.ts`; both domains, custom domains, seller separation, unsafe URL and unavailable catalog.
- Human check: Choose a newcomer absent from cohort selections; verify sourced products.

### S4-L2-1 · Supply-to-demand opportunity mapping
- Brief: Map merchant products to supported cohort requirements; calculate complementary coverage and unknowns. Separate observed pair support from inferred supply fit, suppress undersized cells, and never manufacture support for a new merchant.
- Edit: `packages/enrich/src/opportunities/**`, `packages/enrich/src/index.ts`, `packages/enrich/test/opportunities.test.ts`
- Read: design §6.3–7; contracts and registered fixtures; core interfaces (read-only unless explicitly in Edit).
- In → Out: public profiles + eligible aggregates -> ranked typed opportunity facts
- After: S3 aggregate contract; start with synthetic fixtures.
- Accept: `pnpm vitest run packages/enrich/test/opportunities.test.ts`; no small-cell leak, no raw identifiers, newcomer zero pair support, no model-only support.
- Human check: Explain one accepted and one rejected pairing in each domain from the underlying facts.

### S4-L3-1 · Collaboration brief and verification
- Brief: Generate editable proposal/outreach from aggregate facts and public product evidence only. Cite aggregate version/window and evidence IDs. Include mutual-benefit hypotheses, unknown terms and falsification step; do not invent willingness, sales or discount economics.
- Edit: `packages/reason/src/opportunities/**`, `packages/reason/src/index.ts`, `packages/reason/test/opportunities.test.ts`
- Read: design §7; contracts and registered fixtures; core interfaces (read-only unless explicitly in Edit).
- In → Out: opportunity facts -> validated collaboration draft
- After: S4 opportunity contract; fake reasoner first.
- Accept: `pnpm vitest run packages/reason/test/opportunities.test.ts`; unknown citations, unsupported counts, absent costs and private-data prompts rejected.
- Human check: Read two proposals per domain and check that the citations actually support each factual statement.

### S4-L4-1 · Merchant workspace and full-loop integration
- Brief: Build merchant profile/opportunity/draft routes and UI with observed/inferred labels, privacy-safe coarse counts, synthetic labels, unknowns and copyable drafts. Restrict private merchant access to owned/seeded stores pending real ownership onboarding. No individual shopper drilldown.
- Edit: `apps/server/src/routes/{merchants,opportunities,drafts}.ts`, `apps/server/src/providers.ts`, `apps/server/src/app.ts`, `apps/server/test/merchant.test.ts`, `apps/web/src/features/merchant/**`, `apps/web/src/App.tsx`, `evals/milestones/s4.test.ts`, `docs/DEMO_SCRIPT.md`
- Read: design §2, §6–10; contracts and registered fixtures; core interfaces (read-only unless explicitly in Edit).
- In → Out: merchant session + URL -> safe opportunity view -> editable draft
- After: S3 services; build UI with S0 fixtures while L1/L2/L3 finish.
- Accept: `pnpm vitest run apps/server/test/merchant.test.ts apps/web/src/features/merchant`; S4 suite exercises both full shopper->merchant paths and newcomer attribution.
- Human check: One real merchant reaction if available, both domain recordings, and a withdrawal after a proposal exists.
