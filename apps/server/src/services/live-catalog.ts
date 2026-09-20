import { lookup } from 'node:dns/promises';
import {
  assertPublicHttpsUrl,
  type BrowserbaseCatalogBrowser,
  type BrowserbaseCatalogBrowserFactory,
  type BrowserbaseProductSearch,
  openBrowserbaseCatalogBrowser,
  searchBrowserbaseProducts,
  stablePrefixedId,
} from '@sei/collect';
import { type IntentBrief, type ProductOffer, ProductOfferSchema } from '@sei/contracts';
import type { ShoppingCatalog, ShoppingContext } from '@sei/core';
import { z } from 'zod';

const Product = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  title: z.string(),
  url: z.string().optional(),
  featured_image: z.string().nullable().optional(),
  options: z
    .array(z.union([z.string(), z.object({ name: z.string(), position: z.number() })]))
    .default([]),
  variants: z.array(
    z.object({
      id: z.union([z.number(), z.string()]).transform(String),
      title: z.string(),
      available: z.boolean().default(false),
      price: z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]),
      option1: z.string().nullable().optional(),
      option2: z.string().nullable().optional(),
      option3: z.string().nullable().optional(),
      featured_image: z
        .union([z.string().transform((src) => ({ src })), z.object({ src: z.string() })])
        .nullable()
        .optional(),
    }),
  ),
});

function parseBrowserJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('Browserbase page did not contain a JSON object.');
  }
}

export type LiveCatalogDeps = {
  searchProducts?: BrowserbaseProductSearch;
  openBrowser?: BrowserbaseCatalogBrowserFactory;
};

