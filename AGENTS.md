# AGENTS.md

**Shopify Intent Studio** (`@sei/*`): shoppers upload outfit or room/setup inspiration, confirm
their requirements, and match real products across Shopify stores. With explicit consent, their
choices produce aggregate demand evidence for current and newly arriving merchants' collaboration
proposals. Both domains are equally required. Specs: [design v3](docs/SHOPIFY_ECOSYSTEM_INTELLIGENCE_DESIGN.md),
[team split](docs/TEAM_WORK_SPLIT.md), [active S1–S5 cards](docs/milestones/README.md).
Archived M1–M5 cards are historical only. Read your card's cited design sections before coding.

## Commands (run from the repo root)

| Command | What it does |
| --- | --- |
| `pnpm install` | Install (humans only change deps; see Rules) |
| `pnpm typecheck` | `tsc --noEmit` in every workspace package |
| `pnpm test` | All tests: `node`, `milestones`, `web` (jsdom) Vitest projects |
| `pnpm vitest run <path>` | One test file, e.g. `pnpm vitest run packages/collect/test/policy.test.ts` |
| `pnpm fixtures:check` | Validate every `fixtures/**/*.json` against `@sei/contracts` |
| `pnpm milestone:check <m>` | Milestone check, active suites `evals/milestones/s<N>.test.ts`; see non-vacuous gate below |
| `pnpm format` | Biome: format, organize imports, safe lint fixes. **Run before every commit** |
| `pnpm format:check` | What CI runs (format + lint) |
| `pnpm dev` | Server on `PORT` (8787) + web on `WEB_PORT` (5173, proxies `/api`). Humans only |

CI (`.github/workflows/ci.yml`) runs `install --frozen-lockfile`, `typecheck`, `test`, `format:check`.

## Rules

- **Edit only the paths listed on your card** (its `Edit:` line). Anything else is read-only.
  The user-authorized REVAMP-0 docs/bootstrap migration is scoped in `docs/BOOTSTRAP_STATUS.md`.
- **Never make live API calls.** No Browserbase, OpenAI, Baseten, Shopify, Sentry, or GPTZero calls
  from tests, scripts, or "quick checks". Tests use fakes plus recorded responses in
  `fixtures/spikes/`. Only humans run live smoke commands: Browserbase session limits and API
  quotas are shared by the whole team.
- **Never edit `package.json`, `pnpm-lock.yaml`, or `pnpm-workspace.yaml`.** Every known dependency
  is pre-installed. Need another one? Stop and ask your human; they add it in a separate PR to main.
- **Contracts change only additively after M0** (new optional field or ignorable enum value), with
  the seed fixture updated in the same commit. Never rename, remove, or retype (split §11.3).
- **LLM output schemas use `.nullable()`, never `.optional()`** (OpenAI strict Structured Outputs).
  They are internal to `packages/reason` / `packages/enrich`; mappers convert them to contracts.
- **No fixed ports in tests.** Test HTTP with `createApp().request('/path')` (Hono) or listen on
  port `0`. Never start `pnpm dev` from a test.
- **Never commit secrets, `.env`, or `.data/`.** Only `.env.example` is committed.
- **Commit messages start with the card ID**: `M1-L1-3: storefront profiler`.
- New behavior sits behind its milestone's flag (`featureFlags(env)` from `@sei/core`).
- **Before saying "done"**, run your card's Accept commands plus `pnpm typecheck` and paste the
  output.

**Definition of done:** Accept passes · `pnpm typecheck` passes · `git diff --stat main` touches
only your card's Edit paths · new behavior is behind the milestone's flag · `pnpm format` was run.

## Lane ownership (team split §2, CODEOWNERS)

| Lane | Owns |
| --- | --- |
| L1 Catalog & Evidence | `packages/collect/`; web `features/shopper/media/` and `products/` |
| L2 Matching & Demand | `packages/enrich/`, `packages/db/`, `ml/` |
| L3 Intent & Experience | `packages/reason/`, `packages/pipeline/`; web `features/shopper/brief/` and `collection/`; `docs/CODEX_LOG.md` |
| L4 Platform & Merchant | remaining `apps/`, `packages/telemetry/`, root config, `evals/` |
| Shared | `packages/contracts/`, `packages/core/`, `fixtures/seed/`; one editor per file as named in its header |

Merchant DTOs never expose raw shopper uploads, text, session IDs or event records. Consent is
separate from matching. Model suggestions, seeds and replay never count as live observed demand.
All milestones require both outfit and setup cases. Presets/tests are not implementation evidence.

## Package boundaries (enforced)

Packages may import only the workspace packages declared in their `package.json`. pnpm's strict
`node_modules` makes anything else fail to resolve in `tsc`, Vitest, tsx, and Vite.

