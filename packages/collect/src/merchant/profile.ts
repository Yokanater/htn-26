/** Public merchant catalog profile. Owner: L1 (S4-L1-1).
 * JSON-LD/metadata ideas adapted from legacy store-profiler.ts @ 453afe1.
 * URL input does not prove ownership or partnership willingness.
 */

import { createHash } from 'node:crypto';
import { type MerchantIdentity, newId, type ProductOffer, type SampleOrigin } from '@sei/contracts';
import type { ShoppingContext } from '@sei/core';
import { extractJsonLdBlocks, productNamesFromJsonLd } from '../jsonld';
import { type CatalogHit, normalizeCatalogHits } from '../normalize';
import {
  assertPublicHttpsUrl,
  type DnsLookup,
  fetchPublicHttps,
  type SafeFetchDeps,
  UrlSafetyError,
} from '../url-safety';
import { readStorefrontCatalog } from './catalog';

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
  /** Optional page→hits mapper for tests; production requires storefront inventory. */
  extractOffers?: (input: { domain: string; bodyText: string; finalUrl: string }) => CatalogHit[];
};

function hasShopifySignals(text: string): boolean {
  return (
    /cdn\.shopify\.com/i.test(text) ||
    /Shopify\.theme/i.test(text) ||
    /<meta[^>]+name=["']shopify["']/i.test(text)
  );
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
    // Shopify theme HTML can exceed 512 KB after decompression even when the transfer is small.
    // Keep a decoded-body cap, aligned with catalog pages, rather than trusting Content-Length.
    maxBytes: 2_000_000,
  });

  const domain = fetched.url.hostname.toLowerCase();
  const bodyText = new TextDecoder().decode(fetched.body);
  const captureHash = createHash('sha256').update(fetched.body).digest('hex');
  const hits = deps.extractOffers
    ? deps.extractOffers({ domain, bodyText, finalUrl: fetched.url.href })
    : await readStorefrontCatalog(fetched.url.origin, bodyText, context, deps);
  const shopifySignalsPresent =
    hasShopifySignals(bodyText) || (!deps.extractOffers && hits.length > 0);
  const { offers } = normalizeCatalogHits(
    hits.filter((hit) => {
      try {
        const product = new URL(hit.productUrl);
        return (
          hit.merchant.domain.toLowerCase() === domain &&
          product.origin === fetched.url.origin &&
          /^\/products\/[^/]+$/.test(product.pathname)
        );
      } catch {
        return false;
      }
    }),
    {
      sampleOrigin: options?.sampleOrigin ?? 'live',
      capturedAt: new Date().toISOString(),
      limit: 300,
    },
  );

  const merchant: MerchantIdentity = offers[0]?.merchant ?? {
    id: newId('mer_'),
    name: domain,
    domain,
  };

  const merchantClaims = productNamesFromJsonLd(extractJsonLdBlocks(bodyText)).slice(0, 12);

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
