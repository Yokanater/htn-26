# S3 — Consented demand ledger

Requires S2. Preset `s1,s2,s3`. Flag `FEATURE_DEMAND_LEDGER`.
Exit: explicit choices in both domains produce deduplicated private observations, consent gates aggregate
use, withdrawal/deletion invalidates snapshots, and replay/model impressions never add live support.
No public real cohort is required to exist: insufficient evidence is a valid outcome.

All cards read AGENTS.md, design v3 and team split v3. Both outfit and setup fixtures are mandatory.
Every Accept also includes `pnpm typecheck`, `pnpm format`, and `pnpm format:check`.
All automated tests are offline. Provider/human checks are separate and never run by coding agents.
Any needed contract extension is a small additive PR with both-domain fixture changes before consumers.
Do not edit dependency manifests. Do not implement a nonexistent old report CLI as a prerequisite.

### S3-L2-1 · Deterministic event projection and aggregates
- Brief: Implement latest-revision selection projection, one-session/one-cohort/pair counting, fixed cohort keys, provenance isolation, window filtering, suppression and aggregate invalidation inputs. Keep denominator, pair support and supply gaps separate. No LLM computes counts.
- Edit: `packages/enrich/src/demand/**`, `packages/enrich/src/index.ts`, `packages/enrich/test/demand.test.ts`, `fixtures/seed/outfit/demand-events.json`, `fixtures/seed/setup/demand-events.json`, `fixtures/seed/outfit/aggregate.json`, `fixtures/seed/setup/aggregate.json`
- Read: design §4, §6; contracts and registered fixtures; core interfaces (read-only unless explicitly in Edit).
- In → Out: validated events + current consent + briefs/selections -> private aggregates + publishable snapshots
- After: S0 interfaces; S2 reference fixture IDs.
- Accept: `pnpm vitest run packages/enrich/test/demand.test.ts`; duplicate, old revision, reject-after-accept, opt-out, withdrawal/re-consent, expiry, seeds/replay, small-cell and denominator cases.
- Human check: Hand-count a synthetic cohort in each domain and reconcile every output.

### S3-L3-1 · Explicit feedback and consent experience
- Brief: Add accept/reject reasons, save/request-offer intent, independent opt-in and withdrawal/delete controls. Display what sharing means. Use current revision; rejected events are visible and recoverable. Do not treat browsing as a purchase.
- Edit: `apps/web/src/features/shopper/collection/**`, `apps/web/src/features/shopper/brief/**`
- Read: design §2, §6, §8; contracts and registered fixtures; core interfaces (read-only unless explicitly in Edit).
- In → Out: explicit UI choices -> validated decision/consent DTOs
- After: S2 UI; L4 DTO agreement.
- Accept: `pnpm vitest run apps/web/src/features/shopper`; no prechecked opt-in, stale 409 recovery, opt-out keeps matching usable.
- Human check: Ask a tester to explain what they consented to; repeat in both domains.

### S3-L4-1 · Validated private ledger and erasure
- Brief: Build server-assigned event IDs/time/origin/session, offer-membership checks, consent versions, atomic per-session storage/idempotency and deletion propagation. Publish fixed snapshots only after projection; block stale reads after withdrawal. No raw shopper data in merchant API/logs.
- Edit: `apps/server/src/routes/{decisions,consent,session}.ts`, `apps/server/src/services/**`, `apps/server/src/providers.ts`, `apps/server/src/app.ts`, `apps/server/test/demand.test.ts`, `evals/milestones/s3.test.ts`
- Read: design §6, §8–9; contracts and registered fixtures; core interfaces (read-only unless explicitly in Edit).
- In → Out: owner-authorized decisions -> private event ledger -> safe aggregate service
- After: S1 sessions + S2 offer references; projection can be fake initially.
- Accept: `pnpm vitest run apps/server/test/demand.test.ts`; S3 suite tests retries, forged offer/session/origin, consent version, cross-owner access, immediate invalidation and deletion.
- Human check: Withdraw in one browser and verify no old merchant snapshot remains readable.

L1 starts S4-L1-1 during S3; it depends on the existing catalog adapter, not finished aggregates.
