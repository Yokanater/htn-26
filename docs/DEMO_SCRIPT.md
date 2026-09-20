# Demo v3 — both sides of confirmed intent

Use outfits and room/desk setups equally in rehearsals. Three minutes is a presentation target,
not an assertion of the event's current judging format. Check current rules with organizers.

| Time | Beat |
| --- | --- |
| 0:00–0:20 | Shopper goal: recreate an inspiration under real constraints. Show image, choose domain. |
| 0:20–0:45 | Correct a mistaken item; enter a meaningful size/dimension requirement and confirm. |
| 0:45–1:15 | Show real sourced collection, a rejected alternative, missing fact and honest subtotal. |
| 1:15–1:30 | Explicitly save; show opt-in is separate and optional. |
| 1:30–1:50 | Switch to a labeled recording of the other domain with the same complete workflow. |
| 1:50–2:20 | Merchant view: open **Synthetic/demo merchant workspace**, paste a seed `.example` URL, show banded cohort counts and public product proof. Never call this ownership. |
| 2:20–2:40 | New merchant maps to unmet intent; show inferred supply fit, `observedPairSupport` empty, evidence from both catalogs. |
| 2:40–3:00 | Create a server-generated draft, edit the prose, save with `expectedVersion`. Say what remains unknown. Do not approve or execute. |

Never let one on-stage action appear to establish market demand. Explain sample size and provenance.
Keep one permitted real-image recording per domain and a fully synthetic offline backup. Replays
must not mutate the live ledger. Cite factual product claims; merchant demand evidence is aggregate.
Compare one example against simple per-item catalog search and explain the actual observed gain.

Before submission: both domain checks, deletion/withdrawal exercise, no exposed upload links,
newcomer attribution check, backup video, verified deployment, measured latency/cost, actual assist log.

## Current skeletal shopper demo (S2 integration)

With `MILESTONES=s1,s2`, `VISION_PROVIDER=openai`, `CATALOG_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL_VISION`, and
`OPENAI_MODEL_SEARCH` configured locally, enter an image or description, review the detected
items, and confirm. Select **Find products** to start a search with a three-minute overall limit.
The current live adapter uses OpenAI web search to discover Shopify product pages, then reads
public storefront product and cart JSON for actual variants, images, availability, and currency.
Browserbase is not part of this new catalog path. Stores without compatible public data are skipped.

Results expose requirements that could not be verified, plus the discovered product cards.
Open the source evidence, shortlist a product, visit its merchant page, and download the shortlist.
Shortlists last for the current visit; purchasing happens at the merchant. Shipping eligibility is
unknown until independently verified, and different currencies are never added together.
Edit requirements to invalidate the old search, or cancel and retry. Clothing sizes use full labels.

This is a working shopper slice plus a fixture-backed merchant workspace: S4 uses labeled synthetic
cohorts, not live snapshots. Merchant views stay **synthetic/demo** for demand. A live public store
URL is a human spike behind `MERCHANT_CATALOG_PROVIDER=live` and does **not** make seed bands live
demand. Offline S2 checks cover outfit and general-product fixtures, ownership, and revisions.

## Merchant workspace (S4 fixtures)

With `MILESTONES=s1,s2,s3,s4`, the merchant surface is a **synthetic/demo workspace**. Seed hosts
such as `outfit-brand-1.example` and `setup-brand-1.example` profile in memory with no network.
Observed cards reuse the seed cohort bands (`5–9`, never an exact private count). Default demo
newcomers `newcomer-outfit.example` (top) and `newcomer-setup.example` (desk) profile through the
same in-memory merchant catalog: inferred complementary supply fit, public product proof from both
catalogs, and no inherited pair support. Drafts are versioned prose, not approved actions. Shopper
Browserbase search, if enabled, does not profile merchants.

Live public catalog profiling is opt-in (`MERCHANT_CATALOG_PROVIDER=live`). Runtime wiring uses
public HTTPS fetch and DNS; offline tests inject both. No private `.env` is edited by agents.
The profiler requires actual same-store `/products.json` inventory, not Product metadata from
an article. It samples at most three pages of 50 products, up to 20 variants per product and 300
normalized variants total. Repeated pages stop early. Overall timeout is 60 seconds; individual
catalog reads get 15 seconds. Unstated currency, shipping and availability remain unknown.

The merchant workspace keeps a product category graph and offers three research tabs: bundle
products, complementary brands, and competitors. Choose a catalog category and market, then select
**Find products and brands**. Live research uses the established Browserbase search and product
verification API (`BROWSERBASE_API_KEY`), one shared session, at most six searches and 24 page reads,
and a 150-second research deadline. It targets product pages and attempts several stores before
stopping. Cancel aborts the request and closes its session. Seed demos use local offers only.

Bundle suggestions are category-based proposals, not evidence of demand or partnership interest.
Product links, stated prices and stock status support the suggestions. Totals never mix currencies.
Competitor comparison covers up to three selected stores and shows the category, sampled price
range and number of products found; it does not claim market share or full-catalog coverage. Partial
searches keep useful results and list gaps. Public profiles never inherit fictional seed partners,
demand bands or drafts. Both `.example` demos retain explicitly synthetic demand and editable drafts.

Human smoke check: with S1-S4 and live merchant mode enabled, enter one outfit and one setup
Shopify URL. Check categories, bundle links, brand tabs and comparison selection. An editorial site
must not become a merchant based on Product JSON-LD. Stores that block their public JSON catalog
remain unsupported. Browserbase research requires actual product pages and can return partial or
empty results. Live checks by agents require an explicit user exception to AGENTS.md.
