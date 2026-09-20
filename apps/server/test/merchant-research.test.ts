import { type ProductOffer, ProductOfferSchema } from '@sei/contracts';
import { expect, it, vi } from 'vitest';
import outfit from '../../../fixtures/seed/outfit/offers.json';
import setup from '../../../fixtures/seed/setup/offers.json';
import { createMerchantResearch as createResearch } from '../src/services/merchant-research';

// Explicit offline planner fixtures; production uses OpenAI for arbitrary catalogs.
const createMerchantResearch: typeof createResearch = (env, options) =>
  createResearch(env, {
    minimumResults: 0,
    ...options,
    planner:
      options?.planner ??
      (async (_offers, category) => ({
        domain: 'outfit',
        ideas: (category === 'top'
          ? ['supplements', 'fitness equipment']
          : category === 'makeup'
            ? ['skincare', 'beauty tools']
            : ['bag', 'socks']
        ).map((target) => ({
          category: target,
          query: target,
          reason: 'Fixture complementary use',
        })),
      })),
  });

const request = { country: 'CA', currency: 'CAD' };

it('uses arbitrary planner categories and excludes expensive and unknown-price add-ons', async () => {
  const progress = vi.fn();
  const planner = vi.fn(async () => ({
    domain: 'setup' as const,
    ideas: ['spare nibs', 'ink bottles', 'writing paper'].map((category) => ({
      category,
      query: category,
      reason: 'A useful writing companion',
    })),
  }));
  const report = await createResearch(
    {},
    {
      planner,
      minimumResults: 0,
      openCatalog: () => ({
        close: async () => {},
        search: async (query) => [
          offer(query.text, 'affordable.example', { price: { amount: 2000, currency: 'CAD' } }),
          offer(query.text, 'expensive.example', { price: { amount: 300000, currency: 'CAD' } }),
          offer(query.text, 'unknown.example', { price: null }),
        ],
      }),
    },
  ).research(
    [offer('fountain pen', 'own.example', { price: { amount: 6000, currency: 'CAD' } })],
    request,
    signal(),
    progress,
  );
  expect(planner).toHaveBeenCalledOnce();
  expect(progress.mock.calls.map(([update]) => update.completed)).toEqual([0, 0, 1, 2, 3, 4, 4]);
  expect(progress).toHaveBeenLastCalledWith({
    stage: 'Comparing prices and assembling results',
    completed: 4,
    total: 4,
  });
  expect(report.complementaryCategories).toEqual(['spare nibs', 'ink bottles', 'writing paper']);
  expect(report.bundles).toHaveLength(3);
  expect(report.bundles.every((bundle) => bundle.itemSubtotal?.amount === 8000)).toBe(true);
  expect(report.partners.map((p) => p.merchant.domain)).toEqual(['affordable.example']);
});
const signal = () => new AbortController().signal;
it('searches both catalog audiences and keeps rivals from each', async () => {
  const descriptions: string[] = [];
  const service = createMerchantResearch(
    {},
    {
      openCatalog: (brief) => ({
        close: async () => {},
        search: async (query) => {
          const description = brief.slots.find((s) => s.id === query.slotId)!.description;
          descriptions.push(description);
          return [
            offer(query.text, description.startsWith('mens') ? 'mens.example' : 'womens.example'),
          ];
        },
      }),
    },
  );
  const report = await service.research(
    [
      offer('bottom', 'own.example', { productId: 'men', title: 'Mens training shorts' }),
      offer('bottom', 'own.example', { productId: 'women', title: 'Womens training leggings' }),
    ],
    request,
    signal(),
  );
  expect(descriptions).toContain('mens bottom');
  expect(descriptions).toContain('womens bottom');
  expect(report.competitors.map((b) => b.merchant.domain).sort()).toEqual([
    'mens.example',
    'womens.example',
  ]);
});

it.each(['reject', 'hang'])('returns results even when browser cleanup will %s', async (mode) => {
  const service = createMerchantResearch(
    {},
    {
      cleanupTimeoutMs: 10,
      openCatalog: () => ({
        close: () =>
          mode === 'reject' ? Promise.reject(new Error('CDP disconnected')) : new Promise(() => {}),
        search: async (q) => [offer(q.text, 'other.example')],
      }),
    },
  );
  const report = await service.research([offer('bottom', 'own.example')], request, signal());
  expect(report.competitors).toHaveLength(1);
});

