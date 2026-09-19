# M5: Shopify Write-back

| Field | Value |
| --- | --- |
| Requires | M4 green **and** the write-back spike (§4) passed |
| Preset | `MILESTONES=m1,m4,m5` (plus any others that are green) |
| Target green | Sun 03:45; **go/no-go at 02:30** (README §7) |
| Strengthens | Shopify (strongest "wait, that's possible?"), Rox (a real action with human approval) |
| Card format / agent loop | [README §4](./README.md#4-working-with-agents) |

## 1. The product

> **"It doesn't just recommend the collab. It builds the bundle in your store, as a draft."**

The merchant's store is **connected** through the Shopify Admin API (for the hackathon, a development store we own, credentials on the server). The flow:
1. Run the analysis on the connected store. Its profile comes from the Admin API, which works even though development storefronts are password-protected.
2. Design a bundle (M4) and approve it.
3. Click **Create draft in Shopify**. A **draft** product appears in the store's admin with the bundle title, description, price, tags, and the merchant's product image, and the partner product is named and linked in the description.
4. **Open in Shopify admin** jumps straight to it.

Guardrails: **draft only**, allowlisted shops only, it never modifies or deletes existing products, running it twice doesn't duplicate, and every write is recorded in an audit trail.

With M5's flag off, or no store connected, the product is exactly M4.

## 2. What M5 adds

| Area | Addition |
| --- | --- |
| Profile | Admin-API profiler path when the input URL matches the connected shop |
| Actions | `shopify_admin` `ActionProvider` with preflight, idempotency, dry-run, and audit |
| UI | Connected-store badge; "Create draft in Shopify" on approved bundles; success card with admin link; audit list |

## 3. Contract changes (additive; bump `SCHEMA_VERSION` minor)

```ts
// contracts/src/collect.ts (L1)
//   ShopifySignal.name gains 'admin_api';  Capture.method gains 'admin_api'

// contracts/src/profile.ts (L3)
interface StoreProfile { /* existing */ source?: 'public_storefront' | 'admin_api' }

// contracts/src/report.ts (L3)
interface ShopifyDraftResult {
  shopDomain: string; productGid: string; variantGid: string;
  adminUrl: string; status: 'DRAFT'; createdAt: string; dryRun: boolean;
}
interface ActionResult { /* existing */ data?: ShopifyDraftResult }

// contracts/src/api.ts (L4)
interface ConnectedStoreDTO { shopDomain: string; scopes: string[]; writeEnabled: boolean }   // never includes the token
```

**M5-C0 · Contract PR (L3, 15 min, after the spike, before all other M5 cards):** every addition above in one PR (`collect.ts` acked by L1, `api.ts` acked by L4). Types only. As in M4, L3's provider receives `preflightWriteBack` (L2) and `createDraftBundleProduct` (L1) as injected dependencies, wired in L4's composition root.

**Config (server only):**
- `SHOPIFY_ADMIN_SHOP` (`<name>.myshopify.com`), `SHOPIFY_ADMIN_TOKEN`, and `SHOPIFY_ADMIN_API_VERSION` (pinned in the spike)
- `SHOPIFY_WRITE_ALLOWLIST` (comma-separated shop domains)
- `SHOPIFY_WRITEBACK_DRY_RUN` (default `false`; `true` in tests and rehearsals)
- `SHOPIFY_WRITEBACK_INCLUDE_PARTNER_MEDIA` (default `false`: the partner's photos stay out of the merchant's store unless the partner agreed)

## 4. Write-back spike (human-only, L1 + L4, ~45 min, before any M5 card)

1. Create a **development store** (Dev Dashboard / Partner organization). Name it after the seed merchant, e.g. `northbound-dev`.
2. Import products. An agent can generate `fixtures/shopify/northbound-products.csv` from the seed world (10 coffee products with images).
3. Create an app with **Admin API access** to that store, using whichever app type Shopify currently supports for this. Grant the scopes `read_products` and `write_products`, then obtain an Admin API access token.
4. Pin `SHOPIFY_ADMIN_API_VERSION` to the current stable version. In GraphiQL or with `curl`, run:
   - `productCreate(product: { title, descriptionHtml, vendor, productType, status: DRAFT, tags }, media: [{ originalSource, mediaContentType: IMAGE, alt }])`
   - `productVariantsBulkUpdate` on the implicitly created default variant to set `price`.

   Save both responses to `fixtures/spikes/shopify-admin/`.
5. Confirm the draft shows up in admin, then delete it by hand.

**No-go** if any step fails by 02:45. In that case, skip M5 and pick improvement slots.

---

## 5. Work split

| Lane | Cards | Human-only |
| --- | --- | --- |
| **L1** | M5-L1-1, M5-L1-2 | Spike (with L4); keep the token out of chat and logs |
| **L2** | M5-L2-1 | Pick improvement slots with the remaining time |
| **L3** | M5-L3-1 | Review the audit trail and idempotency on the real store |
| **L4** | M5-L4-1 | Spike (with L1); record the demo (app tab + Shopify admin tab) |

### Lane 1: Collection

#### M5-L1-1 · Admin client and Admin-API profiler
- **Brief:**
  - `ShopifyAdminClient`: GraphQL `POST https://{shop}/admin/api/{version}/graphql.json` with `X-Shopify-Access-Token`. Handles `userErrors`; throttles on `extensions.cost.throttleStatus` (wait and retry once); request-ID logging; the token is never logged.
  - Read methods: `readShop()` (name, primary domain, currency, `myshopifyDomain`), `listProducts(first: 50)` (title, handle, productType, vendor, tags, featured image, variants price, status), `listCollections(first: 20)`.
  - `collectStoreSignalsFromAdmin(ctx)` → `RawStoreSignals` with signal `admin_api` (confidence 1.0) and first-party evidence (`Capture.method: 'admin_api'`).
  - The profile path picks Admin when the input URL's registrable domain equals the connected shop's primary or `myshopify` domain.
- **Edit:** `packages/collect/src/shopify/admin/**`, `packages/collect/src/shopify/profile-router.ts`, `packages/collect/test/admin.test.ts`
- **Read only:** `fixtures/spikes/shopify-admin/**`
- **Accept:** tests against recorded responses (including a throttled response and a `userErrors` response). Live: `pnpm collect:profile https://<dev-store-domain> --out .data/dev/northbound-dev` uses the Admin path and writes a valid `raw-signals.json`.

#### M5-L1-2 · Create draft bundle product
- **After:** M5-L1-1
- **Brief:** `createDraftBundleProduct(proposal, opts, ctx): ShopifyDraftResult`.
  1. **Idempotency first:** query `products(first: 1, query: "tag:'sei-proposal:<proposal.id>'")`. If found, return it.
  2. `productCreate`:
     - `title = copy.title`
     - `descriptionHtml` = sanitized description + bullets + "Includes: <merchant product> and <partner product> (<partner domain>)"
     - `vendor` = merchant brand; `productType: 'Bundle'`; `status: DRAFT`
     - `tags: ['sei-collab-draft', 'sei-proposal:<id>', 'partner:<domain>']`
     - `media`: the merchant's product image, plus the partner's only if `INCLUDE_PARTNER_MEDIA`
  3. `productVariantsBulkUpdate`: set the default variant's price to `bundlePrice`.
  4. Return the GIDs and `adminUrl`.

  **Only** these mutations are allowed; the client exposes no update or delete of other products. `dryRun` returns the exact payloads without calling Shopify.
- **Edit:** `packages/collect/src/shopify/admin/create-draft.ts`, `packages/collect/test/create-draft.test.ts`
- **Accept:** a dry-run test snapshots the payloads (status `DRAFT`, price `100.99` for the seed bundle, tags). An idempotency test with a mocked client returns the existing product on the second call. A sanitizer test strips `<script>` and `on*` attributes.

### Lane 2: Intelligence

#### M5-L2-1 · Write-back preflight
- **Brief:** `preflightWriteBack(proposal, shop): { ok: boolean; issues: Array<{ code: string; message: string }> }`. Checks:
  - the proposal is approved and has `bundlePrice`
  - bundle currency = shop currency
  - both products `available !== false`
  - title length (1–255 characters), description ≤ 5,000 characters
  - image URL is https on an allowlisted CDN (`cdn.shopify.com`, the shop's own domain)
  - shop in `SHOPIFY_WRITE_ALLOWLIST`

  A pure function with no network calls.
- **Edit:** `packages/enrich/src/bundle-studio/preflight.ts`, `packages/enrich/test/preflight.test.ts`
- **Accept:** a table test covering every issue code; the seed approved bundle passes.

### Lane 3: Reasoning & Pipeline

#### M5-L3-1 · `shopify_admin` ActionProvider
- **Brief:** register `shopify_admin` in the action-provider registry (M4) when `FEATURE_SHOPIFY_WRITEBACK` is on **and** a store is connected. `execute(draft, approval)`:
  1. require `status: 'approved'` and `bundleProposalId`
  2. load the proposal
  3. `preflightWriteBack` (L2); on failure, return `ActionResult { ok: false, message }` with the issues
  4. `createDraftBundleProduct` (L1), honoring `SHOPIFY_WRITEBACK_DRY_RUN`
  5. persist `ActionResult.data` and append an audit entry `{ at, approvedBy, shopDomain, productGid, dryRun }` to `actions/<id>.json`
  6. set the draft `status: 'executed'`

  Until L1 and L2 merge, use injected fakes.
- **Edit:** `packages/reason/src/actions/providers/shopify-admin.ts`, `packages/reason/test/shopify-admin-provider.test.ts`
- **Accept:** tests with fakes: an unapproved draft is rejected; a preflight failure writes nothing; a second execute returns the same `productGid`; the audit entry is written.

### Lane 4: Product & Platform

#### M5-L4-1 · Connected-store UI, execute route, M5 check
- **Brief:**
  - `GET /api/shopify/connection` → `ConnectedStoreDTO` (from server env; `writeEnabled` = flag on + shop allowlisted).
  - `POST /api/runs/:id/actions/:actionId/execute {provider}`, registered only under `FEATURE_SHOPIFY_WRITEBACK`.
  - UI:
    - a header badge "Connected: <shop>"
    - on an approved bundle, a provider list with **Create draft in Shopify** (a confirm dialog restates: draft only, no publishing)
    - progress, then a success card with **Open in Shopify admin**
    - preflight issues rendered as a checklist
    - an audit list in the studio side panel
  - `evals/milestones/m5.test.ts`: fully faked seed run with `MILESTONES=m1,m4,m5` and `SHOPIFY_WRITEBACK_DRY_RUN=true` → create the bundle → approve → execute → assert the payload and that the audit is present. With `MILESTONES=m1,m4` → the route is 404 and the button is absent.
- **Edit:** `apps/server/src/routes/shopify.ts`, `apps/web/src/features/studio/shopify/**`, `apps/web/src/components/header/connected-store.tsx`, `evals/milestones/m5.test.ts`
- **Accept:** `pnpm milestone:check m5` is green; earlier checks are still green; the token never appears in any API response (asserted).

---

## 6. Integration
1. `SHOPIFY_WRITEBACK_DRY_RUN=true` end to end on the dev store (profile via Admin → run → bundle → approve → execute). Inspect the payload in the success card.
2. Flip dry-run off → execute once → confirm the draft in admin → execute again → no duplicate.
3. Record the demo: app tab and Shopify admin tab side by side.

## 7. Exit checklist: M5 is a complete product when
- [ ] `pnpm milestone:check m5` is green; earlier checks are still green.
- [ ] Live: an approved bundle creates **one** draft product in the dev store with title, description, price, tags, and image; re-execute is idempotent.
- [ ] The token never leaves the server (API responses, logs, Sentry); non-allowlisted shops are refused.
- [ ] Flag off or no connection → no badge, button, or route.
- [ ] Deployed with the new preset; tag `m5-green`.

## 8. Demo if we stop here (90 s)
M1 and M4 beats (compressed to 50 s) on the connected dev store, then:
1. "Approve" → **Create draft in Shopify** → the success card. (15 s)
2. Switch to the Shopify admin tab: the bundle draft is there (on the seed: the **Brew Starter Kit** at $100.99), priced and tagged as a collab draft. (15 s)
3. "It's a draft: nothing goes live until the merchant, and the partner, say yes." (10 s)

## 9. Improvement slots that fit M5
IS-SENTRY (trace the write path), IS-COMPOSIO (email the partner draft in the same approval step).

## 10. Risks and fallbacks

| Risk | Fallback |
| --- | --- |
| App or token setup blocked by current Shopify app rules | No-go at 02:45; the demo stays at M4 |
| `productCreate` or variant API shapes changed | The spike records the real shapes; the cards code against `fixtures/spikes/shopify-admin/` |
| Partner image licensing | Default excludes partner media; the description links the partner product instead |
| Live write fails during the demo | Show the dry-run payload and the pre-recorded admin screenshot or video |

## 11. Hooks this milestone leaves for later
- The **Admin client** is the base for the roadmap's embedded Shopify app (design §20): OAuth install instead of an env token, and sales data for the merchant's own SWOT.
- **Action audit trail + idempotency** generalize to any future write provider (Shopify Collabs, email send with approval).
