# Shopify Intent Studio — Design v3

Status: implementation plan, 2026-09-19. Replaces the merchant-report-first v2 plan.
Package names remain `@sei/*`; this is a product change, not a dependency migration.
Authoritative delivery order: [milestones](milestones/README.md). Ownership: [team split](TEAM_WORK_SPLIT.md).
The earlier design and cards are retained under `docs/archive/v2/` for reference only.

## 1. Product and thesis

**A shopper brings an inspiration image; the system finds a collection across Shopify stores.
With permission, confirmed shopper choices become aggregate evidence for useful collaborations
between those stores—including merchants who join later.**

The shopper gets value immediately, without waiting for a marketplace to acquire merchants.
The merchant gets a proposal grounded in observed requests, not an LLM's imagined audience overlap.
The two-sided connection is the differentiator; image search alone is not claimed to be novel.

Two equally supported launch domains: **outfits** and **room/desk setups**. Both have intake,
editable intent, real product matching, feedback, aggregate demand, merchant opportunities,
seed fixtures, adversarial cases, live human checks, and equal demo coverage. No domain is a
placeholder or stretch goal. Arbitrary new domains remain an extension point, not a launch promise.

Shopper pitch: “Turn this inspiration into a collection that fits your constraints.”
Merchant pitch: “See what opted-in shoppers want together, where matches fail, and who could help.”

### What we are validating

1. People can express useful multi-item intent with an image plus a few corrections.
2. Confirmed collections can be matched better than independent generic product searches.
3. Aggregated explicit choices reveal actionable partner opportunities or supply gaps.
4. A merchant finds the evidence specific enough to try a small collaboration experiment.

These are hypotheses. A hackathon cohort is not representative market research. No claims of
revenue lift, purchases, actual shared customers, partnership willingness, or causal demand.

## 2. Journeys and scope

### Shopper

1. Choose Outfit or Room/setup; upload one image or describe the collection in text.
2. Review 2–6 proposed item slots. Remove things already owned, edit descriptions, mark required
   versus optional, and confirm what matters: colors, silhouette/style, materials, function.
3. Enter destination country, currency, optional item-subtotal budget, and domain constraints.
   Outfit: explicit size per relevant slot, fit preference, occasion, material exclusions.
   Room: explicit dimensions per relevant slot, mounting restrictions, function, material exclusions.
   Never infer body size, exact room dimensions, identity, income, or material composition from pixels.
4. Confirm the brief. Search begins only after this step; changing it creates a new revision.
5. Receive up to three collections, with a candidate and alternatives for each required slot,
   real variant prices and product links, match explanations, evidence, and unresolved constraints.
6. Accept/replace/reject items, save the selection, or explicitly request an offer. An outbound
   click is a click, never a purchase. Checkout happens independently at each store.
7. Optional separate consent: contribute structured preferences and selections to aggregate
   merchant insights. Off by default. Declining does not degrade matching. Withdrawal is supported.

### Merchant, current or newly arriving

1. Enter a Shopify store URL; confirm a catalog/profile derived from public product evidence.
2. Match that catalog to already existing, consented category/constraint cohorts.
3. See opportunities with period, domain, country, denominator, unique-session counts, missing
   requirements, product proof, and a clear split between observed support and inferred supply fit.
4. Compare a proposed partner and products against a specific cohort; inspect both sides' benefit
   hypotheses, operational unknowns, and supporting product evidence.
5. Create an editable collaboration brief and outreach draft. Merchant-set costs/terms are optional;
   if absent, no profit or feasible-discount claim. Optional final milestone saves a draft concept
   to an owned Shopify development store, never a fulfilled cross-store bundle.

### Explicit cuts

No universal checkout, payments, automatic outreach, negotiation agents, recommender training,
virtual try-on, exact SKU identification from arbitrary photos, 3D room reconstruction, public
shopper images, market-size estimates, full competitor/SWOT report, sentiment scraping, custom
model deployment, new database requirement, or sponsor integrations unrelated to the journey.
Store collaborations still need real agreement and fulfillment arrangements outside the prototype.

## 3. Architecture and provider choices

