# Implementation playbook — Claude and Codex

This guide explains how to implement the active plan. `AGENTS.md` is the common repository rule
source. The user's current assignment defines task scope. This guide does not grant access to
live providers, new dependencies, external messages, store writes or a teammate's unassigned paths.

## 1. Load the right context

Read in this order:

1. Root `AGENTS.md`, then any applicable nested instructions.
2. [Bootstrap status](BOOTSTRAP_STATUS.md): distinguish implemented foundations from pending cards.
3. [Active ladder](milestones/README.md) and your assigned card, including Edit/After/Accept.
4. [Design v3](SHOPIFY_ECOSYSTEM_INTELLIGENCE_DESIGN.md), only the sections the card references.
5. [Team split](TEAM_WORK_SPLIT.md), relevant schemas/core ports, both-domain seed files and tests.
6. When reusing old code, read [branch salvage review](BRANCH_SALVAGE_REVIEW.md) and the pinned
   source, then map it to the assigned card. Archived plans do not become active instructions.

Do not load the entire archived design into every coding prompt. Do not assume placeholder
modules implement their comments. `implementation: 'bootstrap'` is intentional until real services ship.

## 2. Start safely and capture the baseline

Run from the directory containing root `package.json`:

```powershell
git status --short
git branch --show-current
git rev-parse HEAD
git worktree list
```

Record HEAD as the card's base SHA in your handoff. Do not checkout/reset over another agent's
edits. Use the assigned isolated worktree; the coordinator creates one if needed. Branch choice
must start from the current integrated bootstrap, not old `main` or a legacy implementation branch.
Until the bootstrap merges to main, main is not the correct baseline for evaluating one card's scope.

Use `git diff --stat <recorded-base-sha>` plus `git status --short` to see your card's full changes,
including new untracked files. Also inspect the proposed integration diff against its target branch;
baseline bootstrap files outside your card are not permission to edit them or reason to delete them.

## 3. What is actually built

At REVAMP-0 (`78569ed`):

- Common primitives and v3 Zod schemas in contracts: intent, shopping, demand, opportunity, capabilities.
- Core ports in `shopping.ts` / `demand.ts`; equal-domain configuration in `categories.ts`.
- Active s-presets, preserved legacy m-presets, flag dependency validation.
- Sixteen synthetic JSON fixtures, strict fixture validation and cross-reference bootstrap tests.
- Hono health/capability routes and an honest React landing page.

Not built: private upload/decoder, live vision/catalog adapters, collection engine, persisted
consent/decisions, aggregate computation, merchant workspace, action service. No active S1–S5
feature suite exists at bootstrap. Old reserved scripts may reference absent CLI files.

## 4. Implementation order within a card

1. State the input/output contract and one success plus one failure case for each domain.
2. Check the existing types; extend additively only if needed. Request a separately scoped contract
   card when your Edit list excludes shared schemas. Do not fork a local copy of a shared DTO.
3. Write a fixture-backed adapter/service and meaningful tests before wiring live-capable factories.
4. Implement deterministic constraints/counts in code; give models only interpretation/explanation.
5. Wire cross-package calls through injected core interfaces. Keep the web dependent on contracts only.
6. Wire server routes and UI under effective flags; disabled feature routes cannot still mutate state.
7. Exercise partial failures, cancellation, stale revision and explicit unknown data as relevant.
8. Validate, inspect the diff, and write a concise handoff. Never silently claim the next card is done.

The shared schemas are a starting point, not every service invariant. Check actual offer membership,
owner identity, arithmetic, current consent, revision and snapshot freshness at service boundaries.
Parsing a schema does not prove those relationships.

## 5. Non-negotiable product invariants

### Both domains

Every card with domain behavior tests outfit and setup. Use data-driven configuration, not separate
applications. Outfit size comes from explicit user input; setup dimensions/mounting come from user
input or product evidence. Do not infer sensitive/body traits or precise dimensions from an image.

### Real products and collections

Keep seller + product + variant identities distinct. No cross-currency sums. Unknown price is null,
not zero. Unknown hard constraints are not passes. The collection can be partial; it cannot silently
relax requirements, force multiple stores, or claim shipping/tax is included. Freshness matters.

### Actual intent and privacy

