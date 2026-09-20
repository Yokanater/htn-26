/** Live Browserbase catalog research. Owner: L4 (composition of L1 adapters).
 * Search only discovers candidate pages; every displayed fact comes from a page this run read and
 * validated. Bounded by construction: one shared browser session, a per-slot share of the run's
 * fetch budget so no slot can starve another, and run-scoped page/currency caches so a repeated
 * URL or merchant costs nothing. Unknown facts stay unknown — nothing is inferred to fill a field.
 */
import { lookup as resolveDns } from 'node:dns/promises';
import {
  assertPublicHttpsUrl,
  type BrowserbaseCatalogBrowser,
  type BrowserbaseCatalogBrowserFactory,
  type BrowserbaseProductSearch,
  type BrowserbaseProductSearchResult,
  type DnsLookup,
  extractProductFacts,
  factsFromShopifyProductJson,
  hasShopifyPageSignals,
  openBrowserbaseCatalogBrowser,
  type ProductPageFacts,
  searchBrowserbaseProducts,
  stablePrefixedId,
  UrlSafetyError,
} from '@sei/collect';
import {
  type IntentBrief,
  type IntentSlot,
  type ProductEvidence,
  type ProductOffer,
  ProductOfferSchema,
  type SampleOrigin,
} from '@sei/contracts';
import type { ProductQuery, ShoppingCatalog, ShoppingContext } from '@sei/core';
import { BudgetExhaustedError, DEFAULT_RUN_CAPS } from '@sei/pipeline';

const SEARCH_RESULTS_PER_QUERY = 6;
const CANDIDATES_PER_QUERY = 3;
const OFFERS_PER_PRODUCT = 2;
const OFFERS_PER_SLOT = 8;
const VERIFY_CONCURRENCY = 2;
const MAX_QUERY_CHARS = 120;
/** Marks an offer the page stated at product level, with no merchant variant identifier. */
const UNSPECIFIED_VARIANT = 'unspecified';

/** Fixed failure codes. Never a provider message. */
export type CandidateFailure =
  | 'discovery_empty'
  | 'unsafe_url'
  | 'navigation_failed'
  | 'unsupported_product_page'
  | 'invalid_product_shape'
  | 'no_explicit_offer'
  | 'budget_exhausted'
  | 'cancelled';

const UNSAFE_URL_CODES = new Set([
  'invalid_url',
  'https_required',
  'credentials_forbidden',
  'hostname_blocked',
  'private_address',
]);

const COUNTRY_NAMES: Record<string, string> = {
  AU: 'Australia',
  CA: 'Canada',
  DE: 'Germany',
  ES: 'Spain',
  FR: 'France',
  GB: 'United Kingdom',
  IE: 'Ireland',
  IN: 'India',
  IT: 'Italy',
  JP: 'Japan',
  MX: 'Mexico',
  NL: 'Netherlands',
  NZ: 'New Zealand',
  SE: 'Sweden',
  SG: 'Singapore',
  US: 'United States',
};