it('isolates a stalled final category and preserves other results', async () => {
  const service = createMerchantResearch(
    {},
    {
      categoryTimeoutMs: 15,
      openCatalog: () => ({
        close: async () => {},
        search: async (q) =>
          q.text === 'socks' ? new Promise(() => {}) : [offer(q.text, 'other.example')],
      }),
    },
  );
  const progress = vi.fn();
  const report = await service.research(
    [offer('bottom', 'own.example')],
    request,
    signal(),
    progress,
  );
  expect(report.competitors).toHaveLength(1);
  expect(report.bundles).toHaveLength(1);
  expect(report.status).toBe('partial');
  expect(progress).toHaveBeenLastCalledWith({
    stage: 'Comparing prices and assembling results',
    completed: 3,
    total: 3,
  });
});
it('preserves verified partial results below the target, and uses planned rival context on success', async () => {
  let count = 2;
  const service = createResearch(
    {},
    {
      planner: async () => ({
        domain: 'outfit',
        competitor: {
          query: 'compression training leggings',
          reason: 'Similar compression apparel for training.',
        },
        ideas: ['socks', 'bag', 'supplements'].map((category) => ({
          category,
          query: category,
          reason: 'Complementary training use',
        })),
      }),
      openCatalog: (brief) => {
        expect(brief.slots[0]?.description).toBe('compression training leggings');
        return {
          close: async () => {},
          search: async (query) =>
            Array.from({ length: count }, (_, i) => offer(query.text, `brand-${i}.example`)),
        };
      },
    },
  );
  const partial = await service.research([offer('bottom', 'own.example')], request, signal());
  expect(partial.status).toBe('partial');
  expect(partial.competitors).toHaveLength(2);
  expect(partial.bundles.length).toBeGreaterThanOrEqual(3);
  expect(partial.gaps.join(' ')).toContain('Limited coverage');
  count = 3;
  const report = await service.research([offer('bottom', 'own.example')], request, signal());
  expect(report.partners).toHaveLength(3);
  expect(report.competitors).toHaveLength(3);
  expect(report.bundles.length).toBeGreaterThanOrEqual(3);
  expect(report.competitors[0]?.reason).toMatch(/compression apparel.*Similar price tier/);
});
function offer(category: string, domain: string, patch: Partial<ProductOffer> = {}): ProductOffer {
  const base = ProductOfferSchema.parse(outfit[0]);
  return {
    ...base,
    sampleOrigin: 'live',
    category,
    productId: category,
    productUrl: `https://${domain}/products/${category}`,
    merchant: { ...base.merchant, domain },
    ...patch,
  };
}
it.each([
  { seed: outfit, category: 'top' },
  { seed: setup, category: 'desk' },
])('uses seed products without opening live providers: $category', async ({ seed, category }) => {
  const openCatalog = vi.fn();
  const report = await createMerchantResearch({}, { openCatalog }).research(
    [ProductOfferSchema.parse(seed[0])],
    { ...request, category },
    signal(),
  );
  expect(report.sampleOrigin).toBe('seed');
  expect(report.partners.length).toBeGreaterThan(0);
  expect(report.bundles.length).toBeGreaterThan(0);
  expect(openCatalog).not.toHaveBeenCalled();
});
it('rejects articles, own domains, mismatched categories and seed data; deduplicates variants', async () => {
  const own = offer('footwear', 'own.example');
  const close = vi.fn(async () => {});
  const service = createMerchantResearch(
    {},
    {
      openCatalog: () => ({
        close,
        search: async (query) => [
          offer(query.text, 'other.example'),
          offer(query.text, 'other.example', { variantId: 'second' }),
          offer(query.text, 'own.example'),
          offer(query.text, 'sub.own.example'),
          offer(query.text, 'article.example', {
            productUrl: 'https://article.example/blogs/best-shoes',
          }),
          offer(query.text, 'mismatch.example', {
            productUrl: 'https://foreign.example/products/test',
          }),
          offer(query.text, 'fake.example', { sampleOrigin: 'seed' }),
          offer(query.text, 'unverified.example', { evidence: [] }),
          offer('unrelated', 'wrong.example'),
        ],
      }),
    },
  );
  const report = await service.research([own], request, signal());
  expect(report.status).toBe('ready');
  expect(report.bundles).toHaveLength(2);
  expect(report.partners.map((x) => x.merchant.domain)).toEqual(['other.example']);
  expect(report.competitors[0]?.products).toHaveLength(1);
  expect(report.bundles[0]?.itemSubtotal).toEqual({ amount: 20000, currency: 'CAD' });
  expect(close).toHaveBeenCalledOnce();
});
it('does not sum mixed currencies or bundle unavailable items', async () => {
  const service = createMerchantResearch(
    {},
    {
      openCatalog: () => ({
        close: async () => {},
        search: async (query) => [
          offer(query.text, 'other.example', {
            price: { amount: 1000, currency: 'USD' },
            availability: query.text === 'socks' ? 'unavailable' : 'available',
          }),
        ],
      }),
    },
  );
  const report = await service.research([offer('footwear', 'own.example')], request, signal());
  expect(report.bundles).toHaveLength(0);
});
it('diversifies fitness research across supplements and equipment with six results per section', async () => {
  const searched: string[] = [];
  const service = createMerchantResearch(
    {},
    {
      openCatalog: () => ({
        close: async () => {},
        search: async (query) => {
          searched.push(query.text);
          const count = query.text === 'top' ? 6 : 3;
          return Array.from({ length: count }, (_, index) =>
            offer(query.text, `${query.text.replace(/\s+/g, '-')}-${index}.example`, {
              title:
                query.text === 'fitness equipment'
                  ? `Pull-up bar ${index}`
                  : query.text === 'supplements'
                    ? `Protein supplement ${index}`
                    : `Training top ${index}`,
            }),
          );
        },
      }),
    },
  );
  const report = await service.research(
    [
      offer('top', 'gym.example', { title: 'Gym training shirt', productId: 'training-shirt' }),
      offer('top', 'gym.example', { title: 'Workout tank', productId: 'workout-tank' }),
    ],
    { ...request, category: 'top' },
    signal(),
  );
  expect(searched).toEqual(['top', 'supplements', 'fitness equipment']);
  expect(report.complementaryCategories).toEqual(['supplements', 'fitness equipment']);
  expect(report.bundles).toHaveLength(6);
  expect(report.partners).toHaveLength(6);
  expect(report.competitors).toHaveLength(6);
  expect(report.bundles.slice(0, 2).map((bundle) => bundle.complementaryProduct.category)).toEqual([
    'supplements',
    'fitness equipment',
  ]);
  expect(
    report.bundles.every(
      (bundle) => bundle.ownProduct.price?.currency === bundle.complementaryProduct.price?.currency,
    ),
  ).toBe(true);
  expect(report.competitors[0]?.reason).toMatch(/verified product.*examples found include/i);
});
it('uses skincare and beauty tools as complements for a cosmetics catalog', async () => {
  const searched: string[] = [];
  const report = await createMerchantResearch(
    {},
    {
      openCatalog: () => ({
        close: async () => {},
        search: async (query) => {
          searched.push(query.text);
          return [offer(query.text, `${query.text.replace(/\s+/g, '-')}.example`)];
        },
      }),
    },
  ).research(
    [offer('makeup', 'beauty.example', { title: 'Beauty lip color' })],
    { ...request, category: 'makeup' },
    signal(),
  );
  expect(searched).toEqual(['makeup', 'skincare', 'beauty tools']);
  expect(report.complementaryCategories).toEqual(['skincare', 'beauty tools']);
  expect(report.bundles).toHaveLength(2);
});
it('returns partial results when a later search fails and always closes', async () => {
  const close = vi.fn(async () => {});
  const service = createMerchantResearch(
    {},
    {
      openCatalog: () => ({
        close,
        search: async (query) => {
          if (query.text !== 'bag') throw new Error('Provider failed');
          return [offer('bag', 'other.example')];
        },
      }),
    },
  );
  const report = await service.research([offer('footwear', 'own.example')], request, signal());
  expect(report.status).toBe('partial');
  expect(report.partners).toHaveLength(1);
  expect(report.competitors).toHaveLength(0);
  expect(report.gaps).toHaveLength(2);
  expect(close).toHaveBeenCalledOnce();
});
it('returns a retryable provider error instead of a successful empty report when every search fails', async () => {
  const close = vi.fn(async () => {});
  const service = createMerchantResearch(
    {},
    {
      openCatalog: () => ({
        close,
        search: async () => {
          throw new Error('Provider failed');
        },
      }),
    },
  );
  await expect(
    service.research(
      [offer('top', 'gym.example', { title: 'Gym training shirt' })],
      { ...request, category: 'top' },
      signal(),
    ),
  ).rejects.toMatchObject({ code: 'MERCHANT_RESEARCH_UNAVAILABLE', status: 503 });
  expect(close).toHaveBeenCalledOnce();
});
it('cancels a pending query, blocks concurrent jobs and releases its session', async () => {
  const close = vi.fn(async () => {});
  let start!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const service = createMerchantResearch(
    {},
    {
      openCatalog: () => ({
        close,
        search: async () => {
          start();
          return new Promise(() => {});
        },
      }),
    },
  );
  const controller = new AbortController();
  const pending = service.research([offer('footwear', 'own.example')], request, controller.signal);
  await started;
  await expect(
    service.research([offer('footwear', 'own.example')], request, signal()),
  ).rejects.toMatchObject({ code: 'MERCHANT_RESEARCH_BUSY' });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(close).toHaveBeenCalledOnce();
});
it('validates categories and requires configured live research', async () => {
  const service = createMerchantResearch({});
  await expect(
    service.research(
      [offer('footwear', 'own.example')],
      { ...request, category: 'desk' },
      signal(),
    ),
  ).rejects.toMatchObject({ code: 'INVALID_CATEGORY' });
  await expect(
    service.research([offer('footwear', 'own.example')], request, signal()),
  ).rejects.toMatchObject({ code: 'MERCHANT_RESEARCH_DISABLED' });
});
