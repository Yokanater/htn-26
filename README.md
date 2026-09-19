# Shopify Intent Studio

A shopper brings an inspiration image, or a text description, of an outfit or a room/desk setup.
They confirm the items they want, and the app finds a collection of real products across Shopify
stores. If shoppers opt in, their confirmed choices become aggregate demand evidence that helps
merchants, including ones who join later, find useful collaborations.

Both launch domains, **outfits** and **room/desk setups**, have equal support throughout.

> **Status:** early build. Text or image intake, brief confirmation and offline collection matching
> work end to end in both domains (S1 and S2, enabled with `MILESTONES=s1,s2`). The demand ledger
> and merchant features are not built yet, and all providers default to fakes. See
> [bootstrap status](docs/BOOTSTRAP_STATUS.md) for what is real and what is still synthetic.

## How it works

```text
image/text -> private upload -> vision draft -> shopper-confirmed brief
  -> catalog search -> product verification -> collection selection
  -> explicit shopper decisions -> consent-aware event ledger
  -> aggregate cohorts -> merchant catalog mapping -> collaboration proposal
```

Some product rules apply at every stage:
- Nothing is searched until the shopper confirms the brief.
- Sizes and dimensions come from the shopper, never from the photo.
- Consent is separate from matching and off by default.
- Merchants see only thresholded aggregates, never individual shoppers.

## Getting started

Requirements: Node 24 (`.nvmrc`) and pnpm 12 (`corepack enable`).

```sh
pnpm install
cp .env.example .env      # fake providers by default; never commit .env
pnpm dev                  # server on :8787, web on :5173 (proxies /api)
```

| Command | Purpose |
| --- | --- |
| `pnpm test` | All Vitest projects (node, milestones, web) |
| `pnpm vitest run <path>` | One test file or folder |
| `pnpm typecheck` | `tsc --noEmit` in every workspace package |
| `pnpm fixtures:check` | Validate `fixtures/**/*.json` against `@sei/contracts` |
| `pnpm format` / `pnpm format:check` | Biome format and lint (CI runs `format:check`) |

Tests never call live providers such as OpenAI, Browserbase or Shopify. Only humans run live smoke
checks.

## Repository layout

| Path | Contents |
| --- | --- |
| `apps/server` | Hono API: sessions, uploads, consent, composition root |
| `apps/web` | React/Vite shopper and merchant surfaces |
| `packages/contracts` | Browser-safe Zod schemas and DTOs |
| `packages/core` | Shared interfaces, domain configuration, milestone flags |
| `packages/collect` | Catalog search and product evidence |
| `packages/enrich` | Attribute normalization, collection optimization, demand aggregates |
| `packages/reason` | Intent interpretation ([intent README](packages/reason/src/intent/README.md)), explanations, proposals |
| `packages/pipeline` | Staged shopper/merchant runs with fake and replay runners |
| `fixtures/seed` | Synthetic outfit and setup data (never real demand) |
| `evals/milestones` | Milestone acceptance suites |

Packages import only what their `package.json` declares. See [AGENTS.md](AGENTS.md) for the rules
on package boundaries.

## Contributing

Work is split into four lanes and delivered through milestone cards S1–S5.

1. Read [AGENTS.md](AGENTS.md) and the [implementation playbook](docs/AGENT_IMPLEMENTATION_GUIDE.md).
2. Pick up a card from the [milestones](docs/milestones/README.md) and read the
   [design](docs/SHOPIFY_ECOSYSTEM_INTELLIGENCE_DESIGN.md) sections it cites.
3. Work in your own worktree, edit only your card's paths, and prefix commits with the card ID,
   for example `S1-L3-1: ...`.
4. Before handing off, run the card's Accept commands, `pnpm typecheck` and `pnpm format`.

Lane ownership is in the [team split](docs/TEAM_WORK_SPLIT.md) and [CODEOWNERS](CODEOWNERS).
Dependency manifests change only in a separate PR made by a human.
