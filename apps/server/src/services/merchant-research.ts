/** Catalog-based bundle and brand research. Uses the existing verified product discovery API. */
import { searchBrowserbaseProducts } from '@sei/collect';
import {
  type IntentBrief,
  IntentBriefSchema,
  type MerchantResearch,
  type MerchantResearchRequest,
  MerchantResearchSchema,
  type ProductOffer,
  type ResearchedBrand,
} from '@sei/contracts';
import type { EnvLike, ShoppingCatalog, ShoppingContext } from '@sei/core';
import { loadSeedOffers } from '../replay';
import { liveCatalog } from './live-catalog';

type ResearchCatalog = Pick<ShoppingCatalog, 'search'> & { close(): Promise<void> };
export type ResearchCatalogFactory = (brief: IntentBrief, sourceDomain: string) => ResearchCatalog;

export class MerchantResearchError extends Error {
  constructor(
    readonly code: string,
    readonly status: 409 | 422 | 503 | 504,
    message: string,
  ) {
    super(message);
    this.name = 'MerchantResearchError';
  }
}

const PAIRINGS: Record<
  string,
  { domain: 'outfit' | 'setup'; complements: string[]; reason: string }
> = {
  footwear: {
    domain: 'outfit',
    complements: ['bag', 'socks'],
    reason: 'Pair shoes with a bag or socks for a coordinated outfit.',
  },
  top: {
    domain: 'outfit',
    complements: ['bottom', 'bag'],
    reason: 'Pair a top with bottoms or a bag to complete an outfit.',
  },
  bottom: {
    domain: 'outfit',
    complements: ['top', 'footwear'],
    reason: 'Pair bottoms with a top or shoes.',
  },
  bag: {
    domain: 'outfit',
    complements: ['footwear', 'top'],
    reason: 'Pair a bag with shoes or a top.',
  },
  socks: {
    domain: 'outfit',
    complements: ['footwear', 'bag'],
    reason: 'Pair socks with shoes; a bag is another possible add-on.',
  },
  accessories: {
    domain: 'outfit',
    complements: ['top', 'bag'],
    reason: 'Add accessories to a clothing or bag collection.',
  },
  desk: {
    domain: 'setup',
    complements: ['lighting', 'chair'],
    reason: 'Combine a desk, task lighting and seating for a workspace.',
  },
  lighting: {
    domain: 'setup',
    complements: ['desk', 'chair'],
    reason: 'Pair task lighting with a desk or seating.',
  },
  chair: {
    domain: 'setup',
    complements: ['desk', 'lighting'],
    reason: 'Combine seating with a desk or task lighting.',
  },
  furniture: {
    domain: 'setup',
    complements: ['lighting', 'rug'],
    reason: 'Pair furniture with lighting or a rug for a room setup.',
  },
  headphones: {
    domain: 'setup',
    complements: ['desk', 'lighting'],
    reason: 'Pair headphones with desk accessories for a work setup.',
  },
  camera: {
    domain: 'setup',
    complements: ['tripod', 'bag'],
    reason: 'Pair a camera with a tripod or protective bag.',
  },
  kitchenware: {
    domain: 'setup',
    complements: ['tableware', 'kitchen linens'],
    reason: 'Pair kitchenware with tableware or kitchen linens.',
  },
};

/** Prefer the store's category over ambiguous title words such as "short" in a sock name. */
export function researchCategory(raw: string): string {
  const value = raw.toLowerCase().trim();
  if (
    /\b(shoes?|footwear|boots?|sandals?|heels?|flats?|loafers?|ballerinas?|sneakers?|pumps?)\b/.test(
      value,
    )
  )
    return 'footwear';
  if (/\b(socks?|hosiery)\b/.test(value)) return 'socks';
  if (/\b(bags?|handbags?|backpacks?|totes?)\b/.test(value)) return 'bag';
  if (/\b(lighting|lamps?)\b/.test(value)) return 'lighting';
  if (/\b(desks?|workstations?)\b/.test(value)) return 'desk';
  if (/\b(chairs?|seating)\b/.test(value)) return 'chair';
  if (/\b(tops?|shirts?|jackets?|coats?|sweaters?|blouses?)\b/.test(value)) return 'top';
  if (/\b(bottoms?|pants?|trousers?|jeans?|shorts?|skirts?)\b/.test(value)) return 'bottom';
  return value;
}