Keep Node/TypeScript, pnpm workspaces, Hono, React/Vite, Zod, Vitest, and the installed dependencies.
One server, file-backed stores, bounded provider concurrency, SSE, fake/replay adapters. No new
service is required. Postgres remains a later alternative behind the store interfaces.

```text
Shopper image/text -> private upload -> vision draft -> shopper-confirmed brief
    -> catalog discovery -> product verification -> constrained collection selection
    -> explicit shopper decisions -> consent-aware private event ledger
    -> fixed aggregate cohorts -> merchant catalog mapping -> collaboration proposal

New merchant URL -----------------------> same aggregate cohorts (no historical support invented)
```

| Package | Responsibility |
| --- | --- |
| contracts | Browser-safe domain schemas and DTOs |
| core | Provider/store interfaces, budgets, category configuration, milestone flags |
| collect | Catalog search, seller/variant identity, public product evidence and merchant profiling |
| enrich | Product attribute normalization, collection optimization, deterministic demand aggregates |
| reason | Vision brief, query planning, evidence-bounded match/proposal explanations |
| pipeline | Versioned shopper and merchant stages, checkpoints, cancellation, fake/replay runners |
| db | Reserved alternative store implementation; not on the launch critical path |
| server | Owner sessions, private uploads, APIs, consent/event validation, composition root |
| web | Shopper and merchant surfaces, partitioned between lanes (team split §2) |

Sibling packages communicate through core interfaces injected by pipeline/server. No new imports
across forbidden boundaries. Shopify variant seller identity, not shared product title or universal
product grouping, identifies the merchant. Product ID and variant ID are opaque strings, not assumed
to be interchangeable Admin API IDs.

### Provider capability findings (documentation checked 2026-09-19)

### Merchant provider workflow (S4 continuation)

Browserbase and Baseten are first-class stages of merchant onboarding, not optional logos.
`MERCHANT_PROVIDER=browserbase_baseten` uses the installed Stagehand v4 browser driver with
Browserbase, then Baseten Model APIs for batched public product-copy extraction. The driver
does not invoke a second model. Browserbase opens the public collection with a domain policy,
finds up to eight product pages and exposes a private read-only live view. The server verifies
up to four variants per product against storefront JSON before normalization. Baseten classifies
categories and extracts material/function facts with verbatim quotes; unsupported references or
quotes are rejected. Categories remain interpretations that the merchant must review and confirm.
Unknown shipping, dimensions and price remain unknown. No scraper/model output counts as demand.

The workspace polls an owner-bound run resource for actual timestamped stages and verified variant
counts. It supports cancellation, retry, page evidence inspection and read-only Browserbase viewing;
there are no simulated completion percentages. Two scans can run globally, one per owner, with a
three-minute hard deadline and browser cleanup. Provider failure never switches a live run to seed.
An extraction outage retains independently verified records with a visible warning.

Baseten also chooses a falsifiable collaboration experiment from a bounded set, using only safe
aggregate facts and public citation IDs. Deterministic rendering supplies every numeric claim and
the immutable evidence summary. Merchant-authored outreach edits are explicitly unverified.
Snapshot invalidation, catalog changes and product freshness are rechecked when drafting, saving,
reopening and exporting. No outreach is automatically sent and no Shopify Admin write occurs.

`MERCHANT_PROVIDER=fake` provides a separate labeled synthetic workflow. Live insights are restricted
to exact `MERCHANT_ALLOWED_DOMAINS` approved by the operator after verifying access. Partner catalogs
can be publicly profiled in the same private workspace; entering a URL never proves ownership.
Current single-process workspace state expires after one hour and is lost on restart, consistent
with the integrated in-memory S1–S3 stores. Downloaded drafts remain copies and cannot be remotely
revoked. Durable storage and formal merchant authentication remain deployment work.

Configuration, acceptance and human checks: [merchant implementation](MERCHANT_IMPLEMENTATION.md).

### Provider reference findings