Images/model suggestions are not purchase evidence. Only explicit server-validated decisions can
support demand. Consent is separate, off by default and versioned. Withdrawal/re-consent does not
revive past observations; deletion invalidates derived snapshots and drafts. Session counts are
not verified-person counts. Keep live, seed and replay partitions separate at every stage.

Merchant prompts/DTOs contain aggregate facts and public product evidence only. No private images,
free text, session IDs, event IDs or per-user drilldown. Publish only thresholded/coarsened eligible
cohorts; a newcomer is inferred supply fit until actual eligible pair selections exist.

### Model output and claims

Use nullable required fields in internal strict LLM schemas. Handle refusal, incomplete output,
invalid JSON, timeout and cancellation separately. At most the card's bounded repair budget; it
shares the run's hard deadline. Keep prompts/error content out of logs when they may contain private
data. Evidence is untrusted data. Citation presence is necessary but not semantic support.

## 6. Tests that prove the feature

| Work | Required failure cases |
| --- | --- |
| Intake | invalid/oversized image, wrong owner, expiry, correction, no auto-confirm |
| Matching | wrong size/dimensions, unknown eligibility, missing slot, mixed currency, impossible budget, duplicate variants |
| Runs | cancellation cleanup, provider timeout, stale result after revision change, replay provenance |
| Decisions | forged/unshown offer, duplicate request, wrong session, stale revision, reject-after-accept |
| Demand | declined/withdrawn/regranted consent, repeated sessions, stale revision, small cells, fixed-window expiry, seed/replay exclusion |
| Merchant | inferred newcomer support, private-field rejection, invalidated aggregate, unsupported quantity/citation |

Use fake clocks and injected clients. No live API calls in any test, script or quick check. Do not
copy old `--live` benchmark invocations. A missing provider recording is a human spike requirement;
continue independent fake-backed work and state the limitation.

Run targeted tests, `pnpm typecheck`, `pnpm fixtures:check` when contracts/data changed, then relevant
integration tests. Run `pnpm format` and `pnpm format:check` before every commit. Full integration
uses `pnpm test`; frontend changes also use `pnpm --filter @sei/web build` when appropriate.

Feature milestone gate (replace the filename with the implemented milestone):

```text
pnpm exec vitest run --project milestones --passWithNoTests=false evals/milestones/s2.test.ts
```

The root `milestone:check` has `--passWithNoTests`; an empty green result is not acceptance.
S0 uses `evals/milestones/bootstrap.test.ts`. Never relabel it as S2 or S4.

## 7. Reuse without importing old assumptions

Read old code using `git show <pinned-sha>:<path>`; port a small helper and its useful tests into
the current card's paths. No blanket merge/cherry-pick of old package files, Express app, SQLite
schema, report contracts, giant React entrypoint, hardcoded category scores or synthetic data.

For each port record: source commit/path/function, target path, retained behavior, changed
assumptions, added regressions, and remaining human check. Verify against current SDK/Zod v4 types.
Tests that merely assert old fixtures reproduce old answers do not validate the new shopper loop.

## 8. Four-lane handoffs

L1 supplies offer/evidence fixtures and product/media components. L2 supplies match/aggregate facts.
L3 supplies brief/collection UX, model adapters and orchestration. L4 supplies owner/session APIs,
composition root and merchant UX. Use the exact path ownership in team split and CODEOWNERS.

If blocked on another lane, publish a typed fake and failure fixture, continue independent work,
and identify the missing export. Do not edit their file or circumvent a package boundary.
Never publish raw test-user images or live secrets as a handoff artifact.

## 9. Completion and continuation

Use this handoff format:

```text
Card / branch / base SHA:
Implemented behavior (outfit and setup):
Changed paths and public exports:
Fixtures used/added and whether synthetic or recorded:
Commands + actual exit/output:
Known limitations / still mocked:
Human check still required:
Next integration step / dependency:
Suggested assist-log row:
```

Mark a card implementation complete only when its checks pass. Mark a product milestone complete
only after its integration and separate human checks. If the user requests commit/push, use the
card-prefixed message, inspect staged paths for secrets/dependencies, and push only the assigned
branch. Otherwise provide the reviewable changes without inventing permission to publish.

On context restart/compaction, reread this handoff, the current user request, and git status. Keep
completed work and pending approvals distinct. A permission/tool failure is not a passed check.
