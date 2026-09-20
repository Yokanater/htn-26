/** Layered public product-page extraction. Owner: L1.
 * Pure: reads HTML a browser session already loaded and returns only facts the page states.
 * Strategy order: JSON-LD, Shopify embedded state, product meta tags. `factsFromShopifyProductJson`
 * covers the same-origin `product.js` fallback. Unknown facts stay null/unknown, a variant ID is
 * only copied from an explicit field (never read out of a title), and a price range is not a price.
 */

import { cleanJsonLdText, collectJsonLdNodes, extractJsonLdBlocks, hasJsonLdType } from './jsonld';

export type ProductPageStrategy =
  | 'json_ld'
  | 'shopify_state'
  | 'meta_tags'
  | 'shopify_js'
  | 'model_page_text';

export type ProductPageAvailability = 'available' | 'unavailable' | 'unknown';

export type ProductPageVariant = {
  /** Explicit merchant variant identifier, or null when the page states only a product offer. */
  variantId: string | null;
  title: string | null;
  /** Minor units. Null whenever the page does not state a single exact amount. */
  amountMinorUnits: number | null;
  /** Variant-level currency; callers fall back to the page currency, then to the merchant's. */
  currency: string | null;
  availability: ProductPageAvailability;
  attributes: Record<string, string>;
  imageUrl: string | null;
};

export type ProductPageFacts = {
  strategy: ProductPageStrategy;
  productId: string | null;
  title: string | null;
  imageUrl: string | null;
  currency: string | null;
  canonicalUrl: string | null;
  shopifySignalsPresent: boolean;
  variants: ProductPageVariant[];
};

// Bound parsing, not the catalogue's final candidate count. Colour × size matrices routinely
// exceed twelve variants; truncating here drops the requested variant before it can be ranked.
const MAX_VARIANTS = 500;
const MAX_TITLE_CHARS = 200;
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
/** Page titles append the store name after one of these; the product name comes first. */
const TITLE_SEPARATOR = /\s+(?:\||–|—|·|»|:|-)\s+/;
const TITLE_BOILERPLATE = new Set([
  'officialsite',
  'officialstore',
  'onlinestore',
  'shop',
  'shopnow',
  'store',
  'home',
  'freeshipping',
  'buyonline',
]);

/** Marketplaces write `&amp;` into `og:title`; a shopper must never read the escape. */
export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/gi,
      (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match,
    );
}

