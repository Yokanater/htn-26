# S5 — Draft activation (optional)

Requires S4 and a successful human Admin API spike. Preset `s1,s2,s3,s4,s5`.
Flag `FEATURE_DRAFT_ACTIVATION`. This saves a concept draft; it does not provide cross-store inventory,
fulfillment, checkout, a signed partnership, or permission to use another brand's media.
Go/no-go: S1–S4 green in both domains and at least three hours before feature freeze. Otherwise skip.

All cards read AGENTS.md, design v3 and team split v3. Both outfit and setup fixtures are mandatory.
Every Accept also includes `pnpm typecheck`, `pnpm format`, and `pnpm format:check`.
All automated tests are offline. Provider/human checks are separate and never run by coding agents.
Any needed contract extension is a small additive PR with both-domain fixture changes before consumers.
Do not edit dependency manifests. Do not implement a nonexistent old report CLI as a prerequisite.

### S5-L1-1 · Owned-store draft adapter
- Brief: After a human records the Admin API shape, implement draft-only create/read adapter, allowlist, throttling, userErrors and identifier mapping. Public catalog IDs are not assumed to be Admin IDs. No secrets logged.
- Edit: `packages/collect/src/shopify-admin/**`, `packages/collect/src/index.ts`, `packages/collect/test/shopify-admin.test.ts`
- Read: design §7–8; contracts and registered fixtures; core interfaces (read-only unless explicitly in Edit).
- In → Out: approved concept -> draft result using injected client
- After: S4 green + human write spike.
- Accept: `pnpm vitest run packages/collect/test/shopify-admin.test.ts`; fake responses cover errors, wrong shop and draft status.
- Human check: Human creates one draft in an owned development store and verifies it is not published.

### S5-L3-1 · Approval and idempotent action service
- Brief: Freeze approved content hash, reject edits/stale aggregates, enforce execute-once behavior, support dry-run and audit. Inject admin adapter; no import from reason into collect.
- Edit: `packages/reason/src/actions/**`, `packages/reason/src/index.ts`, `packages/reason/test/actions.test.ts`
- Read: design §7–9; contracts and registered fixtures; core interfaces (read-only unless explicitly in Edit).
- In → Out: approved draft + current provenance -> action result/audit
- After: S4 proposal service and core action extension.
- Accept: `pnpm vitest run packages/reason/test/actions.test.ts`; retries, changed content, withdrawn aggregate and partial provider failure.
- Human check: Repeat the same approved action without duplicating a product.

### S5-L4-1 · Action UI/routes and final gate
- Brief: Show connected owned-store badge, approve/execute controls, dry-run status, admin link and audit. All controls require effective flag and server authorization.
- Edit: `apps/server/src/routes/drafts.ts`, `apps/server/src/providers.ts`, `apps/server/test/actions.test.ts`, `apps/web/src/features/merchant/**`, `evals/milestones/s5.test.ts`
- Read: design §7–10; contracts and registered fixtures; core interfaces (read-only unless explicitly in Edit).
- In → Out: approved proposal -> explicit human-triggered draft action
- After: S5 action service + adapter.
- Accept: `pnpm vitest run apps/server/test/actions.test.ts`; S5 suite covers both domains, flag off, wrong owner/store, retry and stale approval.
- Human check: Human executes each domain on the owned development store only.

L2 reviews pricing/coverage claims and regression tests; no new scoring feature is required for S5.
