/**
 * Offline demo inventory (CATALOG_PROVIDER=fake). Owner: L4 (S2-L4-1).
 * Reads the synthetic seed offers so the shopper loop runs without any provider. Every offer is
 * `sampleOrigin: 'seed'`, so the runner only matches them for seed briefs and never for live ones.
 * A live Shopify catalog needs the human provider spike and is deliberately not wired here.
 */
import { readFileSync } from 'node:fs';
import { type ProductOffer, ProductOfferSchema } from '@sei/contracts';
import { SHOPPING_DOMAINS } from '@sei/core';
import { z } from 'zod';

export function loadSeedOffers(): ProductOffer[] {
  return Object.keys(SHOPPING_DOMAINS).flatMap((domain) =>
    z
      .array(ProductOfferSchema)
      .parse(
        JSON.parse(
          readFileSync(
            new URL(`../../../fixtures/seed/${domain}/offers.json`, import.meta.url),
            'utf8',
          ),
        ),
      ),
  );
}
