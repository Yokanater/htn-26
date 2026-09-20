import {
  MerchantProfileSchema,
  newId,
  type ProductOffer,
  ProductOfferSchema,
} from '@sei/contracts';
import type { MerchantProfiler } from '@sei/core';
import { z } from 'zod';
import { stablePrefixedId } from '../stable-id';
import { fetchPublicHttps, type SafeFetchDeps } from '../url-safety';
import type { CatalogExtractor } from './baseten';
import type { MerchantBrowser } from './browserbase';

const Product = z.object({
  id: z.number().int(),
  title: z.string(),
  description: z.string().nullable().optional(),
  type: z.string().optional(),
  variants: z
    .array(
      z.object({
        id: z.number().int(),
        title: z.string(),
        price: z.number().int().nonnegative(),
        available: z.boolean(),
      }),
    )
    .max(250),
});

/** Browser discovery -> authoritative variant JSON -> batched Baseten fact extraction. */
export function createLiveMerchantProfiler(
  deps: Omit<SafeFetchDeps, 'now'> & {
    browser: MerchantBrowser;
    extract: CatalogExtractor;
    now?: () => Date;
  },
): MerchantProfiler {
  return {
    origin: 'live',
    async profile({ url, domain, signal, progress, liveView }) {
      progress(
        'browser',
        'Browserbase is opening the public collection and finding product pages.',
      );
      const capture = await deps.browser({ url, signal, liveView });
      const merchantDomain = new URL(capture.url).hostname;
      const merchant = {
        id: stablePrefixedId('mer_', merchantDomain),
        name: merchantDomain,
        domain: merchantDomain,
      };
      const capturedAt = (deps.now?.() ?? new Date()).toISOString();
      const warnings: string[] = [];
      const records: { productId: string; title: string; description: string }[] = [];
      const offers: ProductOffer[] = [];
      let currency: string | null = null;
      try {
        const cart = await fetchPublicHttps(
          new URL('/cart.js', capture.url).href,
          { fetch: deps.fetch, lookup: deps.lookup },
          { signal, maxBytes: 20000 },
        );
        const value = z
          .object({ currency: z.string().regex(/^[A-Z]{3}$/) })
          .parse(JSON.parse(new TextDecoder().decode(cart.body)));
        currency = value.currency;
      } catch {
        signal.throwIfAborted();
        warnings.push('Currency could not be verified; prices remain unknown.');
      }
      for (const productUrl of capture.productUrls.slice(0, 8)) {
        signal.throwIfAborted();
        try {
          const candidate = new URL(productUrl);
          if (
            candidate.hostname !== merchantDomain ||
            !/^\/products\/[^/]+$/.test(candidate.pathname)
          )
            continue;
          const response = await fetchPublicHttps(
            `${candidate.href}.js`,
            { fetch: deps.fetch, lookup: deps.lookup },
            { signal, maxBytes: 300000, timeoutMs: 12000 },
          );
          if (response.url.hostname !== merchantDomain) throw new Error('Seller changed');
          const product = Product.parse(JSON.parse(new TextDecoder().decode(response.body)));
          records.push({
            productId: String(product.id),
            title: product.title,
            description: (product.description ?? '')
              .replace(/<[^>]*>/g, ' ')
              .replace(/\s+/g, ' ')
              .slice(0, 5000),
          });
          for (const variant of product.variants.slice(0, 4)) {
            const key = `${merchantDomain}::${product.id}::${variant.id}`;
            offers.push(
              ProductOfferSchema.parse({
                id: stablePrefixedId('offer_', key),
                merchant,
                productId: String(product.id),
                variantId: String(variant.id),
                title: `${product.title}${variant.title === 'Default Title' ? '' : ` · ${variant.title}`}`,
                category: product.type?.toLowerCase() || 'unknown',
                productUrl,
                imageUrl: null,
                price: currency ? { amount: variant.price, currency } : null,
                availability: variant.available ? 'available' : 'unavailable',
                shipsTo: null,
                attributes: {},
                sampleOrigin: 'live',
                evidence: [
                  {
                    id: stablePrefixedId('ev_', key),
                    field: 'variant_record',
                    value: `${product.title}; variant ${variant.id}; ${variant.available ? 'available' : 'unavailable'}${currency ? `; ${variant.price} minor units ${currency}` : ''}`,
                    url: response.url.href,
                    capturedAt,
                    method: 'fetch',
                  },
                ],
              }),
            );
          }
          progress('verify', `Verified ${records.length} public product records.`, offers.length);
        } catch {
          signal.throwIfAborted();
          warnings.push('A product page could not be verified and was excluded.');
        }
      }
      if (!offers.length) throw new Error('No verifiable public Shopify variants found');
      progress(
        'extract',
        'Baseten is reading product copy in one batch and checking source quotes.',
        offers.length,
      );
      try {
        const extracted = await deps.extract(records, domain, signal);
        for (const offer of offers) {
          const fact = extracted.products.find((item) => item.productId === offer.productId);
          if (!fact) continue;
          offer.category = fact.category.toLowerCase();
          for (const [field, value, quote] of [
            ['material', fact.material, fact.materialQuote],
            ['function', fact.function, fact.functionQuote],
          ]) {
            if (!value || !quote) continue;
            offer.attributes[field as string] = value;
            offer.evidence.push({
              id: stablePrefixedId('ev_', `${offer.id}:${field}:${quote}`),
              field: field as string,
              value: quote,
              url: offer.productUrl,
              capturedAt,
              method: 'fetch',
            });
          }
        }
        warnings.push(
          'Categories are model interpretations. Confirm them before comparing demand.',
        );
      } catch {
        signal.throwIfAborted();
        warnings.push(
          'Baseten extraction unavailable or unsupported. Original catalog categories retained; verify them before confirming.',
        );
      }
      warnings.push(
        'Shipping, fit and dimensions require verification. A public URL does not establish store ownership.',
      );
      return MerchantProfileSchema.parse({
        id: newId('prof_'),
        merchant,
        domain,
        sampleOrigin: 'live',
        offers,
        confirmed: false,
        capturedAt,
        warnings,
      });
    },
  };
}
