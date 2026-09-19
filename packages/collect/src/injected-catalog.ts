/** Injected ShoppingCatalog composition for L4. Owner: L1 (stable integration closure).
 * Composes validated offers and/or CatalogHit sources through normalizeCatalogInventory.
 * Does not change @sei/core ShoppingCatalog.search return type (still ProductOffer[]).
 * Production code must not read repository JSON; callers inject validated data.
 */
import type { ProductOffer, SampleOrigin } from '@sei/contracts';
import type { ProductQuery, ShoppingCatalog, ShoppingContext } from '@sei/core';
import { MAX_OFFERS_PER_SLOT } from './limits';
import {
  type CatalogHit,
  CatalogIdentityRegistry,
  normalizeCatalogInventory,
  normalizeMerchantDomain,
} from './normalize';

export { MAX_OFFERS_PER_SLOT } from './limits';

export type CatalogHitSource = (
  query: ProductQuery,
  context: ShoppingContext,
) => Promise<readonly unknown[]> | readonly unknown[];

export type CreateInjectedShoppingCatalogOptions = {
  /** Already-validated offers. Cloned into a stable inventory; never mutated in place. */
  offers?: readonly ProductOffer[];
  /**
   * Static CatalogHit-shaped objects normalized once at construction (uncapped inventory).
   * Use for synthetic/fake examples in tests — not live provider recordings.
   */
  hits?: readonly unknown[];
  /**
   * Per-query hit source. Results are normalized into inventory (uncapped) then filtered;
   * the eight-offer cap applies only to search() results.
   */
  hitSource?: CatalogHitSource;
  /** sampleOrigin used when normalizing hits (defaults to context.sampleOrigin at query time). */
  sampleOrigin?: SampleOrigin;
  capturedAt?: string;
};

function offerKey(offer: ProductOffer): string {
  return `${offer.merchant.domain}::${offer.productId}::${offer.variantId}`;
}

function matchesQuery(offer: ProductOffer, query: ProductQuery): boolean {
  const haystack = [
    offer.title,
    offer.category,
    offer.merchant.name,
    offer.merchant.domain,
    ...Object.entries(offer.attributes).map(([k, v]) => `${k} ${v}`),
  ]
    .join(' ')
    .toLowerCase();
  const terms = query.text
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (terms.length === 0) return true;
  return terms.some((term) => haystack.includes(term));
}

function countryCompatible(offer: ProductOffer, country: string): boolean {
  if (offer.shipsTo === null) return true;
  return offer.shipsTo.includes(country);
}

function currencyCompatible(offer: ProductOffer, currency: string): boolean {
  if (offer.price === null) return true;
  return offer.price.currency === currency;
}

function mergeOffers(
  base: readonly ProductOffer[],
  extra: readonly ProductOffer[],
): ProductOffer[] {
  const byKey = new Map<string, ProductOffer>();
  for (const offer of base) {
    byKey.set(offerKey(offer), offer);
  }
  for (const offer of extra) {
    const key = offerKey(offer);
    if (!byKey.has(key)) {
      byKey.set(key, offer);
    }
  }
  return [...byKey.values()];
}

function selectOffers(inventory: readonly ProductOffer[], query: ProductQuery): ProductOffer[] {
  const requested = query.limit;
  const limit =
    !Number.isFinite(requested) || requested <= 0 ? 0 : Math.min(requested, MAX_OFFERS_PER_SLOT);
  return inventory
    .filter((offer) => matchesQuery(offer, query))
    .filter((offer) => countryCompatible(offer, query.country))
    .filter((offer) => currencyCompatible(offer, query.currency))
    .sort((a, b) => offerKey(a).localeCompare(offerKey(b)))
    .slice(0, limit)
    .map((offer) => structuredClone(offer));
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason ?? new Error('Catalog operation was cancelled.');
  }
}

/**
 * Stable injected ShoppingCatalog for L4 wiring.
 * - offers and/or static hits build an uncapped base inventory at construction
 * - optional hitSource merges additional normalized hits per call (shared identity registry)
 * - search still returns ProductOffer[] only (B6 partial-failure gate unchanged)
 * - MAX_OFFERS_PER_SLOT applies only to each search() result slice
 */
export function createInjectedShoppingCatalog(
  options: CreateInjectedShoppingCatalogOptions = {},
): ShoppingCatalog {
  const constructionOrigin = options.sampleOrigin ?? 'seed';
  const identity = new CatalogIdentityRegistry();
  const baseFromOffers = (options.offers ?? []).map((offer) => structuredClone(offer));
  const fromHits =
    options.hits && options.hits.length > 0
      ? normalizeCatalogInventory([...options.hits], {
          sampleOrigin: constructionOrigin,
          capturedAt: options.capturedAt,
          identity,
        }).offers
      : [];
  const baseInventory = mergeOffers(baseFromOffers, fromHits);

  async function loadDynamicHits(
    query: ProductQuery,
    context: ShoppingContext,
  ): Promise<ProductOffer[]> {
    if (!options.hitSource) return [];
    throwIfAborted(context.signal);
    const raw = await options.hitSource(query, context);
    throwIfAborted(context.signal);
    return normalizeCatalogInventory([...raw], {
      sampleOrigin: options.sampleOrigin ?? context.sampleOrigin,
      capturedAt: options.capturedAt,
      identity,
    }).offers;
  }

  return {
    async search(query: ProductQuery, context: ShoppingContext): Promise<ProductOffer[]> {
      throwIfAborted(context.signal);
      context.consume('catalog_query', 1);
      throwIfAborted(context.signal);

      const dynamic = await loadDynamicHits(query, context);
      const inventory = mergeOffers(baseInventory, dynamic);
      return selectOffers(inventory, query);
    },

    async profileMerchant(domain: string, context: ShoppingContext) {
      throwIfAborted(context.signal);
      context.consume('catalog_query', 1);
      throwIfAborted(context.signal);

      const normalized = normalizeMerchantDomain(domain);
      let inventory = baseInventory;

      if (options.hitSource) {
        const dynamic = await loadDynamicHits(
          {
            slotId: 'slot_profile',
            text: normalized,
            country: 'CA',
            currency: 'CAD',
            limit: MAX_OFFERS_PER_SLOT,
          },
          context,
        );
        inventory = mergeOffers(baseInventory, dynamic);
      }

      const domainOffers = inventory
        .filter((offer) => offer.merchant.domain === normalized)
        .map((offer) => structuredClone(offer));
      if (domainOffers.length === 0) {
        throw new Error(`No catalog offers available for merchant domain: ${normalized}`);
      }

      const merchant = structuredClone(domainOffers[0]!.merchant);
      for (const offer of domainOffers) {
        offer.merchant = structuredClone(merchant);
      }
      return { merchant, offers: domainOffers };
    },
  };
}

/** Prefer createInjectedShoppingCatalog; kept as a thin offers-only wrapper. */
export function createFixtureShoppingCatalog(offers: readonly ProductOffer[]): ShoppingCatalog {
  return createInjectedShoppingCatalog({ offers, sampleOrigin: 'seed' });
}

export type { CatalogHit };
