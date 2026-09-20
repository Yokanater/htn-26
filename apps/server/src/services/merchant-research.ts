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
import { createPairingPlanner, createProductPageReader, type PairingPlanner } from '@sei/reason';
import { loadSeedOffers } from '../replay';
import { liveCatalog } from './live-catalog';

type ResearchCatalog = Pick<ShoppingCatalog, 'search'> & { close(): Promise<void> };
export type ResearchCatalogFactory = (
  brief: IntentBrief,
  sourceDomain: string,
  signal?: AbortSignal,
) => ResearchCatalog;

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

type Pairing = { domain: 'outfit' | 'setup'; complements: string[]; reason: string };

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
  if (/\b(leggings?|joggers?|tights?|underwear|boxers?)\b/.test(value)) return 'bottom';
  if (/\b(sports bras?|bras?|pullovers?|tanks?|tees?|t-shirts?|crop tops?)\b/.test(value))
    return 'top';
  if (/\b(protein|creatine|supplements?|pre[- ]?workout|electrolytes?)\b/.test(value))
    return 'supplements';
  if (
    /\b(pull[- ]?up bars?|dumbbells?|kettlebells?|resistance bands?|gym equipment|training equipment)\b/.test(
      value,
    )
  )
    return 'fitness equipment';
  if (/\b(skincare|serums?|moisturi[sz]ers?|cleansers?|sunscreens?)\b/.test(value))
    return 'skincare';
  if (
    /\b(makeup|cosmetics?|lip|lipsticks?|mascaras?|foundations?|concealers?|blush|bronzers?|highlighters?|eyeshadows?)\b/.test(
      value,
    )
  )
    return 'makeup';
  if (/\b(beauty tools?|makeup brushes?|applicators?|sponges?|mirrors?)\b/.test(value))
    return 'beauty tools';
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

function interleave(groups: readonly ProductOffer[][]): ProductOffer[] {
  const result: ProductOffer[] = [];
  const longest = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < longest; index++) {
    for (const group of groups) {
      const offer = group[index];
      if (offer) result.push(offer);
    }
  }
  return result;
}

