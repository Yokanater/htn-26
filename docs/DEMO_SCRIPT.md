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

With `VISION_PROVIDER=openai`, `CATALOG_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL_VISION`, and
`OPENAI_MODEL_SEARCH` configured locally, enter an image or description, review the detected
items, and confirm. Select **Find products** to start a search with a three-minute overall limit.
The current live adapter uses OpenAI web search to discover Shopify product pages, then reads
public storefront product and cart JSON for actual variants, images, availability, and currency.
This shopper discovery adapter uses OpenAI search. Merchant catalog onboarding now uses the separate
Browserbase + Baseten workflow described below. Stores without compatible public data are skipped.

Results expose requirements that could not be verified, plus the discovered product cards.
Open the source evidence, shortlist a product, visit its merchant page, and download the shortlist.
Shortlists last for the current visit; purchasing happens at the merchant. Shipping eligibility is
unknown until independently verified, and different currencies are never added together.
Edit requirements to invalidate the old search, or cancel and retry. Clothing sizes use full labels.

The integrated consent ledger and S4 merchant workflow use in-memory state. No claim of durable
storage or S5 activation is made. Offline S2 checks cover both domains, ownership and revisions.

## Merchant workflow (S4)

With `MERCHANT_PROVIDER=fake`, select an outfit or setup demo
store. Profile it, inspect source evidence, correct categories and confirm. Compare demand and
partners, inspect observed-pair versus inferred-fit labeling, then create/edit/save/reopen/export
a collaboration draft. Keep the synthetic label visible throughout; these are not actual shoppers.

For live profiling, configure the keys and access list in [MERCHANT_IMPLEMENTATION.md](MERCHANT_IMPLEMENTATION.md).
Show Browserbase capture and the read-only live view, followed by verified variant counts and
Baseten extraction. Cancel once and retry. Profile the candidate partner as well as the primary
store. Baseten chooses a small falsifiable experiment; deterministic code controls the evidence
summary. No eligible cohort means an honest insufficient-evidence screen.

Withdraw consent after a live proposal is created, then try reopening/exporting it: the server
must reject stale evidence. Explain remaining unknown shipping, fit/dimensions, costs and partner
willingness. No message is sent by this workflow. Repeat the rehearsal for the other domain.
