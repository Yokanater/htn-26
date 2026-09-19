# S1 — Inspiration to confirmed intent

Requires S0. Preset `s1`. Flag `FEATURE_INTENT_CAPTURE`. Owner of integration: L4.
Outcome: a private image or text description becomes an editable, versioned brief in either domain.
Exit: both images + text work, ambiguous interpretation can be corrected, no matching before confirmation,
uploads are owner-only, unsupported uploads fail safely, and no merchant sharing is implied by intake.

All cards read AGENTS.md, design v3 and team split v3. Both outfit and setup fixtures are mandatory.
Every Accept also includes `pnpm typecheck`, `pnpm format`, and `pnpm format:check`.
All automated tests are offline. Provider/human checks are separate and never run by coding agents.
Any needed contract extension is a small additive PR with both-domain fixture changes before consumers.
Do not edit dependency manifests. Do not implement a nonexistent old report CLI as a prerequisite.

### S1-L1-1 · Media intake component
- Brief: Build image preview, one-file selection, client resize/re-encode, validation/error states and text alternative. Use real browser APIs; server still validates. No upload provider calls from the component.
- Edit: `apps/web/src/features/shopper/media/**` (including colocated tests)
- Read: design §2, §5.1, §8; contracts and registered fixtures; core interfaces (read-only unless explicitly in Edit).
- In → Out: file/text -> upload request and opaque asset DTO
- After: S0 upload contract.
- Accept: `pnpm vitest run apps/web/src/features/shopper/media`; test invalid type/size, accessible input and text alternative.
- Human check: Try one permitted outfit image and one setup image; show no metadata in normalized upload.

### S1-L3-1 · Intent interpretation and editor
- Brief: Implement internal nullable vision schema, configured Responses adapter + fake adapter, intent mapper, domain configuration and brief editor. Ask explicit size/dimension constraints; no guessed identities. User confirms slots and required/optional status. Build text path with the same output.
- Edit: `packages/reason/src/intent/**`, `packages/reason/src/index.ts`, `packages/reason/test/intent.test.ts`, `apps/web/src/features/shopper/brief/**`
- Read: design §4, §5.1; contracts and registered fixtures; core interfaces (read-only unless explicitly in Edit).
- In → Out: image/text + domain -> draft IntentBrief -> confirmation edits
- After: S0 contracts and recorded vision shapes.
- Accept: `pnpm vitest run packages/reason/test/intent.test.ts apps/web/src/features/shopper/brief`; test invalid output repair/refusal, both domains, no auto-confirm.
- Human check: Correct a mistaken object in each domain; review model assertions and latency.

### S1-L4-1 · Private session, assets and brief API
- Brief: Implement owner sessions, private normalized asset persistence/expiry, same-origin mutations, brief revision compare-and-set, upload decoder from successful spike, and typed error handling. Mount shell and injected intent service. No raw assets in logs. Retention/deletion hooks are required now.
- Edit: `apps/server/src/routes/{assets,briefs,session}.ts`, `apps/server/src/services/**`, `apps/server/src/providers.ts`, `apps/server/src/app.ts`, `apps/server/test/intake.test.ts`, `apps/web/src/App.tsx`, `apps/web/src/shell/**`, `evals/milestones/s1.test.ts`
- Read: design §5.1, §8–9; contracts and registered fixtures; core interfaces (read-only unless explicitly in Edit).
- In → Out: owner-authenticated upload/edit -> private asset + versioned brief
- After: S0 decoder/session spike; use fake intent until L3 is ready.
- Accept: `pnpm vitest run apps/server/test/intake.test.ts`; S1 suite tests both domains, 413/415, cross-owner denial, revision conflict and expiry.
- Human check: Open a second browser session; it cannot fetch the first image/brief. A URL is not a storage key.

L2 starts S2-L2-1 on the existing fixtures while S1 is built; no idle lane.