function examples(products: readonly ProductOffer[]): string {
  return products
    .slice(0, 2)
    .map((product) => product.title)
    .join(' and ')
    .slice(0, 180);
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

function priceComparison(own: ProductOffer[], rivals: ProductOffer[], currency: string): string {
  const amounts = (products: ProductOffer[]) =>
    products
      .flatMap((p) =>
        p.price?.currency === currency && p.price.amount > 0 ? [p.price.amount] : [],
      )
      .sort((a, b) => a - b);
  const a = amounts(own),
    b = amounts(rivals);
  if (!a.length || !b.length) return 'Price positioning is unverified.';
  const format = new Intl.NumberFormat('en', { style: 'currency', currency });
  const ratio = b[Math.floor(b.length / 2)]! / a[Math.floor(a.length / 2)]!;
  const position =
    ratio < 0.5
      ? 'Lower-priced alternative'
      : ratio > 2
        ? 'Premium alternative'
        : 'Similar price tier';
  return `${position}: sampled prices ${format.format(b[0]! / 100)}–${format.format(b[b.length - 1]! / 100)}.`;
}

export function createMerchantResearch(
  env: EnvLike,
  options: {
    openCatalog?: ResearchCatalogFactory;
    now?: () => Date;
    timeoutMs?: number;
    categoryTimeoutMs?: number;
    cleanupTimeoutMs?: number;
    planner?: PairingPlanner;
    minimumResults?: number;
    recordedOffers?: ProductOffer[];
  } = {},
) {
  let busy = false;
  const openCatalog: ResearchCatalogFactory =
    options.openCatalog ??
    ((brief, sourceDomain, signal) => {
      const attempts = new Map<string, number>();
      const model =
        env.OPENAI_MODEL_PAIRINGS || env.OPENAI_MODEL_REASONING || env.OPENAI_MODEL_VISION;
      return liveCatalog(brief, env, {
        fetchBudget: 90,
        minimumBrands: 6,
        searchResultsPerQuery: 10,
        candidatesPerQuery: 6,
        offersPerSlot: 12,
        plannedQueries: true,
        browserSignal: signal,
        readProductText:
          env.OPENAI_API_KEY && model
            ? createProductPageReader({ apiKey: env.OPENAI_API_KEY, model })
            : undefined,
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
      onProgress?: (progress: { stage: string; completed: number; total: number }) => void,
    ): Promise<MerchantResearch> {
      onProgress?.({ stage: 'Planning catalog-specific pairings', completed: 0, total: 0 });
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
      let pairing: Pairing | undefined =
        source.sampleOrigin === 'live'
          ? undefined
          : {
              domain: category === 'top' || category === 'footwear' ? 'outfit' : 'setup',
              complements: [
                ...new Set(
                  (options.recordedOffers ?? loadSeedOffers()).map((p) =>
                    researchCategory(p.category),
                  ),
                ),
              ]
                .filter((c) => c !== category)
                .slice(0, 5),
              reason: 'Synthetic catalog pairing for demonstration.',
            };
      let complements = pairing?.complements ?? [];
      const live = source.sampleOrigin === 'live';
      if (live && !options.openCatalog && !env.BROWSERBASE_API_KEY?.trim())
        throw new MerchantResearchError(
          'MERCHANT_RESEARCH_DISABLED',
          503,
          'Brand search is not configured on this server.',
        );
      busy = true;
      const timeout = AbortSignal.timeout(options.timeoutMs ?? 600_000);
      const signal = AbortSignal.any([callerSignal, timeout]);
      let catalog: ResearchCatalog | undefined;
      const gaps: string[] = [];
      let failedSearches = 0;
      try {
        const queries = new Map<string, string>();
        const reasons = new Map<string, string>();
        let competitorReason = `Comparable ${category} products`;
        if (live || (source.sampleOrigin === 'replay' && options.planner)) {
          const model =
            env.OPENAI_MODEL_PAIRINGS?.trim() ||
            env.OPENAI_MODEL_REASONING?.trim() ||
            env.OPENAI_MODEL_VISION?.trim();
          const planner =
            options.planner ??
            (env.OPENAI_API_KEY && model
              ? createPairingPlanner({ apiKey: env.OPENAI_API_KEY, model })
              : undefined);
          if (!planner)
            throw new MerchantResearchError(
              'MERCHANT_RESEARCH_DISABLED',
              503,
              'Configure OpenAI to plan catalog-specific pairings.',
            );
          try {
            const sample =
              own.length <= 40
                ? own
                : Array.from(
                    { length: 40 },
                    (_, i) => own[Math.floor((i * (own.length - 1)) / 39)]!,
                  );
            const plan = await planner(sample, category, request.currency, signal);
            if (plan.competitor) {
              queries.set(category, plan.competitor.query);
              competitorReason = plan.competitor.reason;
            }
            complements = [...new Set(plan.ideas.map((idea) => researchCategory(idea.category)))]
              .filter((target) => target !== category)
              .slice(0, 5);
            for (const idea of plan.ideas) {
              queries.set(researchCategory(idea.category), idea.query);
              reasons.set(researchCategory(idea.category), idea.reason);
            }
            pairing = {
              domain: plan.domain,
              complements,
              reason: 'Products selected for complementary uses and compatible prices.',
            };
          } catch {
            throw new MerchantResearchError(
              'MERCHANT_RESEARCH_UNAVAILABLE',
              503,
              'Pairing planning could not finish. Please try again.',
            );
          }
        }
        const categories = [category, ...complements];
        const audienceText = own.map((p) => `${p.title} ${p.category} ${p.productUrl}`).join(' ');
        const mixedAudience =
          /\bwom[ae]n(?:s|'s)?\b/i.test(audienceText) && /\bm[ae]n(?:s|'s)?\b/i.test(audienceText);
        const rivalQuery = (queries.get(category) ?? category)
          .replace(/\b(?:wom[ae]n|m[ae]n)(?:s|'s)?\b/gi, '')
          .trim();
        const searchSlots = mixedAudience
          ? [
              { category, description: `mens ${rivalQuery}` },
              { category, description: `womens ${rivalQuery}` },
              ...complements.map((target) => ({
                category: target,
                description: queries.get(target) ?? target,
              })),
            ]
          : categories.map((target) => ({
              category: target,
              description: queries.get(target) ?? target,
            }));
        const brief = IntentBriefSchema.parse({
          id: 'brief_merchant_research',
          revision: 1,
          status: 'confirmed',
          domain: pairing?.domain ?? 'setup',
          input: { kind: 'text', text: `Public catalog research for ${category}.` },
          slots: searchSlots.map((target, index) => ({
            id: `slot_merchant_${index}`,
            category: target.category,
            description: target.description,
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
          catalog_query: searchSlots.length * 3,
          fetch: 90,
          browser_session: 2,
          model_call: 12,
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
        catalog =
          live || (source.sampleOrigin === 'replay' && options.openCatalog)
            ? openCatalog(brief, source.merchant.domain, signal)
            : {
                search: async (query) =>
                  loadSeedOffers().filter(
                    (offer) => researchCategory(offer.category) === researchCategory(query.text),
                  ),
                close: async () => {},
              };
        const found = new Map<string, ProductOffer[]>();
        const activeCatalog = catalog;
        let nextSlot = 0;
        let completed = 0;
        onProgress?.({
          stage: 'Searching stores and checking products',
          completed,
          total: brief.slots.length,
        });
        const worker = async () => {
          while (nextSlot < brief.slots.length) {
            const slot = brief.slots[nextSlot++]!;
            if (signal.aborted) {
              gaps.push('Search stopped before all categories were checked.');
              break;
            }
            try {
              const categorySignal = AbortSignal.any([
                signal,
                AbortSignal.timeout(options.categoryTimeoutMs ?? 120_000),
              ]);
              const result = await untilAborted(
                activeCatalog.search(
                  {
                    slotId: slot.id,
                    text: slot.category,
                    country: request.country,
                    currency: request.currency,
                    limit: 8,
                  },
                  { ...context, signal: categorySignal },
                ),
                categorySignal,
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
              found.set(
                slot.category,
                distinctProducts(interleave([found.get(slot.category) ?? [], verified])),
              );
              if (verified.length === 0)
                gaps.push(`No products from other stores found for ${slot.category}.`);
            } catch (error) {
              console.warn(
                '[merchant-research]',
                JSON.stringify({
                  event: 'category_search_failed',
                  category: slot.category,
                  errorName:
                    typeof error === 'object' && error !== null && 'name' in error
                      ? String(error.name)
                      : typeof error,
                }),
              );
              failedSearches += 1;
              gaps.push(`Could not finish the ${slot.category} search.`);
            } finally {
              completed += 1;
              onProgress?.({
                stage: 'Searching stores and checking products',
                completed,
                total: brief.slots.length,
              });
            }
          }
        };
        await Promise.all([worker(), worker()]);
        onProgress?.({
          stage: 'Comparing prices and assembling results',
          completed,
          total: brief.slots.length,
        });
        if (callerSignal.aborted) throw callerSignal.reason;
        if (failedSearches === brief.slots.length) {
          if (timeout.aborted) {
            throw new MerchantResearchError(
              'MERCHANT_RESEARCH_TIMEOUT',
              504,
              'Product and brand research took too long. Try the search again.',
            );
          }
          throw new MerchantResearchError(
            'MERCHANT_RESEARCH_UNAVAILABLE',
            503,
            'The catalog provider could not complete this search. Try again.',
          );
        }
        if (!pairing)
          gaps.push(
            'No bundle categories are configured for this product type. Competitor search is available.',
          );
        const anchors = own.filter(
          (p) =>
            researchCategory(p.category) === category &&
            p.availability !== 'unavailable' &&
            p.price?.currency === request.currency &&
            p.price.amount > 0,
        );
        const compatibleAnchor = (offer: ProductOffer) =>
          anchors
            .filter(
              (p) =>
                offer.price &&
                offer.price.currency === p.price!.currency &&
                offer.price.amount > 0 &&
                offer.price.amount <= p.price!.amount * 3,
            )
            .sort(
              (a, b) =>
                Math.abs(a.price!.amount - offer.price!.amount) -
                Math.abs(b.price!.amount - offer.price!.amount),
            )[0];
        const complementary = interleave(
          complements.map((target) => (found.get(target) ?? []).filter((p) => compatibleAnchor(p))),
        );
        if (
          complements.some((target) => (found.get(target) ?? []).some((p) => !compatibleAnchor(p)))
        )
          gaps.push(
            'Products with unknown prices, different currencies or prices above 3× the store item were excluded.',
          );
        const partners = groups(
          complementary,
          (products) =>
            `Complements your ${category} catalog with ${[
              ...new Set(products.map((product) => product.category)),
            ].join(' and ')}; examples found include ${examples(products)}.`,
        );
        const competitors = groups(
          found.get(category) ?? [],
          (products) =>
            `${competitorReason} Based on ${products.length} verified products; examples found include ${examples(products)}. ${priceComparison(anchors, products, request.currency)}`,
        );
        const ownProducts = own.filter(
          (offer) =>
            researchCategory(offer.category) === category && offer.availability !== 'unavailable',
        );
        if (ownProducts.length === 0) {
          ownProducts.push(own.find((offer) => researchCategory(offer.category) === category)!);
        }
        const bundles = complementary
          .filter((offer) => ownProducts.length > 0 && offer.availability !== 'unavailable')
          .slice(0, 6)
          .map((offer) => ({
            ownProduct: compatibleAnchor(offer)!,
            complementaryProduct: offer,
            reason:
              reasons.get(researchCategory(offer.category)) ??
              pairing?.reason ??
              `Combine ${category} with ${offer.category}.`,
            itemSubtotal: {
              amount: compatibleAnchor(offer)!.price!.amount + offer.price!.amount,
              currency: offer.price!.currency,
            },
          }));
        if (timeout.aborted) gaps.push('Time limit reached. These are the results found so far.');
        const minimum = options.minimumResults ?? 3;
        if (
          live &&
          (bundles.length < minimum || partners.length < minimum || competitors.length < minimum)
        ) {
          gaps.push(
            `Limited coverage: found ${bundles.length} bundles, ${partners.length} complementary brands and ${competitors.length} rivals. Target: at least ${minimum} in each section. Only source-backed products are shown.`,
          );
        }
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
          if (catalog)
            await untilAborted(
              catalog.close(),
              AbortSignal.timeout(options.cleanupTimeoutMs ?? 3000),
            );
        } catch {
          console.warn('[merchant-research]', JSON.stringify({ event: 'cleanup_failed' }));
        } finally {
          busy = false;
        }
      }
    },
  };
}
export type MerchantResearchService = ReturnType<typeof createMerchantResearch>;