/** Drops the store-name segment a page title appends, keeping the product name it starts with. */
export function productTitle(raw: unknown, finalUrl: string): string | null {
  if (typeof raw !== 'string') return null;
  const decoded = decodeHtmlEntities(raw).replace(/\s+/g, ' ').trim();
  if (!decoded) return null;
  let brand = '';
  try {
    brand =
      new URL(finalUrl).hostname
        .replace(/^www\./, '')
        .split('.')[0]
        ?.toLowerCase() ?? '';
  } catch {
    brand = '';
  }
  const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const parts = decoded
    .split(TITLE_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
  const kept = parts.filter((part, index) => {
    if (index === 0) return true;
    const normalized = key(part);
    if (TITLE_BOILERPLATE.has(normalized)) return false;
    return !(brand.length > 2 && normalized.startsWith(brand));
  });
  return (kept.join(' · ') || decoded).slice(0, MAX_TITLE_CHARS);
}
const ZERO_DECIMAL = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

export function currencyExponent(currency: string): number {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

function normalizeCurrency(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/** Accepts `45`, `"45.00"`, `"1,234.56"` and `"1.234,56"`; rejects anything else. */
function parseMajorAmount(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : null;
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[^\d.,]/g, '').trim();
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const normalized =
    lastComma > lastDot ? cleaned.replace(/\./g, '').replace(/,/, '.') : cleaned.replace(/,/g, '');
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function majorToMinorUnits(major: number | null, currency: string | null): number | null {
  if (major === null || !currency) return null;
  return Math.round(major * 10 ** currencyExponent(currency));
}

export function normalizeAvailability(raw: unknown): ProductPageAvailability {
  const token =
    typeof raw === 'boolean'
      ? raw
        ? 'instock'
        : 'outofstock'
      : typeof raw === 'string'
        ? (raw.split(/[/#]/).pop() ?? '')
            .trim()
            .toLowerCase()
            .replace(/[\s_-]/g, '')
        : '';
  if (['instock', 'instoreonly', 'limitedavailability', 'onlineonly'].includes(token)) {
    return 'available';
  }
  if (['outofstock', 'soldout', 'discontinued'].includes(token)) return 'unavailable';
  return 'unknown';
}

function absoluteHttpsUrl(raw: unknown, base: string): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const decoded = decodeHtmlEntities(raw.trim());
    const url = new URL(decoded.startsWith('//') ? `https:${decoded}` : decoded, base);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function firstImageUrl(raw: unknown, base: string, depth = 0): string | null {
  if (depth > 4 || raw === null || raw === undefined) return null;
  if (typeof raw === 'string') return absoluteHttpsUrl(raw, base);
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const found = firstImageUrl(item, base, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    return firstImageUrl(record.url ?? record.contentUrl ?? record.src, base, depth + 1);
  }
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

/** The `variant` query parameter is an explicit merchant identifier, not an inference. */
function variantIdFromUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const value = new URL(raw, 'https://placeholder.invalid').searchParams.get('variant');
    return value?.trim() || null;
  } catch {
    return null;
  }
}

function metaContent(html: string, names: readonly string[]): string | null {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tag = html.match(
      new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]*>`, 'i'),
    )?.[0];
    const content = tag?.match(/content=(["'])([\s\S]*?)\1/i)?.[2];
    if (content?.trim()) return decodeHtmlEntities(content).trim();
  }
  return null;
}

function documentTitle(html: string): string | null {
  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return raw?.trim() ? raw : null;
}

function canonicalFromHtml(html: string, base: string): string | null {
  const tag = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0];
  const href = tag?.match(/href=["']([^"']*)["']/i)?.[1];
  return absoluteHttpsUrl(href, base) ?? absoluteHttpsUrl(metaContent(html, ['og:url']), base);
}

export function hasShopifyPageSignals(html: string): boolean {
  return (
    /cdn\.shopify\.com/i.test(html) ||
    /Shopify\.theme/i.test(html) ||
    /ShopifyAnalytics/i.test(html) ||
    /<meta[^>]+name=["']shopify["']/i.test(html)
  );
}

/**
 * Page-level currency, only from a tag or global that states the *price* currency. A bare
 * `"currency"` somewhere in the markup can belong to another market, so an unstated currency
 * stays unknown instead of mislabelling an amount.
 */
function detectPageCurrency(html: string): string | null {
  return (
    normalizeCurrency(
      metaContent(html, [
        'product:price:currency',
        'og:price:currency',
        'product:sale_price:currency',
        'priceCurrency',
      ]),
    ) ??
    normalizeCurrency(
      html.match(/Shopify\.currency\s*=\s*\{[^}]*"active"\s*:\s*"([A-Z]{3})"/i)?.[1],
    ) ??
    normalizeCurrency(html.match(/"shop_currency"\s*:\s*"([A-Z]{3})"/i)?.[1])
  );
}

/** Image the page advertises for itself, used when the winning layer states none of its own. */
function metaImageUrl(html: string, finalUrl: string): string | null {
  return absoluteHttpsUrl(
    metaContent(html, [
      'og:image:secure_url',
      'og:image',
      'twitter:image',
      'twitter:image:src',
      'image',
    ]),
    finalUrl,
  );
}

function metaAvailability(html: string): ProductPageAvailability {
  return normalizeAvailability(
    metaContent(html, ['product:availability', 'og:availability', 'availability']),
  );
}

function metaProductTitle(html: string, finalUrl: string): string | null {
  return productTitle(
    metaContent(html, ['og:title', 'twitter:title']) ?? documentTitle(html),
    finalUrl,
  );
}

function dedupeVariants(variants: ProductPageVariant[]): ProductPageVariant[] {
  const seen = new Set<string>();
  const out: ProductPageVariant[] = [];
  for (const variant of variants) {
    // Without an explicit ID, a second indistinguishable offer cannot be claimed as a variant.
    const key = variant.variantId ?? `unspecified:${variant.title ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(variant);
    if (out.length >= MAX_VARIANTS) break;
  }
  return out;
}

function attributesFromJsonLd(
  ...nodes: readonly Record<string, unknown>[]
): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const node of nodes) {
    for (const key of ['size', 'color', 'material', 'pattern']) {
      const value = firstString(node[key]);
      if (value && !attributes[key]) attributes[key] = value.slice(0, 80);
    }
    const extra = node.additionalProperty;
    for (const property of Array.isArray(extra) ? extra : [extra]) {
      if (!property || typeof property !== 'object') continue;
      const record = property as Record<string, unknown>;
      const name = firstString(record.name)?.toLowerCase();
      const value = firstString(record.value);
      if (name && value && !attributes[name]) attributes[name] = value.slice(0, 80);
    }
  }
  return attributes;
}

function jsonLdOfferNodes(product: Record<string, unknown>): Record<string, unknown>[] {
  const nodes = collectJsonLdNodes(product.offers);
  const offers = nodes.filter((node) => hasJsonLdType(node, 'offer'));
  if (offers.length > 0) return offers;
  return nodes.filter((node) => hasJsonLdType(node, 'aggregateoffer'));
}

function variantFromJsonLdOffer(
  offer: Record<string, unknown>,
  product: Record<string, unknown>,
  base: string,
  currencyHint: string | null,
): ProductPageVariant {
  const specifications = Array.isArray(offer.priceSpecification)
    ? offer.priceSpecification
    : [offer.priceSpecification];
  const specification = (
    specifications.length === 1 && specifications[0] && typeof specifications[0] === 'object'
      ? specifications[0]
      : {}
  ) as Record<string, unknown>;
  const currency =
    normalizeCurrency(offer.priceCurrency) ??
    normalizeCurrency(specification.priceCurrency) ??
    currencyHint;
  const low = parseMajorAmount(offer.lowPrice);
  const high = parseMajorAmount(offer.highPrice);
  // A low/high range states no single amount unless both ends agree.
  const rangeAmount = low !== null && high !== null && low === high ? low : null;
  const amount =
    parseMajorAmount(offer.price) ?? parseMajorAmount(specification.price) ?? rangeAmount;
  return {
    variantId:
      variantIdFromUrl(offer.url) ??
      firstString(
        offer.sku,
        offer.gtin13,
        offer.gtin12,
        offer.gtin,
        offer.mpn,
        offer.productID,
        product.sku,
      ),
    title: cleanJsonLdText(offer.name, 120) || null,
    amountMinorUnits: majorToMinorUnits(amount, currency),
    currency,
    availability: normalizeAvailability(offer.availability ?? offer.itemAvailability),
    attributes: attributesFromJsonLd(offer, product),
    imageUrl: firstImageUrl(offer.image, base),
  };
}

function fromJsonLd(html: string, finalUrl: string): ProductPageFacts | null {
  const blocks = extractJsonLdBlocks(html);
  if (blocks.length === 0) return null;
  const nodes = blocks.flatMap((block) => collectJsonLdNodes(block));
  const products = nodes.filter((node) => hasJsonLdType(node, 'product'));
  const canonical = canonicalFromHtml(html, finalUrl) ?? finalUrl;
  const pageTitle = metaProductTitle(html, finalUrl)?.toLowerCase();
  const samePage = (raw: unknown) => {
    if (typeof raw !== 'string') return false;
    try {
      return new URL(raw, finalUrl).pathname === new URL(canonical).pathname;
    } catch {
      return false;
    }
  };
  const groups = nodes.filter((node) => hasJsonLdType(node, 'productgroup'));
  const group =
    groups.find((node) => samePage(node.url) || samePage(node['@id'])) ??
    (groups.length === 1 ? groups[0] : undefined);
  // A related-product carousel may put its Product before the current page's Product.
  const product =
    group ??
    products.find((node) => samePage(node.url) || samePage(node['@id'])) ??
    products.find(
      (node) => typeof node.name === 'string' && node.name.toLowerCase() === pageTitle,
    ) ??
    (products.length === 1 ? products[0] : undefined);
  if (!product) return null;
  const currencyHint = detectPageCurrency(html);
  if (group && Array.isArray(group.hasVariant)) {
    const variants = dedupeVariants(
      group.hasVariant.flatMap((variant) => {
        if (!variant || typeof variant !== 'object') return [];
        const merged = { ...group, ...variant };
        return jsonLdOfferNodes(variant).map((offer) =>
          variantFromJsonLdOffer(offer, merged, finalUrl, currencyHint),
        );
      }),
    );
    if (variants.length)
      return {
        strategy: 'json_ld',
        productId: firstString(group.productGroupID, group.sku),
        title: productTitle(group.name, finalUrl),
        imageUrl: firstImageUrl(group.image, finalUrl),
        currency: variants.find((variant) => variant.currency)?.currency ?? currencyHint,
        canonicalUrl: canonicalFromHtml(html, finalUrl),
        shopifySignalsPresent: hasShopifyPageSignals(html),
        variants,
      };
  }
  let offers = jsonLdOfferNodes(product);
  if (offers.length === 0 && products.length === 1) {
    // `@graph` documents often keep the Offer beside its single Product.
    offers = nodes.filter((node) => hasJsonLdType(node, 'offer'));
  }
  const variants = dedupeVariants(
    offers.map((offer) => variantFromJsonLdOffer(offer, product, finalUrl, currencyHint)),
  );
  return {
    strategy: 'json_ld',
    productId: firstString(product.productID, product.sku, product.mpn, product.gtin13),
    title: productTitle(cleanJsonLdText(product.name, MAX_TITLE_CHARS), finalUrl),
    imageUrl: firstImageUrl(product.image, finalUrl),
    currency: variants.find((variant) => variant.currency)?.currency ?? currencyHint,
    canonicalUrl: canonicalFromHtml(html, finalUrl),
    shopifySignalsPresent: hasShopifyPageSignals(html),
    variants,
  };
}

/** Balanced-brace object starting at `from`, so nested Shopify state is not truncated. */
function balancedObject(source: string, from: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  const end = Math.min(source.length, from + 400_000);
  for (let index = from; index < end; index++) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return source.slice(from, index + 1);
    }
  }
  return null;
}

function shopifyStateCandidates(html: string): unknown[] {
  const out: unknown[] = [];
  for (const match of html.matchAll(
    /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const parsed: unknown = JSON.parse(match[1] ?? 'null');
      if (parsed) out.push(parsed);
    } catch {
      // Themes also embed non-product JSON; a bad block proves nothing.
    }
  }
  for (const pattern of [
    /var\s+meta\s*=\s*\{/i,
    /ShopifyAnalytics\s*\.\s*meta\s*=\s*\{/i,
    /window\.__pdp\s*=\s*\{/i,
  ]) {
    const match = html.match(pattern);
    if (match?.index === undefined) continue;
    const raw = balancedObject(html, html.indexOf('{', match.index));
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed) out.push(parsed);
    } catch {
      // Not strict JSON (JS object literal): skip rather than guess.
    }
  }
  return out;
}

type ShopifyVariantLike = {
  id: unknown;
  title?: unknown;
  name?: unknown;
  public_title?: unknown;
  sku?: unknown;
  price?: unknown;
  available?: unknown;
  option1?: unknown;
  option2?: unknown;
  option3?: unknown;
  featured_image?: unknown;
};

type ShopifyProductLike = {
  id?: unknown;
  handle?: unknown;
  title?: unknown;
  featured_image?: unknown;
  images?: unknown;
  options?: unknown;
  variants: ShopifyVariantLike[];
};

function asShopifyProduct(value: unknown): ShopifyProductLike | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const nested = record.product;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const fromNested = asShopifyProduct(nested);
    if (fromNested) return fromNested;
  }
  const variants = record.variants;
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const usable = variants.filter(
    (variant): variant is ShopifyVariantLike =>
      !!variant &&
      typeof variant === 'object' &&
      firstString((variant as ShopifyVariantLike).id) !== null,
  );
  if (usable.length === 0) return null;
  return { ...record, variants: usable } as ShopifyProductLike;
}

