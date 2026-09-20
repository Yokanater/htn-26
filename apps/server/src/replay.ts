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

/** Demo newcomers shipped with the default merchant profiler; not mixed into shopper search. */
const DEMO_NEWCOMERS = [
  { domain: 'outfit' as const, host: 'newcomer-outfit.example', category: 'top' },
  { domain: 'setup' as const, host: 'newcomer-setup.example', category: 'desk' },
];

export function loadDemoNewcomerHosts(): Set<string> {
  return new Set(DEMO_NEWCOMERS.map((item) => item.host));
}

export function loadDemoNewcomerOffers(): ProductOffer[] {
  return loadMerchantCatalogOffers().filter((offer) =>
    loadDemoNewcomerHosts().has(offer.merchant.domain),
  );
}

export function loadMerchantCatalogOffers(): ProductOffer[] {
  return [
    ...loadSeedOffers(),
    ...DEMO_NEWCOMERS.map((item) =>
      ProductOfferSchema.parse({
        id: `offer_newcomer_${item.domain}`,
        merchant: {
          id: `mer_newcomer_${item.domain}`,
          name: `Newcomer ${item.domain} shop`,
          domain: item.host,
        },
        productId: `product-${item.category}`,
        variantId: `variant-${item.category}-1`,
        title: `Newcomer ${item.category}`,
        category: item.category,
        productUrl: `https://${item.host}/products/${item.category}`,
        imageUrl: null,
        price: { amount: 12000, currency: 'CAD' },
        availability: 'available',
        shipsTo: ['CA'],
        attributes: {},
        evidence: [
          {
            id: `ev_newcomer_${item.domain}`,
            field: 'product_record',
            value: `Synthetic newcomer ${item.category}`,
            url: `https://${item.host}/products/${item.category}`,
            capturedAt: '2026-09-19T12:00:00Z',
            method: 'catalog',
          },
        ],
        sampleOrigin: 'seed',
      }),
    ),
  ];
}