/** Audience terms are used only when the confirmed brief states one. Order: narrowest first. */
const AUDIENCES: ReadonlyArray<{ term: string; pattern: RegExp; conflict: RegExp | null }> = [
  { term: 'kids', pattern: /\b(kids?|children|child|toddler|boys?|girls?)\b/i, conflict: null },
  {
    term: 'women',
    pattern: /\b(women'?s?|woman|female|ladies)\b/i,
    conflict: /\b(men'?s|male)\b/i,
  },
  { term: 'men', pattern: /\b(men'?s?|male)\b/i, conflict: /\b(women'?s|woman|female|ladies)\b/i },
  { term: 'unisex', pattern: /\bunisex\b/i, conflict: null },
];

const PRODUCT_PATH = /\/(products?|p|dp|item|items|shop|collections)\//i;

export type LiveCatalogDeps = {
  searchProducts?: BrowserbaseProductSearch;
  openBrowser?: BrowserbaseCatalogBrowserFactory;
  lookup?: DnsLookup;
  now?: () => Date;
  /** The run's `fetch` cap, shared out per slot. Defaults to the pipeline's documented cap. */
  fetchBudget?: number;
  /** Page reads in flight at once; stays at or below the runner's configured concurrency. */
  verifyConcurrency?: number;
};

type PageOutcome =
  | { ok: true; facts: ProductPageFacts; pageUrl: string; host: string }
  | { ok: false; failure: CandidateFailure };

function countryName(code: string): string {
  return COUNTRY_NAMES[code.toUpperCase()] ?? code.toUpperCase();
}

function slotWords(slot: IntentSlot): string {
  return `${slot.description} ${slot.visualAttributes.join(' ')}`;
}

function detectAudience(slot: IntentSlot): (typeof AUDIENCES)[number] | null {
  const text = slotWords(slot);
  return AUDIENCES.find((audience) => audience.pattern.test(text)) ?? null;
}

/** Shopper-meaningful constraint terms only; negations and mounting hurt recall, so they are dropped. */
function constraintTerms(slot: IntentSlot): string[] {
  const terms: string[] = [];
  for (const constraint of slot.constraints) {
    if (constraint.kind === 'size') terms.push(`size ${constraint.value}`);
    else if (constraint.kind === 'dimension') terms.push(`${constraint.maxCm} cm`);
  }
  return terms.slice(0, 2);
}

export function buildSearchQuery(input: {
  slot: IntentSlot;
  text: string;
  country: string;
  fallback?: boolean;
}): string {
  const audience = detectAudience(input.slot)?.term;
  const parts = input.fallback
    ? [audience, input.slot.category, countryName(input.country)]
    : [audience, input.text, ...constraintTerms(input.slot), countryName(input.country)];
  const seen = new Set<string>();
  const words: string[] = [];
  for (const word of parts.filter(Boolean).join(' ').split(/\s+/)) {
    const key = word.toLowerCase();
    if (!word || seen.has(key)) continue;
    seen.add(key);
    words.push(word);
  }
  return words.join(' ').slice(0, MAX_QUERY_CHARS).trim();
}

/** Deduplicated HTTPS candidates, product-shaped paths first, discovery order preserved. */
export function candidateUrls(
  results: readonly BrowserbaseProductSearchResult[],
  limit: number,
): string[] {
  const ranked = new Map<string, number>();
  for (const result of results) {
    try {
      const url = new URL(result.url);
      if (url.protocol !== 'https:' || url.username || url.password) continue;
      if (url.pathname === '/' || url.pathname === '') continue;
      url.search = '';
      url.hash = '';
      if (!ranked.has(url.href)) ranked.set(url.href, PRODUCT_PATH.test(url.pathname) ? 0 : 1);
    } catch {
      // Search results are untrusted input; a malformed URL is simply not a candidate.
    }
  }
  return [...ranked.entries()]
    .sort(([, left], [, right]) => left - right)
    .map(([href]) => href)
    .slice(0, limit);
}

/**
 * Per-slot reservations plus a FIFO page-read lane.
 *
 * Each slot owns `floor(budget / slots)` product-page reads (at least one) that no other slot can
 * take, so one slot cannot drain the run. The remainder is a shared pool, released only once every
 * required slot has had an attempt. The lane keeps reads interleaved across concurrent searches.
 */
export function createFetchShare(
  slots: readonly IntentSlot[],
  budget: number,
  concurrency: number,
) {
  const count = Math.max(1, slots.length);
  const perSlot = Math.max(1, Math.floor(Math.max(0, budget) / count));
  const quota = new Map(slots.map((slot) => [slot.id, perSlot]));
  const required = slots.filter((slot) => slot.required).map((slot) => slot.id);
  const attempted = new Set<string>();
  const settled = new Set<string>();
  let pool = Math.max(0, budget - perSlot * slots.length);
  const queue: Array<() => void> = [];
  let active = 0;
  const pump = () => {
    while (active < concurrency && queue.length > 0) {
      const start = queue.shift();
      if (!start) return;
      active += 1;
      start();
    }
  };
  const requiredCovered = () => required.every((id) => attempted.has(id) || settled.has(id));
  return {
    perSlot,
    /** Whether a claim would succeed, so a search that cannot verify anything is never sent. */
    available(slotId: string): boolean {
      return (quota.get(slotId) ?? 0) > 0 || (pool > 0 && requiredCovered());
    },
    claim(slotId: string): boolean {
      const own = quota.get(slotId) ?? 0;
      if (own > 0) {
        quota.set(slotId, own - 1);
        attempted.add(slotId);
        return true;
      }
      if (pool > 0 && requiredCovered()) {
        pool -= 1;
        attempted.add(slotId);
        return true;
      }
      return false;
    },
    /** This slot no longer needs a reserved attempt to be held for it. */
    settle(slotId: string): void {
      settled.add(slotId);
    },
    async lane<T>(work: () => Promise<T>): Promise<T> {
      await new Promise<void>((resolve) => {
        queue.push(resolve);
        pump();
      });
      try {
        return await work();
      } finally {
        active -= 1;
        pump();
      }
    },
  };
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    ((error as { name: string }).name === 'AbortError' ||
      (error as { name: string }).name === 'TimeoutError')
  );
}

function classifyFailure(error: unknown, signal: AbortSignal): CandidateFailure {
  if (signal.aborted || isAbortError(error)) return 'cancelled';
  if (error instanceof BudgetExhaustedError) return 'budget_exhausted';
  if (error instanceof UrlSafetyError) {
    return UNSAFE_URL_CODES.has(error.code) ? 'unsafe_url' : 'navigation_failed';
  }
  return 'navigation_failed';
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function withoutQuery(href: string): string {
  const url = new URL(href);
  url.search = '';
  url.hash = '';
  return url.href;
}

function urlHandle(href: string): string {
  const segments = new URL(href).pathname.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? 'product';
}

const log = (level: 'info' | 'warn', payload: Record<string, unknown>): void => {
  (level === 'warn' ? console.warn : console.info)('[catalog]', JSON.stringify(payload));
};

/** Search discovers pages; verified public page facts supply every displayed product fact. */
export function liveCatalog(
  brief: IntentBrief,
  env: Record<string, string | undefined>,
  deps: LiveCatalogDeps = {},
): Pick<ShoppingCatalog, 'search'> & { close(): Promise<void> } {
  const searchProducts = deps.searchProducts ?? searchBrowserbaseProducts;
  const openBrowser = deps.openBrowser ?? openBrowserbaseCatalogBrowser;
  const lookup: DnsLookup = deps.lookup ?? ((host) => resolveDns(host, { all: true }));
  const now = deps.now ?? (() => new Date());
  const share = createFetchShare(
    brief.slots,
    deps.fetchBudget ?? DEFAULT_RUN_CAPS.fetch,
    deps.verifyConcurrency ?? VERIFY_CONCURRENCY,
  );
  const searchCache = new Map<string, Promise<ProductOffer[]>>();
  const pageCache = new Map<string, Promise<PageOutcome>>();
  const currencyCache = new Map<string, Promise<string | null>>();
  const fallbackUsed = new Set<string>();
  const offersBySlot = new Map<string, number>();
  let browserPromise: Promise<BrowserbaseCatalogBrowser> | undefined;

  const getBrowser = (context: ShoppingContext) => {
    if (!browserPromise) {
      context.consume('browser_session', 1);
      browserPromise = openBrowser({
        apiKey: env.BROWSERBASE_API_KEY!,
        signal: context.signal,
      }).then((browser) => {
        log('info', { event: 'browserbase_session_opened', sessionId: browser.sessionId });
        return browser;
      });
      browserPromise.catch(() => {
        browserPromise = undefined;
      });
    }
    return browserPromise;
  };

  /** Same-origin Shopify `product.js`, tried only after the page itself yielded no offer. */
  const shopifyJsFacts = async (
    safe: URL,
    html: string,
    slot: IntentSlot,
    context: ShoppingContext,
    browser: BrowserbaseCatalogBrowser,
  ): Promise<{ facts: ProductPageFacts } | { failure: CandidateFailure } | null> => {
    if (safe.pathname.endsWith('.js')) return null;
    // Spend a second read only on a storefront that says it is Shopify, or when the document
    // could not be serialized at all and the path is a Shopify product route.
    const blindProductPath = html.trim() === '' && /\/products\//i.test(safe.pathname);
    if (!hasShopifyPageSignals(html) && !blindProductPath) return null;
    if (!share.claim(slot.id)) return { failure: 'budget_exhausted' };
    const jsUrl = new URL(safe.href);
    jsUrl.pathname = `${jsUrl.pathname.replace(/\/$/, '')}.js`;
    try {
      const checked = await assertPublicHttpsUrl(jsUrl.href, lookup);
      context.consume('fetch', 1);
      const page = await share.lane(() => browser.readPage(checked.href, context.signal));
      await assertPublicHttpsUrl(page.finalUrl, lookup);
      const parsed = parseJsonObject(page.text);
      if (!parsed) return { failure: 'invalid_product_shape' };
      const facts = factsFromShopifyProductJson(parsed, safe.href, { strategy: 'shopify_js' });
      return facts ? { facts } : { failure: 'invalid_product_shape' };
    } catch (error) {
      if (context.signal.aborted || isAbortError(error)) throw error;
      if (error instanceof BudgetExhaustedError) throw error;
      if (error instanceof UrlSafetyError) return { failure: 'unsafe_url' };
      // The page exposed no product facts by any supported route.
      return { failure: 'unsupported_product_page' };
    }
  };

  /** Storefront currency, at most one lookup per merchant per run, and only when still unknown. */
  const merchantCurrency = (
    host: string,
    base: string,
    slot: IntentSlot,
    context: ShoppingContext,
    browser: BrowserbaseCatalogBrowser,
  ): Promise<string | null> => {
    const cached = currencyCache.get(host);
    if (cached) return cached;
    const work = (async () => {
      if (!share.claim(slot.id)) return null;
      try {
        const cartUrl = await assertPublicHttpsUrl(new URL('/cart.js', base).href, lookup);
        context.consume('fetch', 1);
        const page = await share.lane(() => browser.readPage(cartUrl.href, context.signal));
        await assertPublicHttpsUrl(page.finalUrl, lookup);
        const parsed = parseJsonObject(page.text);
        const currency = (parsed as { currency?: unknown } | null)?.currency;
        return typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : null;
      } catch {
        // Price stays unknown when the storefront currency cannot be verified.
        return null;
      }
    })();
    currencyCache.set(host, work);
    return work;
  };

  const readCandidate = (
    candidate: string,
    slot: IntentSlot,
    context: ShoppingContext,
    browser: BrowserbaseCatalogBrowser,
  ): Promise<PageOutcome> => {
    const cached = pageCache.get(candidate);
    if (cached) return cached;
    const work = (async (): Promise<PageOutcome> => {
      try {
        const safe = await assertPublicHttpsUrl(candidate, lookup);
        context.consume('fetch', 1);
        const page = await share.lane(() => browser.readPage(safe.href, context.signal));
        const settled = await assertPublicHttpsUrl(page.finalUrl, lookup);
        const direct = extractProductFacts({ html: page.html, finalUrl: settled.href });
        if (direct && direct.variants.length > 0) {
          return {
            ok: true,
            facts: direct,
            pageUrl: withoutQuery(direct.canonicalUrl ?? settled.href),
            host: settled.hostname,
          };
        }
        const fallback = await shopifyJsFacts(settled, page.html, slot, context, browser);
        if (fallback && 'facts' in fallback) {
          return {
            ok: true,
            facts: fallback.facts,
            pageUrl: withoutQuery(settled.href),
            host: settled.hostname,
          };
        }
        if (fallback) return { ok: false, failure: fallback.failure };
        return { ok: false, failure: direct ? 'no_explicit_offer' : 'unsupported_product_page' };
      } catch (error) {
        return { ok: false, failure: classifyFailure(error, context.signal) };
      }
    })();
    pageCache.set(candidate, work);
    return work;
  };

  const buildOffers = (input: {
    slot: IntentSlot;
    outcome: Extract<PageOutcome, { ok: true }>;
    currency: string | null;
    sampleOrigin: SampleOrigin;
  }): ProductOffer[] => {
    const { slot, outcome } = input;
    const { facts, pageUrl, host } = outcome;
    const capturedAt = now().toISOString();
    const productId = facts.productId ?? urlHandle(pageUrl);
    const merchant = {
      id: stablePrefixedId('mer_', host),
      name: host.replace(/^www\./, ''),
      domain: host,
    };
    const offers: ProductOffer[] = [];
    for (const variant of facts.variants) {
      if (offers.length >= OFFERS_PER_PRODUCT) break;
      if (variant.availability === 'unavailable') continue;
      const currency = variant.currency ?? facts.currency ?? input.currency;
      const price =
        variant.amountMinorUnits !== null && currency
          ? { amount: variant.amountMinorUnits, currency }
          : null;
      const variantTitle =
        variant.title && variant.title !== 'Default Title' ? variant.title : null;
      const title = [facts.title, variantTitle].filter(Boolean).join(' · ') || urlHandle(pageUrl);
      const productUrl =
        variant.variantId && facts.shopifySignalsPresent
          ? `${pageUrl}?variant=${encodeURIComponent(variant.variantId)}`
          : pageUrl;
      const fields: Array<[string, string]> = [['source_strategy', facts.strategy]];
      if (facts.title) fields.push(['title', facts.title]);
      if (variantTitle) fields.push(['variant', variantTitle]);
      if (variant.variantId) fields.push(['variant_id', variant.variantId]);
      if (price) fields.push(['price', `${price.amount} minor units ${price.currency}`]);
      if (variant.availability !== 'unknown') fields.push(['availability', variant.availability]);
      for (const [key, value] of Object.entries(variant.attributes)) fields.push([key, value]);
      const evidence: ProductEvidence[] = fields.map(([field, value]) => ({
        id: stablePrefixedId('ev_', `${productUrl}:${field}:${value}`),
        field,
        value,
        url: pageUrl,
        capturedAt,
        method: 'browser' as const,
      }));
      const parsed = ProductOfferSchema.safeParse({
        id: stablePrefixedId('offer_', `${host}::${productId}::${variant.variantId ?? productUrl}`),
        merchant,
        productId,
        variantId: variant.variantId ?? UNSPECIFIED_VARIANT,
        title,
        category: slot.category,
        productUrl,
        imageUrl: variant.imageUrl ?? facts.imageUrl,
        price,
        availability: variant.availability,
        shipsTo: null,
        attributes: variant.attributes,
        sampleOrigin: input.sampleOrigin,
        evidence,
      });
      if (parsed.success) offers.push(parsed.data);
    }
    return offers;
  };

  const rank = (slot: IntentSlot, offers: readonly ProductOffer[]): ProductOffer[] => {
    const audience = detectAudience(slot);
    const requested = slot.constraints.find((constraint) => constraint.kind === 'size');
    const normalize = (value: string) =>
      value
        .toLowerCase()
        .trim()
        .replace(/^extra small$/, 'xs')
        .replace(/^extra large$/, 'xl')
        .replace(/^medium$/, 'm')
        .replace(/^large$/, 'l')
        .replace(/^small$/, 's');
    const words = new Set(
      slotWords(slot)
        .toLowerCase()
        .match(/[a-z]{3,}/g) ?? [],
    );
    const score = (offer: ProductOffer) => {
      const title = new Set(offer.title.toLowerCase().match(/[a-z]{3,}/g) ?? []);
      const sizeMatch =
        requested?.kind === 'size' &&
        normalize(String(offer.attributes.size)) === normalize(requested.value);
      const priced = offer.price ? 5 : 0;
      return (sizeMatch ? 100 : 0) + priced + [...words].filter((word) => title.has(word)).length;
    };
    const perProduct = new Map<string, number>();
    return (
      [...offers]
        // An explicitly requested audience excludes the opposite one; nothing else is filtered.
        .filter((offer) => !audience?.conflict?.test(offer.title))
        .sort((left, right) => score(right) - score(left) || left.id.localeCompare(right.id))
        .filter((offer) => {
          const key = `${offer.merchant.id}:${offer.productId}`;
          const count = perProduct.get(key) ?? 0;
          perProduct.set(key, count + 1);
          return count < OFFERS_PER_PRODUCT;
        })
        .slice(0, OFFERS_PER_SLOT)
    );
  };

  const runSearch = async (
    query: ProductQuery,
    context: ShoppingContext,
    slot: IntentSlot,
  ): Promise<ProductOffer[]> => {
    const apiKey = env.BROWSERBASE_API_KEY!;
    const collected: ProductOffer[] = [];
    const failures = new Set<CandidateFailure>();
    let candidateCount = 0;
    let verifiedCount = 0;
    let usedFallback = false;
    let sessionId: string | null = null;

    for (const fallback of [false, true] as const) {
      if (fallback) {
        if (collected.length > 0 || fallbackUsed.has(slot.id)) break;
        try {
          context.consume('catalog_query', 1);
        } catch {
          failures.add('budget_exhausted');
          break;
        }
        fallbackUsed.add(slot.id);
        usedFallback = true;
      }
      if (!share.available(slot.id)) {
        // Nothing could be verified, so the live search call is not worth making.
        failures.add('budget_exhausted');
        break;
      }
      const text = buildSearchQuery({
        slot,
        text: query.text,
        country: query.country,
        fallback,
      });
      let results: BrowserbaseProductSearchResult[];
      try {
        results = await searchProducts({
          apiKey,
          query: text,
          limit: SEARCH_RESULTS_PER_QUERY,
          signal: context.signal,
        });
      } catch (error) {
        const failure = classifyFailure(error, context.signal);
        if (failure === 'cancelled') throw error;
        failures.add(failure);
        continue;
      }
      const candidates = candidateUrls(results, CANDIDATES_PER_QUERY);
      candidateCount += candidates.length;
      if (candidates.length === 0) {
        failures.add('discovery_empty');
        continue;
      }
      const browser = await getBrowser(context);
      sessionId = browser.sessionId;
      for (const candidate of candidates) {
        context.signal.throwIfAborted();
        if (collected.length >= OFFERS_PER_SLOT) break;
        if (!pageCache.has(candidate) && !share.claim(slot.id)) {
          failures.add('budget_exhausted');
          log('warn', {
            event: 'slot_budget_exhausted',
            slotId: slot.id,
            category: slot.category,
            stage: 'slot_reservation',
            sessionId,
          });
          break;
        }
        const outcome = await readCandidate(candidate, slot, context, browser);
        if (!outcome.ok) {
          failures.add(outcome.failure);
          if (outcome.failure === 'cancelled') context.signal.throwIfAborted();
          log('warn', {
            event: 'candidate_rejected',
            slotId: slot.id,
            category: slot.category,
            host: new URL(candidate).hostname,
            failure: outcome.failure,
            sessionId,
          });
          if (outcome.failure === 'budget_exhausted') break;
          continue;
        }
        const needsCurrency =
          !outcome.facts.currency &&
          outcome.facts.variants.some((variant) => variant.amountMinorUnits !== null) &&
          outcome.facts.shopifySignalsPresent;
        const currency = needsCurrency
          ? await merchantCurrency(outcome.host, outcome.pageUrl, slot, context, browser)
          : null;
        const built = buildOffers({
          slot,
          outcome,
          currency,
          sampleOrigin: context.sampleOrigin,
        });
        if (built.length === 0) {
          failures.add('no_explicit_offer');
          continue;
        }
        verifiedCount += 1;
        collected.push(...built);
      }
    }

    share.settle(slot.id);
    const offers = rank(slot, collected);
    const slotTotal = (offersBySlot.get(slot.id) ?? 0) + offers.length;
    offersBySlot.set(slot.id, slotTotal);
    log('info', {
      event: 'slot_discovery',
      slotId: slot.id,
      category: slot.category,
      candidates: candidateCount,
      verifiedProducts: verifiedCount,
      offers: offers.length,
      usedFallback,
      failures: [...failures],
      sessionId,
    });
    // A slot left with nothing because the budget ran out must say so, not look merely empty.
    if (slotTotal === 0 && failures.has('budget_exhausted')) {
      throw new BudgetExhaustedError('fetch');
    }
    return offers;
  };

  return {
    async search(query, context) {
      if (context.sampleOrigin !== 'live' || brief.sampleOrigin !== 'live') {
        throw new Error('Live discovery requires a live brief');
      }
      context.signal.throwIfAborted();
      const cacheKey = JSON.stringify([query.slotId, query.text, query.country, query.currency]);
      const cached = searchCache.get(cacheKey);
      if (cached) return cached;
      const work = (async () => {
        context.consume('catalog_query', 1);
        const slot = brief.slots.find((candidate) => candidate.id === query.slotId);
        if (!slot || !env.BROWSERBASE_API_KEY) return [];
        return runSearch(query, context, slot);
      })();
      searchCache.set(cacheKey, work);
      return work;
    },
    async close() {
      const browser = await browserPromise?.catch(() => undefined);
      browserPromise = undefined;
      await browser?.close();
    },
  };
}