function shopifyOptionNames(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options
    .map((option) =>
      typeof option === 'string'
        ? option
        : option && typeof option === 'object'
          ? firstString((option as Record<string, unknown>).name)
          : null,
    )
    .map((name) => (typeof name === 'string' ? name.trim().toLowerCase() : ''))
    .filter(Boolean);
}

/**
 * Shopify product JSON (embedded state or `product.js`). Variant prices are already minor units;
 * the storefront currency is not part of this payload, so callers resolve it separately.
 */
export function factsFromShopifyProductJson(
  value: unknown,
  finalUrl: string,
  options: { strategy?: ProductPageStrategy; currency?: string | null } = {},
): ProductPageFacts | null {
  const product = asShopifyProduct(value);
  if (!product) return null;
  const optionNames = shopifyOptionNames(product.options);
  const variants = dedupeVariants(
    product.variants.map((variant) => {
      const attributes: Record<string, string> = {};
      const values = [variant.option1, variant.option2, variant.option3];
      optionNames.forEach((name, index) => {
        const optionValue = firstString(values[index]);
        if (optionValue) attributes[name] = optionValue.slice(0, 80);
      });
      const price = variant.price;
      const amount =
        typeof price === 'number'
          ? Number.isInteger(price)
            ? price
            : Math.round(price)
          : typeof price === 'string' && /^\d+$/.test(price.trim())
            ? Number(price.trim())
            : null;
      return {
        variantId: firstString(variant.id),
        title: firstString(variant.public_title, variant.title, variant.name),
        amountMinorUnits: amount,
        currency: options.currency ?? null,
        availability:
          typeof variant.available === 'boolean'
            ? normalizeAvailability(variant.available)
            : 'unknown',
        attributes,
        imageUrl: firstImageUrl(variant.featured_image, finalUrl),
      } satisfies ProductPageVariant;
    }),
  );
  if (variants.length === 0) return null;
  return {
    strategy: options.strategy ?? 'shopify_js',
    productId: firstString(product.id, product.handle),
    title: productTitle(product.title, finalUrl),
    imageUrl: firstImageUrl(product.featured_image ?? product.images, finalUrl),
    currency: options.currency ?? null,
    canonicalUrl: null,
    shopifySignalsPresent: true,
    variants,
  };
}

