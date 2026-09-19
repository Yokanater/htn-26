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
| 1:50–2:20 | Merchant view: labeled synthetic cohort -> two-store opportunity -> public product proof. |
| 2:20–2:40 | New merchant maps to unmet intent; show inferred supply fit, not invented historical support. |
| 2:40–3:00 | Editable collaboration brief; say what remains unknown. Optional owned-store draft only if working. |

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

This is a working shopper slice, not a completed S3–S5 release: persisted saves, consented demand
aggregation, and live merchant opportunities still need integration. Merchant previews remain labeled
synthetic. Offline S2 checks cover outfit and general-product fixtures, ownership, and revisions.
