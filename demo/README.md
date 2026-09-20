# Rainforest × Allbirds rehearsal

Open **http://127.0.0.1:5174/**. This is an isolated demo, not the normal app on 5173.
Allbirds is a real, independent Shopify merchant; we do not own or represent it.
The Rainforest logo is installed in the shared app header and footer.

## Walkthrough

1. Open `http://127.0.0.1:5174/demo/inspiration.png`, or use
   `apps/web/public/demo/inspiration.png`.
2. Choose **Start a collection**, upload it, and select **Build my draft brief**.
   OpenAI interprets the image live: gray knit footwear, socks and a backpack.
3. Review the detected items, correct anything needed, and choose **Find my collection**.
   The recorded catalog supplies actual Allbirds shoes and complementary products.
   This is similarity matching, not a claim that the unbranded image depicts Allbirds.
4. Under **Privacy & sharing settings**, explicitly opt in to aggregate insights.
   Matching and saving also work without consent; those choices do not contribute to insights.
5. **Accept** the three items and **Save selection**.
6. Switch to **Merchant**, then **Analyze store** (Allbirds is prefilled).
   The shopper-demand section shows thresholded selected-together insights.
7. Choose **Find products and brands**, then open **Bundle products**,
   **Complementary brands**, and **Competitors**.

The page has no walkthrough banner; a small footer and sample-insights label preserve data provenance.
The recorded walkthrough is `.data/demo-video/rainforest-allbirds-demo.webm` (captured before the banner was removed).
Screenshots in that directory cover detection, approval, demand and all three research tabs.

## What is live, recorded and synthetic

| Component | Evidence / behavior |
| --- | --- |
| Image interpretation | Live OpenAI vision, using the local server key; no browser key exposure. |
| Store catalog | Public Shopify storefront JSON captured on 2026-09-20, including actual product/variant links, stated prices, currencies and availability. See `allbirds-recording.json`. Not freshly checked on each demo click. |
| Merchant research | Curated demo plan over those recorded products. No live Browserbase discovery or live OpenAI pairing planner in this isolated demo. The normal app retains its general live provider flow. |
| Shopper selections | The actual approval/save action is persisted in the isolated SQLite database. |
| Aggregate demand | Labeled **replay** data: four synthetic baseline sessions plus consenting rehearsal selections. Five eligible sessions are required before bands appear; withdrawal invalidates insights. Never counted as live observed demand. |
| Checkout | None. Approval means a saved selection, **not a purchase**. No checkout, Shopify Admin API, merchant authentication or partnership acceptance is performed. |

The demo uses US/USD matching. Other-currency rivals can appear with their original currency;
bundle totals never combine currencies. Shipping and unstated size eligibility remain unknown.
Captured stock can change, and sold-out listings remain identified as such.
Merchant responses contain aggregate bands, not private uploads or per-shopper events.

## Start locally

The existing repo-root `.env` must contain `OPENAI_API_KEY`. Do not commit it.
Optional `OPENAI_MODEL_VISION` defaults to `gpt-4.1-mini`.

Terminal 1, from the repository root:

```sh
./node_modules/.bin/tsx apps/server/src/demo/server.ts
```

Terminal 2, from `apps/web`:

```sh
PORT=3002 WEB_PORT=5174 ../../node_modules/.bin/vite --host 127.0.0.1
```

The separate server listens only on loopback, with `DEMO_PORT` defaulting to 3002.
Its data is `.data/allbirds-demo.sqlite`; the normal application's database is not used.
The demo composition enables S1–S4; it is never imported by the normal server entry point.
The bundled recordings avoid slow storefront discovery during a presentation, but image
interpretation still requires a working OpenAI key and network connection.

To record another walkthrough (one live image interpretation), with both servers running:

```sh
node demo/record-walkthrough.mjs --live
```

Each rehearsal creates another isolated session. For a clean first-run threshold demonstration,
stop only the demo server and move its exact SQLite file to a named backup before restarting.
Never reset the normal application's database. Existing backups and recordings are recoverable.

## Evidence capture and checks

`apps/server/src/demo/capture.ts` and `record-vision.ts` are explicit live capture tools,
not startup hooks or tests. Run them only with authorization to spend provider quota/access stores.
Capture supports `--host=<recorded-host>` for a bounded single-store refresh.
`vision-recording.json` contains the recorded interpretation and image SHA-256 for offline tests.

The offline integration test in `apps/server/test/demo.test.ts` exercises upload, confirmation,
matching, consent, approval/save, aggregate pair support, research, withdrawal, and exclusion from
the live demand partition. Existing outfit/setup suites remain separate acceptance checks;
this Allbirds rehearsal itself demonstrates the outfit flow, not a second live setup demo.

The inspiration is generated artwork, not a private shopper photo or a retailer photograph:
an unbranded flat lay of gray knit sneakers with white soles, dark gray ankle socks and a black
backpack. Asset: `apps/web/public/demo/inspiration.png`. The approved generated logo is
`apps/web/public/brand/rainforest-logo.png`.