function fromShopifyState(html: string, finalUrl: string): ProductPageFacts | null {
  const currency = detectPageCurrency(html);
  for (const candidate of shopifyStateCandidates(html)) {
    const facts = factsFromShopifyProductJson(candidate, finalUrl, {
      strategy: 'shopify_state',
      currency,
    });
    if (facts) return { ...facts, canonicalUrl: canonicalFromHtml(html, finalUrl) };
  }
  return null;
}

function fromMetaTags(html: string, finalUrl: string): ProductPageFacts | null {
  const title = metaProductTitle(html, finalUrl);
  const canonicalUrl = canonicalFromHtml(html, finalUrl);
  const currency = detectPageCurrency(html);
  const amount = parseMajorAmount(
    metaContent(html, ['product:price:amount', 'og:price:amount', 'price']),
  );
  const availability = metaAvailability(html);
  const imageUrl = metaImageUrl(html, finalUrl);
  const productId = metaContent(html, ['product:retailer_item_id', 'product:sku', 'og:sku', 'sku']);
  const minor = majorToMinorUnits(amount, currency);
  // A title alone is not a product: every page has one. Require a stated price, or a page that
  // declares itself a product offer, so an About or blog page never becomes an offer.
  const declaresProduct =
    (metaContent(html, ['og:type'])?.toLowerCase() ?? '').startsWith('product') ||
    productId !== null ||
    availability !== 'unknown';
  if (minor === null && !declaresProduct) return null;
  if (!title && minor === null) return null;
  return {
    strategy: 'meta_tags',
    productId,
    title,
    imageUrl,
    currency,
    canonicalUrl,
    shopifySignalsPresent: hasShopifyPageSignals(html),
    variants: [
      {
        variantId: variantIdFromUrl(canonicalUrl ?? finalUrl),
        title: null,
        amountMinorUnits: minor,
        currency,
        availability,
        attributes: {},
        imageUrl,
      },
    ],
  };
}

