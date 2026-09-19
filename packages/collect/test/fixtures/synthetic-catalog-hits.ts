/**
 * Synthetic (fake) CatalogHit examples for offline tests.
 * These are NOT recorded Shopify Global Catalog / provider responses.
 * Real recorded shapes belong in fixtures/spikes/ after a human spike.
 */
import type { CatalogHit } from '../../src/normalize';

/** Synthetic outfit-like hits — two sellers, same product/variant identity on one SKU pair. */
export const SYNTHETIC_OUTFIT_HITS: CatalogHit[] = [
  {
    merchant: { name: 'Synthetic Outfit Co', domain: 'synthetic-outfit-a.example' },
    productId: 'product-jacket',
    variantId: 'variant-jacket-m',
    title: 'Synthetic linen jacket',
    category: 'jacket',
    productUrl: 'https://synthetic-outfit-a.example/products/jacket',
    imageUrl: null,
    price: { amount: 12000, currency: 'CAD' },
    availability: 'available',
    shipsTo: ['CA'],
    attributes: { size: 'M' },
    evidenceMethod: 'catalog',
    capturedAt: '2026-09-19T12:00:00Z',
  },
  {
    merchant: { name: 'Synthetic Outfit Alt', domain: 'synthetic-outfit-b.example' },
    productId: 'product-jacket',
    variantId: 'variant-jacket-m',
    title: 'Synthetic linen jacket',
    category: 'jacket',
    productUrl: 'https://synthetic-outfit-b.example/products/jacket',
    imageUrl: null,
    price: { amount: 11500, currency: 'CAD' },
    availability: 'available',
    shipsTo: ['CA'],
    attributes: { size: 'M' },
    evidenceMethod: 'catalog',
    capturedAt: '2026-09-19T12:00:00Z',
  },
  {
    merchant: { name: 'Synthetic Outfit Co', domain: 'synthetic-outfit-a.example' },
    productId: 'product-bag',
    variantId: 'variant-bag-1',
    title: 'Synthetic tote',
    category: 'bag',
    productUrl: 'https://synthetic-outfit-a.example/products/bag',
    price: null,
    availability: 'unknown',
    shipsTo: null,
    attributes: {},
    evidenceMethod: 'catalog',
    capturedAt: '2026-09-19T12:00:00Z',
  },
];

/** Synthetic setup-like hits — desk and lighting with explicit unknowns. */
export const SYNTHETIC_SETUP_HITS: CatalogHit[] = [
  {
    merchant: { name: 'Synthetic Setup Co', domain: 'synthetic-setup-a.example' },
    productId: 'product-desk',
    variantId: 'variant-desk-120',
    title: 'Synthetic oak desk',
    category: 'desk',
    productUrl: 'https://synthetic-setup-a.example/products/desk',
    imageUrl: null,
    price: { amount: 45000, currency: 'CAD' },
    availability: 'available',
    shipsTo: ['CA'],
    attributes: { width_cm: 120 },
    evidenceMethod: 'catalog',
    capturedAt: '2026-09-19T12:00:00Z',
  },
  {
    merchant: { name: 'Synthetic Setup Alt', domain: 'synthetic-setup-b.example' },
    productId: 'product-desk',
    variantId: 'variant-desk-120',
    title: 'Synthetic oak desk',
    category: 'desk',
    productUrl: 'https://synthetic-setup-b.example/products/desk',
    price: { amount: 48000, currency: 'CAD' },
    availability: 'available',
    shipsTo: null,
    attributes: { width_cm: 120 },
    evidenceMethod: 'catalog',
    capturedAt: '2026-09-19T12:00:00Z',
  },
  {
    merchant: { name: 'Synthetic Setup Co', domain: 'synthetic-setup-a.example' },
    productId: 'product-lamp',
    variantId: 'variant-lamp-1',
    title: 'Synthetic lamp',
    category: 'lighting',
    productUrl: 'https://synthetic-setup-a.example/products/lamp',
    price: null,
    availability: 'unknown',
    shipsTo: null,
    attributes: {},
    evidenceMethod: 'catalog',
    capturedAt: '2026-09-19T12:00:00Z',
  },
];