/** Search discovers pages; verified storefront JSON supplies every displayed product fact. */
export function liveCatalog(
  brief: IntentBrief,
  env: Record<string, string | undefined>,
  deps: LiveCatalogDeps = {},
): Pick<ShoppingCatalog, 'search'> & { close(): Promise<void> } {
  const searchProducts = deps.searchProducts ?? searchBrowserbaseProducts;
  const openBrowser = deps.openBrowser ?? openBrowserbaseCatalogBrowser;
  const cache = new Map<string, Promise<ProductOffer[]>>();
  let browserPromise: Promise<BrowserbaseCatalogBrowser> | undefined;
  const getBrowser = (context: ShoppingContext) => {
    if (!browserPromise) {
      context.consume('browser_session', 1);
      browserPromise = openBrowser({
        apiKey: env.BROWSERBASE_API_KEY!,
        signal: context.signal,
      }).then((browser) => {
        console.info(
          '[catalog]',
          JSON.stringify({ event: 'browserbase_session_opened', sessionId: browser.sessionId }),
        );
        return browser;
      });
      browserPromise.catch(() => {
        browserPromise = undefined;
      });
    }
    return browserPromise;
  };
  return {
    async search(query, context) {
      if (context.sampleOrigin !== 'live' || brief.sampleOrigin !== 'live') {
        throw new Error('Live discovery requires a live brief');
      }
      context.signal.throwIfAborted();
      const cacheKey = JSON.stringify([query.slotId, query.text, query.country, query.currency]);
      const cached = cache.get(cacheKey);
      if (cached) return cached;
      const work = (async () => {
        context.consume('catalog_query', 1);
        const slot = brief.slots.find((s) => s.id === query.slotId);
        if (!slot || !env.BROWSERBASE_API_KEY) return [];
        const results = await searchProducts({
          apiKey: env.BROWSERBASE_API_KEY,
          query: [
            query.text,
            slot.category,
            slot.description,
            Object.values(slot.visualAttributes).join(' '),
            slot.constraints.map((constraint) => JSON.stringify(constraint)).join(' '),
            'inurl:products',
          ]
            .filter(Boolean)
            .join(' '),
          limit: 4,
          signal: context.signal,
        });
        const urls = new Set<string>();
        for (const result of results) {
          try {
            const url = new URL(result.url);
            if (url.protocol === 'https:' && /\/products\/[^/]+/.test(url.pathname)) {
              url.search = '';
              url.hash = '';
              urls.add(url.href);
            }
          } catch {
            // Search results are untrusted; malformed/non-product URLs are ignored.
          }
        }
        const offers: ProductOffer[] = [];
        if (urls.size === 0) return offers;
        const browser = await getBrowser(context);
        const verified = await Promise.allSettled(
          [...urls].slice(0, 4).map(async (raw) => {
            context.consume('fetch', 1);
            const url = new URL(raw);
            url.pathname = `${url.pathname.replace(/\/$/, '')}.js`;
            const safeProductUrl = await assertPublicHttpsUrl(url.href, (host) =>
              lookup(host, { all: true }),
            );
            const page = await browser.readPage(safeProductUrl.href, context.signal);
            const finalProductUrl = await assertPublicHttpsUrl(page.finalUrl, (host) =>
              lookup(host, { all: true }),
            );
            const product = Product.parse(parseBrowserJson(page.text));
            let currency: string | null = null;
            try {
              context.consume('fetch', 1);
              const cartUrl = await assertPublicHttpsUrl(new URL('/cart.js', raw).href, (host) =>
                lookup(host, { all: true }),
              );
              const cart = await browser.readPage(cartUrl.href, context.signal);
              await assertPublicHttpsUrl(cart.finalUrl, (host) => lookup(host, { all: true }));
              const parsed = z
                .object({ currency: z.string().regex(/^[A-Z]{3}$/) })
                .parse(parseBrowserJson(cart.text));
              currency = parsed.currency;
            } catch {
              /* Price remains unknown if storefront currency cannot be verified. */
            }
            const capturedAt = new Date().toISOString();
            const sizeIndex = product.options.findIndex((option) =>
              /size/i.test(typeof option === 'string' ? option : option.name),
            );
            for (const variant of product.variants.filter((v) => v.available)) {
              const size =
                sizeIndex >= 0
                  ? [variant.option1, variant.option2, variant.option3][sizeIndex]
                  : null;
              const image = variant.featured_image?.src || product.featured_image;
              const imageUrl = image
                ? new URL(image.startsWith('//') ? `https:${image}` : image, raw).href
                : null;
              const productUrl = `${raw}?variant=${variant.id}`;
              const fields: Record<string, string> = {
                title: product.title,
                variant: variant.title,
                availability: 'available',
              };
              if (size) fields.size = size;
              if (currency) fields.price = `${variant.price} minor units ${currency}`;
              const offer = ProductOfferSchema.parse({
                id: stablePrefixedId('offer_', productUrl),
                merchant: {
                  id: stablePrefixedId('mer_', url.hostname),
                  name: url.hostname.replace(/^www\./, ''),
                  domain: url.hostname,
                },
                productId: product.id,
                variantId: variant.id,
                title: `${product.title}${variant.title === 'Default Title' ? '' : ` · ${variant.title}`}`,
                category: slot.category,
                productUrl,
                imageUrl,
                price: currency ? { amount: variant.price, currency } : null,
                availability: 'available',
                shipsTo: null,
                attributes: size ? { size } : {},
                sampleOrigin: context.sampleOrigin,
                evidence: Object.entries(fields).map(([field, value]) => ({
                  id: stablePrefixedId('ev_', `${productUrl}:${field}`),
                  field,
                  value,
                  url: finalProductUrl.href,
                  capturedAt,
                  method: 'browser',
                })),
              });
              offers.push(offer);
            }
          }),
        );
        for (const [index, result] of verified.entries()) {
          if (result.status === 'rejected') {
            let host = 'unknown';
            try {
              host = new URL([...urls][index] ?? '').hostname;
            } catch {
              // The URL was already validated above; keep this log defensive and data-minimal.
            }
            console.warn(
              '[catalog]',
              JSON.stringify({
                event: 'browserbase_product_rejected',
                host,
                reason:
                  result.reason instanceof z.ZodError
                    ? 'invalid_product_shape'
                    : result.reason instanceof Error
                      ? result.reason.message.slice(0, 160)
                      : 'unknown_error',
              }),
            );
          }
        }
        // Rank verified variants by the user's words; keep the result set diverse.
        const requested = slot.constraints.find((c) => c.kind === 'size');
        const normalize = (s: string) =>
          s
            .toLowerCase()
            .trim()
            .replace(/^extra small$/, 'xs')
            .replace(/^extra large$/, 'xl')
            .replace(/^medium$/, 'm')
            .replace(/^large$/, 'l')
            .replace(/^small$/, 's');
        const words = new Set(
          `${slot.description} ${Object.values(slot.visualAttributes).join(' ')}`
            .toLowerCase()
            .match(/[a-z]{3,}/g) ?? [],
        );
        const score = (offer: ProductOffer) => {
          const title = new Set(offer.title.toLowerCase().match(/[a-z]{3,}/g) ?? []);
          const sizeMatch =
            requested?.kind === 'size' &&
            normalize(String(offer.attributes.size)) === normalize(requested.value);
          return (sizeMatch ? 100 : 0) + [...words].filter((word) => title.has(word)).length;
        };
        offers.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
        const perProduct = new Map<string, number>();
        return offers
          .filter((offer) => {
            const key = `${offer.merchant.id}:${offer.productId}`;
            const count = perProduct.get(key) ?? 0;
            perProduct.set(key, count + 1);
            return count < 2;
          })
          .slice(0, 8);
      })();
      cache.set(cacheKey, work);
      return work;
    },
    async close() {
      const browser = await browserPromise?.catch(() => undefined);
      browserPromise = undefined;
      await browser?.close();
    },
  };
}
