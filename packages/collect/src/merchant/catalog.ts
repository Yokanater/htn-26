/** Bounded Shopify storefront inventory. Editorial Product markup is not a catalog. */
import type { ShoppingContext } from '@sei/core';
import { z } from 'zod';
import type { CatalogHit } from '../normalize';
import { currencyExponent } from '../product-page';
import { fetchPublicHttps, type SafeFetchDeps, UrlSafetyError } from '../url-safety';

const identifier = z.union([z.string().min(1), z.number().int().positive()]);
const Product = z.object({
  id: identifier,
  handle: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  title: z.string().trim().min(1),
  product_type: z.string().default(''),
  images: z.array(z.object({ src: z.string() })).default([]),
  variants: z
    .array(
      z.object({
        id: identifier,
        price: z.union([z.string(), z.number()]).nullable().optional(),
        available: z.boolean().optional(),
      }),
    )
    .min(1),
});

function category(type: string, title: string): string {
  const categories: Array<[string, RegExp]> = [
    ['socks', /\b(socks?|hosiery)\b/],
    ['supplements', /\b(protein|creatine|supplements?|pre[- ]?workout|electrolytes?)\b/],
    [
      'fitness equipment',
      /\b(pull[- ]?up bars?|dumbbells?|kettlebells?|resistance bands?|weight benches?|gym equipment|training equipment)\b/,
    ],
    ['recovery equipment', /\b(foam rollers?|massage guns?|recovery equipment)\b/],
    ['skincare', /\b(skincare|serums?|moisturi[sz]ers?|cleansers?|sunscreens?)\b/],
    [
      'makeup',
      /\b(makeup|cosmetics?|lip|lipsticks?|mascaras?|foundations?|concealers?|blush|bronzers?|highlighters?|eyeshadows?)\b/,
    ],
    ['fragrance', /\b(fragrances?|perfumes?|eau de parfum|colognes?)\b/],
    ['beauty tools', /\b(beauty tools?|makeup brushes?|applicators?|sponges?|mirrors?)\b/],
    ['lighting', /\b(lamps?|lighting|pendants?)\b/],
    ['desk', /\b(desks?|workstations?)\b/],
    ['bag', /\b(bags?|backpacks?|totes?|handbags?)\b/],
    [
      'footwear',
      /\b(shoes?|boots?|sneakers?|sandals?|heels?|flats?|ballerinas?|loafers?|pumps?)\b/,
    ],
    [
      'bottom',
      /\b(pants?|jeans?|trousers?|shorts?|skirts?|leggings?|joggers?|tights?|underwear|boxers?)\b/,
    ],
    [
      'top',
      /\b(shirts?|jackets?|tops?|blouses?|sweaters?|hoodies?|coats?|pullovers?|sports bras?|bras?|tanks?|tees?|t-shirts?|crop tops?)\b/,
    ],
    ['accessories', /\b(accessories|headwear|caps?|hats?|beanies?|water bottles?)\b/],
    ['furniture', /\b(chairs?|tables?|sofas?|shelving)\b/],
    ['headphones', /\b(headphones?|earbuds?)\b/],
  ];
  for (const text of [type, title]) {
    const found = categories.find(([, pattern]) => pattern.test(text.toLowerCase()));
    if (found) return found[0];
  }
  return type.trim().toLowerCase() || 'unknown';
}

export async function readStorefrontCatalog(
  origin: string,
  html: string,
  context: ShoppingContext,
  deps: SafeFetchDeps,
): Promise<CatalogHit[]> {
  const hits: CatalogHit[] = [];
  const seen = new Set<string>();
  const currency =
    /Shopify\.currency\s*=\s*\{\s*["']?active["']?\s*:\s*["']([A-Z]{3})["']/.exec(html)?.[1] ??
    null;
  for (let page = 1; page <= 3; page++) {
    context.consume('fetch', 1);
    const url = `${origin}/products.json?limit=50&page=${page}`;
    const fetched = await fetchPublicHttps(url, deps, {
      signal: context.signal,
      timeoutMs: 45_000,
      maxBytes: 2_000_000,
      acceptContentTypes: ['application/json'],
    });
    if (fetched.url.origin !== origin || fetched.url.pathname !== '/products.json') {
      throw new UrlSafetyError(
        'catalog_unavailable',
        'The catalog redirected away from this store.',
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder().decode(fetched.body));
    } catch {
      throw new UrlSafetyError(
        'catalog_unavailable',
        'The store did not return a product catalog.',
      );
    }
    const parsed = z.object({ products: z.array(z.unknown()).max(50) }).safeParse(raw);
    if (!parsed.success)
      throw new UrlSafetyError(
        'catalog_unavailable',
        'The store did not return a product catalog.',
      );
    let added = 0;
    for (const item of parsed.data.products) {
      const result = Product.safeParse(item);
      if (!result.success) continue;
      const product = result.data;
      if (seen.has(String(product.id))) continue;
      seen.add(String(product.id));
      added++;
      for (const variant of product.variants.slice(0, 20)) {
        const amount =
          variant.price === null || variant.price === undefined || variant.price === ''
            ? NaN
            : Number(variant.price);
        const minor = currency ? Math.round(amount * 10 ** currencyExponent(currency)) : NaN;
        hits.push({
          merchant: { name: new URL(origin).hostname, domain: new URL(origin).hostname },
          productId: String(product.id),
          variantId: String(variant.id),
          title: product.title,
          category: category(product.product_type, product.title),
          productUrl: `${origin}/products/${product.handle}`,
          imageUrl: product.images[0]?.src ?? null,
          price:
            currency && Number.isSafeInteger(minor) && minor >= 0
              ? { amount: minor, currency }
              : null,
          availability:
            variant.available === undefined
              ? 'unknown'
              : variant.available
                ? 'available'
                : 'unavailable',
          shipsTo: null,
          attributes: {},
          evidenceUrl: fetched.url.href,
          evidenceMethod: 'fetch',
        });
      }
    }
    if (parsed.data.products.length < 50 || added === 0) break;
  }
  return hits;
}