/**
 * Deterministic public facts from a loaded product page, or null when no layer recognizes it.
 * An empty `variants` array means the page named a product but stated no offer.
 */
export function extractProductFacts(input: {
  html: string;
  finalUrl: string;
}): ProductPageFacts | null {
  const html = input.html ?? '';
  if (!html.trim()) return null;
  let recognized: ProductPageFacts | null = null;
  for (const layer of [fromJsonLd, fromShopifyState, fromMetaTags]) {
    const facts = layer(html, input.finalUrl);
    if (!facts) continue;
    if (facts.variants.length > 0) return withPageFallbacks(facts, html, input.finalUrl);
    // A named product with no stated offer: keep looking for a layer that has one.
    recognized ??= facts;
  }
  return recognized ? withPageFallbacks(recognized, html, input.finalUrl) : null;
}

/**
 * Structured data routinely omits the title, image or stock state that the same page states in its
 * meta tags. Filling those in from the page itself keeps the facts complete without inventing any:
 * the page-level stock state is trusted only when the page describes a single offer.
 */
export function withPageFallbacks(
  facts: ProductPageFacts,
  html: string,
  finalUrl: string,
): ProductPageFacts {
  const pageAvailability = facts.variants.length === 1 ? metaAvailability(html) : 'unknown';
  return {
    ...facts,
    title: facts.title ?? metaProductTitle(html, finalUrl),
    imageUrl: facts.imageUrl ?? metaImageUrl(html, finalUrl),
    variants: facts.variants.map((variant) => ({
      ...variant,
      availability: variant.availability === 'unknown' ? pageAvailability : variant.availability,
    })),
  };
}