- OpenAI Responses accepts image input; Structured Outputs supplies schema-constrained extraction.
  Use the installed SDK, a configured vision-capable model, and a narrow internal schema. Image
  interpretation can be wrong, so shopper confirmation is mandatory. See [vision](https://developers.openai.com/api/docs/guides/images-vision)
  and [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
- Shopify Global Catalog supports cross-store discovery through UCP MCP. Use textual queries
  derived from confirmed slots and supported catalog filters; do not assume reverse-image search.
  Map seller information at the variant level and verify response shapes in a human spike.
  See [catalog](https://shopify.dev/docs/agents/catalog) and [global extension](https://shopify.dev/docs/agents/catalog/global-catalog-extension).
- Browserbase Search locates public sources; Fetch handles static content, while browser sessions
  handle pages requiring JavaScript. Use the lightest verified route and capture relevant evidence;
  browsing is not added for visual spectacle. See [Search](https://docs.browserbase.com/platform/search/overview)
  and [Fetch](https://docs.browserbase.com/platform/fetch/overview).
- Baseten Model APIs provide compatible hosted inference without a custom deployment. Use a
  human-verified model for batched attribute normalization/reranking. Embeddings are optional;
  deterministic taxonomy grouping and text matching remain the fallback. See [Model APIs](https://docs.baseten.co/inference/model-apis/overview).
- Shopify Collective already offers supplier discovery and recommendations. Our hypothesis is
  the connection from explicit shopper intent and unmet requirements to collaboration proposals,
  not “Shopify stores can find suppliers.” See [Collective discovery](https://help.shopify.com/en/manual/online-sales-channels/shopify-collective/retailers/discovery).

Documentation confirms capabilities, not our account access, model quality, quotas, or latency.
Humans make all initial live provider calls, save redacted spikes, and select model IDs. Agents
implement against those recordings and installed types; no live API checks during coding.

## 4. Shared contracts and data ownership

The bootstrap adds these contracts in new files, preserving exported common primitives and legacy
milestone meanings. `SCHEMA_VERSION` advances additively to 1.1.0. Existing empty v2 placeholders
remain reserved; their comments must not instruct future agents to implement the obsolete plan.

| Contract | Owner | Required information |
| --- | --- | --- |
| InspirationAsset | L4 | opaque asset ID, MIME, bytes, expiry; private storage key stays server-side |
| IntentBrief / IntentSlot | L3 | outfit/setup, revision, draft/confirmed, 2–6 slots, attributes, constraints, country/currency, provenance |
| ProductOffer / ProductEvidence | L1 | canonical merchant domain, opaque product/variant IDs, price, availability, attributes, source URL/time |
| CollectionMatch / SlotMatch | L2 | brief/revision, selected offer IDs, alternatives, missing slots, known item subtotal, unresolved checks |
| ConsentRecord / DemandEvent | L4/L2 | server-bound session/brief/revision, version, explicit action, offered/selected IDs, sample origin, event ID/time |
| DemandAggregate | L2 | fixed cohort, period, denominator, consented-session support, suppression, gaps, aggregate version |
| MerchantOpportunity | L3 | store pair, aggregate references, observed or inferred basis, evidence IDs, caveats, proposed experiment |

`sampleOrigin` is `live`, `seed`, or `replay`; it is set by the server/runner, never trusted from
the browser. Seed and replay fixtures are not real demand. All amounts are integer minor units.
Unknown availability, shipping, dimensions, or size is explicit `unknown`/null—not false certainty.
Domain DTOs may use optional fields; strict LLM schemas use nullable required fields and map to DTOs.

Internal identities: server-issued opaque session IDs (not emails or browser-supplied identities).
Public merchant DTOs never include session IDs, brief IDs, event IDs, image IDs, raw text, or lists
of individual preferences. Product evidence is public; shopper contribution evidence is aggregated.
Every newly exported schema lands with positive and negative fixtures/tests and an owner comment.

## 5. Image understanding and matching

### 5.1 Input and confirmation

One JPEG/PNG/WebP, maximum 8 MiB; reject SVG, animated/unsupported formats and malformed images.
Client decodes and resizes to at most 1600 px long edge, re-encodes to discard metadata, then sends
multipart bytes. The server checks byte limit, MIME signature and dimensions before persistence;
do not trust the browser transformation. Validate the installed image decoder during S0; if none
is available, a human supplies a dependency before enabling uploads. Do not hand-roll a decoder.
Text intake and fixture image replay remain available independently.

Store normalized image privately, serve only to the owning session, and expire within 24 hours.
Send bytes/data URL to the vision provider from the server; no public bucket or arbitrary remote
image URL input. Instruct the model to ignore instructions embedded in the image or web content.
Model output: editable item descriptions, category, visual attributes, confidence, nullable approximate
regions. Cropping/boxes are optional aids, never prerequisites for a functioning flow.

Outfit size and room dimensions come from user input or sourced product data, not visual guesses.
No face or body profiling. A collection slot describes a wanted product, not a detected person.
The UI explains which features the shopper is confirming and supports adding a missed item.

### 5.2 Retrieval and verification

Per confirmed slot: two bounded text queries using item category + key visual/function terms.
Retrieve up to eight candidate offers per slot; normalize exact variant attributes and seller domain.
Deduplicate by merchant + product + variant. Shared catalog product groups do not merge sellers.
Fetch only missing facts that affect eligibility. Keep source time, quote/field, method and ID.
Search snippets alone cannot prove size, availability, material, shipping eligibility or price.

Hard constraints: explicit country eligibility, currency, availability, size/dimensions/material
requirements and budget. A known violation excludes an offer. An unknown hard requirement is
shown as “needs verification” and cannot produce a “ready” match. Do not silently relax constraints.
Outfits and setups use the same engine with different attribute keys and evaluators.

### 5.3 Collection assembly

Start with transparent relevance scoring (category/function, confirmed visual attributes, text
similarity); a small-model reranker may refine a bounded shortlist. Distinguish computed checks
from model judgments. Do not describe a score as a probability or promise an exact visual replica.

Enumerate a bounded beam (width 20) over at most six slots and eight candidates each; keep an
explicit missing-slot option so incomplete results can explain failure. Required-slot coverage and
constraint satisfaction precede style, then item subtotal and fewer merchants as tie-breakers.
Never force extra merchants into a collection to manufacture collaboration signals. Deterministic
ID tie-breaks keep replay stable. Unknown price is not zero. No mixed-currency arithmetic or invented
exchange rates. Subtotal excludes shipping/tax; final prices and fulfillment are each store's own.

Changing budget or a slot increments the brief revision, invalidates stale matches, and reruns only
dependent stages. Reject stale feedback with HTTP 409. Save selection only after explicit action.
Product facts must be refreshed before an outbound action when older than the configured TTL.

## 6. Demand ledger and aggregation

### 6.1 Events are observations, not inferred purchases

Persist private events for confirmed brief, accepted/rejected item, saved collection and requested
offer. Events contain the current revision, actual displayed match/offer references, explicit reason
codes (price, style, size, dimensions, material, shipping, availability, other) and server timestamp.
Idempotency key + session scope prevents replayed requests from adding support. Validate that an
offer was actually shown, belongs to the slot, and matches the revision; do not accept arbitrary
merchant IDs or user-supplied support counts. A model-impression event never counts as intent.

Consent is separate from functional session storage. Only contributions made after opt-in, while
consent remains granted, may enter aggregates. Withdrawal excludes the whole session immediately;
re-consent starts a new consent version and does not revive historical contributions. Deletion
removes assets, briefs, private events, and invalidates affected snapshots/opportunities. Block
reading stale snapshots until recomputed, rather than retaining withdrawn contributions for speed.

### 6.2 Fixed, inspectable cohorts

MVP cohort key: domain × destination country × currency × sorted confirmed category set, within
one fixed 30-day window. No inferred demographic segments. This conservative grouping is deliberate:
low volume returns insufficient evidence rather than manufacturing a broad trend. Subsequent
experiments may add a reviewed taxonomy mapping; do not silently combine unrelated categories.

Use latest valid confirmed revision and latest explicit selections per session. One session counts
at most once per cohort and once per merchant pair. Cookie/session deduplication is not verified
person identity; label counts “consented sessions,” not unique people. Demo testers and replay are
separate datasets. Session-level rate limits reduce abuse but are not Sybil resistance.

For a cohort report:

- Denominator: eligible consented live sessions with a confirmed brief in that cohort/window.
- Merchant support: distinct sessions explicitly selecting at least one offer from that merchant.
- Pair support: distinct sessions saving/requesting a collection containing both merchants.
- Gap count: sessions with an explicitly unmet confirmed requirement or an explicit rejection reason.
- Report support counts and denominators; no “conversion rate,” causal lift, inferred sales or
  popularity computed from model exposures. Product availability gaps and provider failures differ.

Threshold: `DEMAND_MIN_SESSIONS=5` for both the cohort and any published pair/gap breakdown. Suppress
small cells and complementary totals that would reveal them; no arbitrary filters, drilldown to
individuals, or before/after exact count deltas on a public dashboard. Fixed scheduled snapshots
(15 minutes) and coarse published counts reduce differencing; this is a prototype privacy boundary,
not a formal anonymity guarantee. Synthetic demos can show exact counts with a persistent label.

### 6.3 Existing and future merchants

An observed pair opportunity needs pair support above threshold. A new merchant may match the
category/constraint demand but has **zero observed pair support** unless actual selections exist.
Mark it `inferred_supply_fit`, cite the qualifying cohort and current product evidence, and state
that shoppers have not selected that pairing. Never transfer another store's support to a newcomer.

Store the structured intent independently of merchant enrollment. New catalog profiles can be
matched to existing aggregate cohorts without reusing raw uploads or contacting shoppers. This
supports future merchant queries and better candidate search; no model retraining is required.
Do not feed popularity back into shopper ranking in the MVP: that would amplify exposure bias.

## 7. Merchant reasoning and actions

Rank opportunities by verified constraint coverage, eligible cohort support, complementary slot
coverage, and explicit remaining uncertainties. Keep observed-pair support and inferred fit separate.
For each proposal show the need, each store's contributed items, evidence, unknown commercial terms,
and a cheap experiment (e.g. a co-curated collection landing page). Audience similarity is a hypothesis.

Factual copy cites public product evidence; demand copy cites aggregate ID/version/window. A
validator rejects unknown references, unsupported quantities, and statements of willingness/sales.
Sample quoted claims need semantic human review, not just citation-presence tests. Shopper uploads
and text never go into merchant prompts. Use normalized aggregate facts only.

No invented bundle discount. A merchant may enter costs/terms for an explicitly hypothetical
scenario; missing costs prevent margin claims. Outreach remains editable and copyable. S5 may
create a draft concept product in an allowlisted owned store, with approval, idempotency, dry run
and audit. It does not create inventory links or cross-store checkout. Images require appropriate
permission; partner images stay out of write-back by default.

## 8. APIs, access and state transitions

All planned routes are versioned by contracts, validate input, and return a typed error envelope.
Bootstrap only exposes health plus sanitized capability metadata; these feature routes land on cards.

| Route | Purpose / access |
| --- | --- |
| GET /api/capabilities | active plan version, domains, sections, effective flags; never keys |
| POST /api/assets | owner-bound image upload; 413 size / 415 type; S1 |
| POST /api/briefs | image or text -> draft; same owner; S1 |
| PATCH /api/briefs/:id | edit/confirm with expected revision; S1 |
| POST /api/briefs/:id/matches | confirmed revision -> bounded run; S2 |
| GET /api/runs/:id/events | owner-authorized resumable SSE; S2 |
| POST /api/briefs/:id/decisions | validated current match/slot event; S3 |
| PUT /api/consent | explicit grant/withdraw, increment version; S3 |
| DELETE /api/session | delete own data, invalidate aggregates; S3 |
| POST /api/merchants/profile | public URL -> verified profile; S4 |
| GET /api/merchants/:id/opportunities | merchant-session authorization, aggregate DTO only; S4 |
| POST /api/opportunities/:id/drafts | immutable aggregate revision + product refs -> editable draft; S4 |
| POST /api/drafts/:id/approve | human approval, invalidate on edit; S5 |
| POST /api/drafts/:id/execute | approved unchanged draft, allowlist, idempotent write; S5 |

Use server-issued HttpOnly SameSite owner sessions, same-origin mutations, session/asset ownership
checks, and origin checks. Public demo merchant access is limited to seeded/owned stores until
store ownership is verified. Claiming a URL is not merchant authentication. Admin credentials
are server-only. Safe public fetch validates DNS/IP and every redirect; reject loopback/private
networks, credentials, unsupported protocols and oversized responses. Provider content is untrusted.

States: asset accepted -> brief draft -> confirmed revision -> matching -> ready/partial/failed.
Brief edits invalidate dependent work. Events are append-only with deterministic projections;
stores must serialize writes per session and enforce idempotency atomically (file store: single
process lock/queue + atomic rename). Multi-instance writes require a transactional store later.

## 9. Execution, budgets, storage and failure handling

Shopper stages: interpret -> confirm barrier -> discover -> verify_products -> match -> explain.
Merchant stages: profile -> aggregate snapshot lookup -> map_supply -> propose -> verify_claims.
Aggregation is deterministic code independent of LLM availability. A provider outage cannot create
fake demand or silently switch live records to fixture provenance.

Initial caps per shopper run: 6 slots, 12 catalog queries, 8 candidates/slot, 12 public fetches,
2 total browser sessions (concurrency at most 2 and never above account quota), 6 model calls,
90 s soft / 180 s hard deadline. These are configurable starting budgets, not achieved benchmarks.
At deadline return partial results with reasons. Each call has timeout/retry budget; cancellation
closes sessions. Scope caches by brief revision and provider/prompt version; private assets never
enter shared caches. Cache product facts by seller/variant/country/currency with a 15-minute TTL.

File layout (all private runtime data under ignored `.data/`):

```text
sessions/<sessionId>/{consent.json,briefs/<briefId>.json,decisions.jsonl}
assets/<assetId>                        # access through owner-checked route only
runs/<runId>/{run.json,events.jsonl,offers.json,matches.json,evidence.json}
aggregates/<snapshotId>.json            # private exact calculations
merchants/<merchantId>/{profile.json,opportunities.json,drafts/}
```

No committed real shopper data. `fixtures/seed/{outfit,setup}` is synthetic; `fixtures/spikes/`
is redacted provider shape evidence; `fixtures/real/` permits consented, sanitized recordings only.
Normalized events expire after 30 days by default; asset 24h expiry is shorter. Deletion propagates
to checkpoints/caches/replay exports and invalidates drafts using withdrawn aggregates.

## 10. Evaluation and demo

Each domain gets the same acceptance matrix: two images, a text brief, corrected slot, required
unknown attribute, out-of-stock candidate, wrong currency, unsatisfied budget, duplicate variants,
provider timeout, withdrawn consent, stale feedback, and a newly joining merchant with no support.
Tests use fakes and recordings only. Human live checks are a separate gate and recorded explicitly.

Targets to measure (not preclaimed): usable confirmation in <=30s; first useful collection <=90s;
zero known hard-constraint violations in ready results; zero unselected/model-only events counted
as pair demand; zero private identifiers in merchant DTOs; all material factual claims traceable.
Compare against per-item catalog search on the same briefs; blinded humans assess relevance,
collection coherence, constraint satisfaction and useful gaps. Report n, both domains separately,
latency/provider cost, failures and selection bias. A green schema test alone is not product success.

Three-minute demo: outfit image -> correction -> collection -> explicit save; show equivalent setup
flow using a clearly labeled recording; merchant sees a seeded cohort with provenance -> proposed
partner -> new merchant enters and is labeled inferred -> collaboration brief. Explain why a
plausible alternative was rejected. Use synthetic aggregate data visibly; one live click never
pretends to move a real market. Replay is always labeled and never written into live aggregates.

## 11. Team execution and migration

Four lanes keep existing package boundaries, but split UI ownership. See team split for exact paths.
S0 is contracts/fixtures/provider spikes; S1–S4 is the complete two-sided product; S5 is optional.
Both domains ship or fail a milestone together. Cut optional actions/polish before cutting a domain.
Time windows are relative to a human-confirmed start and submission deadline, not stale clock times.

Migration preserves v2 docs under archive and legacy `m1`–`m5` preset semantics. Active presets are
`s1`–`s5`, default `s1`; mixed legacy/active presets are rejected. No existing dependency manifests
or lockfiles change. `.env.example` switches to fake providers for safe bootstrap operation; an
existing private `.env` is never edited and must be consciously migrated by its owner.

This revision's bootstrap scope: schemas/interfaces/category configuration, fixture registration,
active milestone flags with feature dependency checks, capability endpoint, honest landing copy,
and offline checks. It does not implement image upload, live matching, aggregation or merchant
actions. [Bootstrap status](BOOTSTRAP_STATUS.md) records precisely what is ready and what follows.