| Package | May import |
| --- | --- |
| `@sei/contracts` | (no workspace packages) |
| `@sei/core` | contracts |
| `@sei/collect`, `@sei/enrich`, `@sei/reason`, `@sei/db` | contracts, core |
| `@sei/telemetry` | core |
| `@sei/pipeline` | contracts, core, collect, enrich, reason |
| `@sei/server` (apps/server) | contracts, core, pipeline, collect, enrich, reason, db, telemetry |
| `@sei/web` (apps/web) | contracts |
| `@sei/evals` (evals/) | everything above except web |

- `reason` never imports `enrich` or `collect` (nor the reverse). Cross-lane calls such as
  `selectBundle` or `createDraftBundleProduct` are passed in through `@sei/core` interfaces and
  wired by `pipeline` or the server's composition root.
- Always import by package name (`import { newId } from '@sei/contracts'`), **never** by relative
  path into another package (`../../core/src/...`); that bypasses the boundary check.
- No build step: each package exports `./src/index.ts`. Add new public API to `src/index.ts`.
- `@sei/contracts` must stay browser-safe (the web app imports it): no `node:*` imports.

## Where things are

- `@sei/contracts`: Zod schemas + inferred types (`FooSchema` + `type Foo`). `common.ts` has
  `SCHEMA_VERSION`, `ID_PREFIXES`, `newId(prefix)`, `idSchema(prefix)`, `MoneySchema`,
  `SourceTypeSchema`. (Design §4 says `newId` comes from core; it lives in contracts.)
- `@sei/core`: interfaces (design §3.5, §4.7) and `milestones.ts`: `MILESTONE_PRESETS`,
  `resolveMilestones(env.MILESTONES)` → `{ milestones, sections, flags }`, `featureFlags(env)`.
- Fixture validation registry: `packages/contracts/test/fixtures.test.ts` (`SCHEMAS` map; register
  your file names there when your schema lands).
- Tests: `<package>/test/*.test.ts` (web: `apps/web/**/*.test.tsx`). Import `describe/it/expect`
  from `vitest` (no globals).

## Toolchain decisions

- Node 24 (`.nvmrc`), engines `>=22`, pnpm 12 (`packageManager`), ESM everywhere, TypeScript 7.
  Shared versions come from the `catalog:` in `pnpm-workspace.yaml`.
- TS config (`tsconfig.base.json`): strict, `moduleResolution: bundler`, `verbatimModuleSyntax`
  (write `import type` for type-only imports), `types: ["node"]`. Extensionless relative imports.
- **Zod decision: `zod@4.4.3`, one copy repo-wide.** `@browserbasehq/stagehand@4.1.0` depends on
  exactly `zod@4.4.3`; `openai@7` accepts `zod ^3.25 || ^4`. Pinning the catalog to 4.4.3 makes
  pnpm dedupe to a single instance, so schemas passed to Stagehand `extract()` and to openai's
  `zodTextFormat` come from the same zod. Import `{ z } from 'zod'` (v4 API; not `zod/v3`).
  Guarded by `packages/reason/test/zod-compat.test.ts`. Don't bump zod without bumping Stagehand.
- Dependencies newer than one day are avoided (pnpm's default `minimumReleaseAge`).

## Ports and env

- Server: `PORT` (default 8787). Web dev: `WEB_PORT` (default 5173), proxies `/api` →
  `http://localhost:${PORT}`. Health: `GET /healthz` and `GET /api/healthz` → `{ ok: true }`.
- Env lives in the repo-root `.env` (copy `.env.example`). `MILESTONES=s1,s2` picks a preset;
  `FEATURE_X=true|false` overrides it; empty follows the preset.
- Running several worktrees? Give each its own `PORT` / `WEB_PORT`.

## Windows notes

- Scripts are `tsx` or Node, never bash; don't add shell-specific npm scripts.
- Use forward slashes in imports, globs, and paths you write in code or docs.
- LF line endings everywhere (`.gitattributes`, `.editorconfig`). Set once per clone:
  `git config core.autocrlf false`.

## Working loop (milestones README §4.2)

One git worktree per running agent: `git worktree add ../htn-<card-id> -b <lane>/<card-id>`.
Log meaningful Codex assists in `docs/CODEX_LOG.md` (`| Time | Lane | Card | What Codex did |
Outcome |`).

## Active milestone acceptance

The root milestone script allows no tests. Until a human changes that script, use
`pnpm exec vitest run --project milestones --passWithNoTests=false evals/milestones/s<N>.test.ts`
for a feature milestone. Bootstrap uses `evals/milestones/bootstrap.test.ts` and does not claim S1–S5.
Legacy m-presets retain their old meaning; never mix them with s-presets. No private `.env` is edited.
