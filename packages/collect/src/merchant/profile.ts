/** Public merchant catalog profile. Owner: L1 (S4-L1-1).
 * JSON-LD/metadata ideas adapted from legacy store-profiler.ts @ 453afe1.
 * URL input does not prove ownership or partnership willingness.
 */

import { createHash } from 'node:crypto';
import { type MerchantIdentity, newId, type ProductOffer, type SampleOrigin } from '@sei/contracts';
import type { ShoppingContext } from '@sei/core';
import { type CatalogHit, normalizeCatalogHits } from '../normalize';
import {
  assertPublicHttpsUrl,
  type DnsLookup,
  fetchPublicHttps,
  type SafeFetchDeps,
  UrlSafetyError,
} from '../url-safety';

export type MerchantProfileResult = {
  merchant: MerchantIdentity;
  offers: ProductOffer[];
  /** Capture hash of the primary page body for provenance. */
  captureHash: string;
  sourceUrl: string;
  /** True only when Shopify storefront signals are present — never from generic Product JSON-LD alone. */
  shopifySignalsPresent: boolean;
  /** Explicit product claims from merchant copy; not observed shopper demand. */
  merchantClaims: string[];
};

export type MerchantProfileDeps = SafeFetchDeps & {
  /** Optional page→hits mapper for tests; production can parse products.json / JSON-LD. */
  extractOffers?: (input: { domain: string; bodyText: string; finalUrl: string }) => CatalogHit[];
};

function clean(value: unknown, limit = 240): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function extractJsonLd(text: string): unknown[] {
  const blocks = [
    ...text.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ];
  const out: unknown[] = [];
  for (const match of blocks) {
    try {
      const parsed = JSON.parse(match[1] ?? 'null');
      if (parsed) out.push(parsed);
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return out;
}

function productNamesFromJsonLd(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(productNamesFromJsonLd);
  const record = value as Record<string, unknown>;
  const types = Array.isArray(record['@type']) ? record['@type'] : [record['@type']];
  const own =
    types.includes('Product') && typeof record.name === 'string' ? [clean(record.name, 120)] : [];
  return [...own, ...Object.values(record).flatMap(productNamesFromJsonLd)].filter(Boolean);
}

function hasShopifySignals(text: string): boolean {
  return (
    /cdn\.shopify\.com/i.test(text) ||
    /Shopify\.theme/i.test(text) ||
    /<meta[^>]+name=["']shopify["']/i.test(text)
  );
}

function defaultExtractOffers(input: {
  domain: string;
  bodyText: string;
  finalUrl: string;
}): CatalogHit[] {
  const jsonLd = extractJsonLd(input.bodyText);
  const names = [...new Set(jsonLd.flatMap(productNamesFromJsonLd))].slice(0, 8);
  // Generic Product JSON-LD is a claim about products, not proof of Shopify or demand.
  return names.map((name, index) => ({
    merchant: {
      name: input.domain,
      domain: input.domain,
    },
    productId: `jsonld-product-${index + 1}`,
    variantId: `jsonld-variant-${index + 1}`,
    title: name,
    category: 'unknown',
    productUrl: input.finalUrl,
    imageUrl: null,
    price: null,
    availability: 'unknown' as const,
    shipsTo: null,
    attributes: {},
    evidenceMethod: 'fetch' as const,
  }));
}

export async function profileMerchantCatalog(
  publicUrl: string,
  context: ShoppingContext,
  deps: MerchantProfileDeps,
  options?: { sampleOrigin?: SampleOrigin },
): Promise<MerchantProfileResult> {
  if (context.signal.aborted) {
    throw context.signal.reason ?? new Error('Merchant profiling was cancelled.');
  }
  context.consume('fetch', 1);

  const initial = await assertPublicHttpsUrl(publicUrl, deps.lookup);
  const fetched = await fetchPublicHttps(initial.href, deps, {
    signal: context.signal,
    acceptContentTypes: ['text/html', 'application/json', 'text/plain'],
    maxBytes: 512_000,
  });

  const domain = fetched.url.hostname.toLowerCase();
  const bodyText = new TextDecoder().decode(fetched.body);
  const captureHash = createHash('sha256').update(fetched.body).digest('hex');
  const shopifySignalsPresent = hasShopifySignals(bodyText);
  const extract = deps.extractOffers ?? defaultExtractOffers;
  const hits = extract({ domain, bodyText, finalUrl: fetched.url.href });
  const { offers } = normalizeCatalogHits(hits, {
    sampleOrigin: options?.sampleOrigin ?? 'live',
    capturedAt: new Date().toISOString(),
  });

  const merchant: MerchantIdentity = offers[0]?.merchant ?? {
    id: newId('mer_'),
    name: domain,
    domain,
  };

  const merchantClaims = productNamesFromJsonLd(extractJsonLd(bodyText)).slice(0, 12);

  if (offers.length === 0 && !deps.extractOffers) {
    // Unavailable catalog — still return identity with empty offers only when extractor finds nothing
    // Callers treat empty offers as unavailable catalog for matching.
  }

  if (offers.length === 0) {
    throw new UrlSafetyError(
      'catalog_unavailable',
      'No public product catalog could be normalized for this merchant URL.',
    );
  }

  return {
    merchant,
    offers,
    captureHash,
    sourceUrl: fetched.url.href,
    shopifySignalsPresent,
    merchantClaims,
  };
}

export type { DnsLookup };