const host = (value: string) => value.toLowerCase().replace(/^www\./, '');
const sameStore = (a: string, b: string) =>
  host(a) === host(b) || host(a).endsWith(`.${host(b)}`) || host(b).endsWith(`.${host(a)}`);

function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function distinctProducts(offers: readonly ProductOffer[]): ProductOffer[] {
  const products = new Map<string, ProductOffer>();
  for (const offer of offers) {
    const key = `${host(offer.merchant.domain)}:${offer.productId}`;
    const previous = products.get(key);
    if (!previous || (previous.availability !== 'available' && offer.availability === 'available'))
      products.set(key, offer);
  }
  return [...products.values()];
}

function groups(
  offers: ProductOffer[],
  reason: (products: ProductOffer[]) => string,
): ResearchedBrand[] {
  const byHost = new Map<string, ProductOffer[]>();
  for (const offer of distinctProducts(offers)) {
    const key = host(offer.merchant.domain);
    byHost.set(key, [...(byHost.get(key) ?? []), offer].slice(0, 8));
  }
  return [...byHost.values()]
    .slice(0, 6)
    .map((products) => ({ merchant: products[0]!.merchant, products, reason: reason(products) }));
}

export function createMerchantResearch(
  env: EnvLike,
  options: { openCatalog?: ResearchCatalogFactory; now?: () => Date; timeoutMs?: number } = {},
) {
  let busy = false;
  const openCatalog: ResearchCatalogFactory =
    options.openCatalog ??
    ((brief, sourceDomain) => {
      const attempts = new Map<string, number>();
      return liveCatalog(brief, env, {
        fetchBudget: 24,
        minimumBrands: 3,
        searchProducts: (input) => {
          const query = input.query.replace(/\bfootwear\b/gi, 'shoes');
          const attempt = attempts.get(query) ?? 0;
          attempts.set(query, attempt + 1);
          return searchBrowserbaseProducts({
            ...input,
            query: `${query} ${attempt === 0 ? 'inurl:products' : 'buy online'} -site:${sourceDomain}`,
          });
        },
      });
    });
  return {
    async research(
      offers: ProductOffer[],
      request: MerchantResearchRequest,
      callerSignal: AbortSignal,
    ): Promise<MerchantResearch> {
      if (busy)
        throw new MerchantResearchError(
          'MERCHANT_RESEARCH_BUSY',
          409,
          'A brand search is already running. Wait for it to finish.',
        );
      const own = distinctProducts(offers);
      const source = own[0];
      if (!source)
        throw new MerchantResearchError('CATALOG_UNAVAILABLE', 422, 'Analyze your store first.');
      const counts = new Map<string, number>();
      own.forEach((offer) => {
        const key = researchCategory(offer.category);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      });
      const category = request.category
        ? researchCategory(request.category)
        : [...counts].sort((a, b) => b[1] - a[1])[0]![0];
      if (!counts.has(category))
        throw new MerchantResearchError(
          'INVALID_CATEGORY',
          422,
          'Choose a category from your store catalog.',
        );
      const pairing = PAIRINGS[category];
      const complements = pairing?.complements ?? [];
      const live = source.sampleOrigin === 'live';
      if (live && !options.openCatalog && !env.BROWSERBASE_API_KEY?.trim())
        throw new MerchantResearchError(
          'MERCHANT_RESEARCH_DISABLED',
          503,
          'Brand search is not configured on this server.',
        );
      busy = true;
      const timeout = AbortSignal.timeout(options.timeoutMs ?? 150_000);
      const signal = AbortSignal.any([callerSignal, timeout]);
      let catalog: ResearchCatalog | undefined;
      const gaps: string[] = [];
      const categories = [...complements, category];
      try {
        const brief = IntentBriefSchema.parse({
          id: 'brief_merchant_research',
          revision: 1,
          status: 'confirmed',
          domain: pairing?.domain ?? 'setup',
          input: { kind: 'text', text: `Public catalog research for ${category}.` },
          slots: categories.map((target, index) => ({
            id: `slot_merchant_${index}`,
            category: target,
            description: target,
            required: true,
            visualAttributes: [],
            constraints: [],
          })),
          country: request.country,
          currency: request.currency,
          itemBudget: null,
          sampleOrigin: source.sampleOrigin,
          createdAt: (options.now?.() ?? new Date()).toISOString(),
        });
        const remaining: Record<string, number> = {
          catalog_query: 6,
          fetch: 24,
          browser_session: 1,
          model_call: 0,
        };
        const context: ShoppingContext = {
          signal,
          sampleOrigin: source.sampleOrigin,
          consume(resource, amount) {
            signal.throwIfAborted();
            remaining[resource] = (remaining[resource] ?? 0) - amount;
            if (remaining[resource]! < 0) throw new Error('Merchant research budget exhausted');
          },
        };
        catalog = live
          ? openCatalog(brief, source.merchant.domain)
          : {
              search: async (query) =>
                loadSeedOffers().filter(
                  (offer) => researchCategory(offer.category) === researchCategory(query.text),
                ),
              close: async () => {},
            };
        const found = new Map<string, ProductOffer[]>();
        for (const slot of brief.slots) {
          if (signal.aborted) {
            gaps.push('Search stopped before all categories were checked.');
            break;
          }
          try {
            const result = await untilAborted(
              catalog.search(
                {
                  slotId: slot.id,
                  text: slot.category,
                  country: request.country,
                  currency: request.currency,
                  limit: 8,
                },
                context,
              ),
              signal,
            );
            signal.throwIfAborted();
            const verified = distinctProducts(result).filter((offer) => {
              try {
                const url = new URL(offer.productUrl);
                return (
                  offer.sampleOrigin === source.sampleOrigin &&
                  !sameStore(offer.merchant.domain, source.merchant.domain) &&
                  host(url.hostname) === host(offer.merchant.domain) &&
                  url.protocol === 'https:' &&
                  !/\/(blogs?|articles?|news|stories)(\/|$)/i.test(url.pathname) &&
                  offer.evidence.some(
                    (item) =>
                      item.field === 'product_record' ||
                      (item.field === 'source_strategy' && item.method === 'browser'),
                  ) &&
                  researchCategory(offer.category) === slot.category
                );
              } catch {
                return false;
              }
            });
            found.set(slot.category, verified);
            if (verified.length === 0)
              gaps.push(`No products from other stores found for ${slot.category}.`);
          } catch {
            gaps.push(`Could not finish the ${slot.category} search.`);
          }
        }
        if (callerSignal.aborted) throw callerSignal.reason;
        if (!pairing)
          gaps.push(
            'No bundle categories are configured for this product type. Competitor search is available.',
          );
        const complementary = complements.flatMap((target) => found.get(target) ?? []);
        const partners = groups(
          complementary,
          (products) =>
            `Sells ${[...new Set(products.map((product) => product.category))].join(' and ')} to pair with your ${category}.`,
        );
        const competitors = groups(
          found.get(category) ?? [],
          () => `Sells ${category}, the category selected for comparison.`,
        );
        const ownProduct =
          own.find(
            (offer) =>
              researchCategory(offer.category) === category && offer.availability === 'available',
          ) ?? own.find((offer) => researchCategory(offer.category) === category)!;
        const bundles = complementary
          .filter(
            (offer) =>
              ownProduct.availability !== 'unavailable' && offer.availability !== 'unavailable',
          )
          .slice(0, 6)
          .map((offer) => ({
            ownProduct,
            complementaryProduct: offer,
            reason: pairing?.reason ?? `Combine ${category} with ${offer.category}.`,
            itemSubtotal:
              ownProduct.price && offer.price && ownProduct.price.currency === offer.price.currency
                ? {
                    amount: ownProduct.price.amount + offer.price.amount,
                    currency: offer.price.currency,
                  }
                : null,
          }));
        if (timeout.aborted) gaps.push('Time limit reached. These are the results found so far.');
        return MerchantResearchSchema.parse({
          merchantId: source.merchant.id,
          sampleOrigin: source.sampleOrigin,
          country: request.country,
          currency: request.currency,
          createdAt: (options.now?.() ?? new Date()).toISOString(),
          category,
          complementaryCategories: complements,
          comparisonProducts: own
            .filter((offer) => researchCategory(offer.category) === category)
            .slice(0, 150),
          status:
            partners.length || competitors.length ? (gaps.length ? 'partial' : 'ready') : 'empty',
          bundles,
          partners,
          competitors,
          gaps,
        });
      } finally {
        try {
          await catalog?.close();
        } finally {
          busy = false;
        }
      }
    },
  };
}
export type MerchantResearchService = ReturnType<typeof createMerchantResearch>;
