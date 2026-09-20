import type { BrowserbasePageText } from '@sei/collect';
import { type IntentBrief, IntentBriefSchema } from '@sei/contracts';
import type { ShoppingContext } from '@sei/core';
import { createRunBudget } from '@sei/pipeline';
import { expect, it, vi } from 'vitest';
import seed from '../../../fixtures/seed/outfit/brief.json';
import { defaultProviders } from '../src/providers';
import { buildSearchQuery, liveCatalog } from '../src/services/live-catalog';

// Every provider is injected and DNS is faked: this suite makes no live call.
vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
}));

type PageBody = { html?: string; text?: string; finalUrl?: string };

const liveBrief = (overrides: Partial<IntentBrief> = {}): IntentBrief =>
  IntentBriefSchema.parse({ ...seed, sampleOrigin: 'live', ...overrides });

function briefWithSlots(
  slots: ReadonlyArray<{ category: string; description?: string; constraints?: unknown[] }>,
  domain: 'outfit' | 'setup' = 'outfit',
): IntentBrief {
  return liveBrief({
    domain,
    slots: slots.map((slot, index) => ({
      id: `slot_live_${index + 1}`,
      category: slot.category,
      description: slot.description ?? `${slot.category} matching the confirmed inspiration`,
      required: true,
      visualAttributes: ['olive'],
      constraints: slot.constraints ?? [],
    })),
  } as Partial<IntentBrief>);
}

function jsonLdPage(input: {
  title: string;
  sku: string;
  price: string;
  currency: string;
}): string {
  return `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: input.title,
    sku: input.sku,
    offers: {
      '@type': 'Offer',
      sku: `${input.sku}-V`,
      price: input.price,
      priceCurrency: input.currency,
      availability: 'https://schema.org/InStock',
      size: 'M',
    },
  })}</script></head><body>${input.title}</body></html>`;
}

const SHOPIFY_PRODUCT_JS = JSON.stringify({
  id: '12',
  title: 'Shirt',
  featured_image: null,
  options: ['Size'],
  variants: [
    {
      id: '42',
      title: 'Medium',
      available: true,
      price: '1000',
      option1: 'M',
      featured_image: 'https://cdn.shop.example/shirt.jpg',
    },
  ],
});

/** A storefront that only exposes facts through `product.js`: the last-resort path. */
const OPAQUE_SHOPIFY_HTML =
  '<!doctype html><html><head><script src="https://cdn.shopify.com/s/theme.js"></script></head><body>Shirt</body></html>';

function fakeBrowser(pages: (url: string) => PageBody | undefined) {
  const readPage = vi.fn(
    async (url: string, _signal?: AbortSignal): Promise<BrowserbasePageText> => {
      const body = pages(url);
      if (!body) throw new Error('navigation failed');
      return {
        requestedUrl: url,
        finalUrl: body.finalUrl ?? url,
        title: '',
        text: body.text ?? '',
        html: body.html ?? '',
        sessionId: 'bb_test',
      };
    },
  );
  const close = vi.fn(async () => undefined);
  const openBrowser = vi.fn(async () => ({ sessionId: 'bb_test', readPage, close }));
  return { readPage, close, openBrowser };
}

function liveContext(budget?: ReturnType<typeof createRunBudget>): ShoppingContext & {
  consume: ReturnType<typeof vi.fn>;
} {
  const controller = new AbortController();
  return {
    sampleOrigin: 'live',
    signal: controller.signal,
    consume: vi.fn((resource: string, amount: number) => {
      budget?.consume(resource as Parameters<typeof budget.consume>[0], amount);
    }),
  } as ShoppingContext & { consume: ReturnType<typeof vi.fn> };
}

const query = (brief: IntentBrief, index = 0, text = 'olive shirt') => ({
  slotId: brief.slots[index]!.id,
  text,
  country: 'CA',
  currency: 'CAD',
  limit: 8,
});

it('builds a readable recall query without operators or serialized constraints', () => {
  const outfit = briefWithSlots([
    {
      category: 'top',
      description: "men's olive shirt matching the inspiration",
      constraints: [{ kind: 'size', value: 'M' }],
    },
  ]);
  const setup = briefWithSlots(
    [
      {
        category: 'desk',
        description: 'oak writing desk',
        constraints: [{ kind: 'dimension', axis: 'width', maxCm: 120 }],
      },
    ],
    'setup',
  );
  const shirt = buildSearchQuery({
    slot: outfit.slots[0]!,
    text: 'top olive shirt',
    country: 'CA',
  });
  expect(shirt).toBe('men shirt top olive size M Canada');
  expect(shirt).not.toContain('inurl');
  expect(shirt).not.toContain('{');
  expect(buildSearchQuery({ slot: setup.slots[0]!, text: 'desk oak writing', country: 'US' })).toBe(
    'desk oak writing 120 cm United States',
  );
  // No audience token in the brief means none is invented.
  expect(buildSearchQuery({ slot: setup.slots[0]!, text: 'desk', country: 'GB' })).toBe(
    'desk 120 cm United Kingdom',
  );
  expect(
    buildSearchQuery({ slot: outfit.slots[0]!, text: 'top', country: 'CA', fallback: true }),
  ).toBe('men shirt Canada');
});

it('verifies a JSON-LD storefront without any Shopify endpoint', async () => {
  const brief = briefWithSlots([{ category: 'shorts' }]);
  const { readPage, openBrowser, close } = fakeBrowser((url) =>
    url === 'https://plain.example/products/chino-shorts'
      ? {
          html: jsonLdPage({
            title: 'Tan chino shorts',
            sku: 'CH-1',
            price: '45.00',
            currency: 'CAD',
          }),
        }
      : undefined,
  );
  const searchProducts = vi.fn(async () => [
    { title: 'Tan chino shorts', url: 'https://plain.example/products/chino-shorts?ref=ads#top' },
  ]);
  const catalog = liveCatalog(
    brief,
    { BROWSERBASE_API_KEY: 'test-only' },
    { searchProducts, openBrowser },
  );
  const context = liveContext();
  const offers = await catalog.search(query(brief, 0, 'shorts chino'), context);
  expect(offers).toHaveLength(1);
  expect(offers[0]).toMatchObject({
    productId: 'CH-1',
    variantId: 'CH-1-V',
    title: 'Tan chino shorts',
    merchant: { domain: 'plain.example' },
    productUrl: 'https://plain.example/products/chino-shorts',
    price: { amount: 4500, currency: 'CAD' },
    availability: 'available',
    attributes: { size: 'M' },
    shipsTo: null,
    sampleOrigin: 'live',
  });
  expect(
    offers[0]?.evidence.some(
      (entry) => entry.field === 'source_strategy' && entry.value === 'json_ld',
    ),
  ).toBe(true);
  expect(offers[0]?.evidence.every((entry) => entry.method === 'browser')).toBe(true);
  // One read total: no `product.js`, no `/cart.js`.
  expect(readPage).toHaveBeenCalledTimes(1);
  expect(context.consume).toHaveBeenCalledWith('fetch', 1);
  await catalog.close();
  await catalog.close();
  expect(close).toHaveBeenCalledTimes(1);
});

it.each([
  {
    domain: 'outfit' as const,
    category: 'top',
    queryText: 'olive top',
    wrongTitle: 'Discount leather sandals',
    wrongUrl: 'https://shop.example/products/leather-sandals',
    rightTitle: 'Olive linen shirt',
    rightUrl: 'https://shop.example/products/olive-linen-shirt',
  },
  {
    domain: 'setup' as const,
    category: 'desk',
    queryText: 'oak writing desk',
    wrongTitle: 'Discount table lamp',
    wrongUrl: 'https://home.example/products/table-lamp',
    rightTitle: 'Oak writing desk',
    rightUrl: 'https://home.example/products/oak-writing-desk',
  },
])(
  'ranks the relevant $domain category before spending browser budget',
  async ({ domain, category, queryText, wrongTitle, wrongUrl, rightTitle, rightUrl }) => {
    const brief = briefWithSlots([{ category }], domain);
    const { readPage, openBrowser } = fakeBrowser((url) => {
      if (url !== rightUrl) return undefined;
      return {
        html: jsonLdPage({ title: rightTitle, sku: 'RIGHT-1', price: '80.00', currency: 'CAD' }),
      };
    });
    const searchProducts = vi.fn(async () => [
      { title: wrongTitle, url: wrongUrl },
      { title: rightTitle, url: rightUrl },
    ]);
    const catalog = liveCatalog(
      brief,
      { BROWSERBASE_API_KEY: 'test-only' },
      { searchProducts, openBrowser },
    );

    const offers = await catalog.search(query(brief, 0, queryText), liveContext());

    expect(offers.map((offer) => offer.title)).toEqual([rightTitle]);
    expect(readPage).toHaveBeenCalledTimes(1);
    expect(readPage).toHaveBeenCalledWith(rightUrl, expect.any(AbortSignal));
  },
);

it('falls back to product.js and resolves the storefront currency once per merchant', async () => {
  const brief = briefWithSlots([{ category: 'top', constraints: [{ kind: 'size', value: 'M' }] }]);
  const { readPage, openBrowser } = fakeBrowser((url) => {
    if (url === 'https://shop.example/products/shirt') return { html: OPAQUE_SHOPIFY_HTML };
    if (url === 'https://shop.example/products/shirt.js') return { text: SHOPIFY_PRODUCT_JS };
    if (url === 'https://shop.example/cart.js')
      return { text: JSON.stringify({ currency: 'CAD' }) };
    return undefined;
  });
  const searchProducts = vi.fn(async () => [
    { title: 'Shirt', url: 'https://shop.example/products/shirt' },
  ]);
  const catalog = liveCatalog(
    brief,
    { BROWSERBASE_API_KEY: 'test-only' },
    { searchProducts, openBrowser },
  );
  const context = liveContext();
  const first = await catalog.search(query(brief, 0, 'top shirt'), context);
  expect(first[0]).toMatchObject({
    productId: '12',
    variantId: '42',
    price: { amount: 1000, currency: 'CAD' },
    attributes: { size: 'M' },
    imageUrl: 'https://cdn.shop.example/shirt.jpg',
    productUrl: 'https://shop.example/products/shirt?variant=42',
  });
  expect(readPage.mock.calls.map(([url]) => url)).toEqual([
    'https://shop.example/products/shirt',
    'https://shop.example/products/shirt.js',
    'https://shop.example/cart.js',
  ]);
  // A second query for the same slot reuses the cached page and the cached merchant currency.
  const second = await catalog.search(query(brief, 0, 'cotton shirt'), context);
  expect(second).toHaveLength(1);
  expect(searchProducts).toHaveBeenCalledTimes(2);
  expect(readPage).toHaveBeenCalledTimes(3);
  expect(searchProducts).toHaveBeenCalledWith(
    expect.objectContaining({ apiKey: 'test-only', limit: 6, signal: context.signal }),
  );
});

it('reuses a cached search and never re-reads a repeated candidate URL', async () => {
  const brief = briefWithSlots([{ category: 'top' }]);
  const { readPage, openBrowser } = fakeBrowser(() => ({
    html: jsonLdPage({ title: 'Olive shirt', sku: 'SH-1', price: '30.00', currency: 'CAD' }),
  }));
  const searchProducts = vi.fn(async () => [
    { title: 'a', url: 'https://plain.example/products/olive-shirt' },
    { title: 'b', url: 'https://plain.example/products/olive-shirt?variant=2' },
  ]);
  const catalog = liveCatalog(
    brief,
    { BROWSERBASE_API_KEY: 'test-only' },
    { searchProducts, openBrowser },
  );
  const context = liveContext();
  const one = await catalog.search(query(brief), context);
  const two = await catalog.search(query(brief), context);
  expect(two).toBe(one);
  expect(searchProducts).toHaveBeenCalledTimes(1);
  expect(readPage).toHaveBeenCalledTimes(1);
});

it('gives every slot a verified offer under a constrained fetch budget', async () => {
  const brief = briefWithSlots([
    { category: 'shirt' },
    { category: 'shorts' },
    { category: 'desk' },
    { category: 'lamp' },
  ]);
  const budget = createRunBudget({ fetch: 12 });
  const { readPage, openBrowser } = fakeBrowser((url) => ({
    html: jsonLdPage({
      title: new URL(url).hostname,
      sku: new URL(url).hostname,
      price: '25.00',
      currency: 'CAD',
    }),
  }));
  const searchProducts = vi.fn(async ({ query: text }: { query: string }) => {
    const token = text.split(' ')[0];
    return [1, 2, 3, 4, 5].map((n) => ({
      title: `${token}-${n}`,
      url: `https://${token}-${n}.example/products/item`,
    }));
  });
  const catalog = liveCatalog(
    brief,
    { BROWSERBASE_API_KEY: 'test-only' },
    { searchProducts, openBrowser },
  );
  const context = liveContext(budget);
  const results = await Promise.all(
    brief.slots.map((slot, index) =>
      catalog.search({ ...query(brief, index, `${slot.category} olive`) }, context),
    ),
  );
  // Every slot gets a strong verified product before extra budget is spent on redundant pages.
  expect(results.map((offers) => offers.length)).toEqual([1, 1, 1, 1]);
  expect(budget.usage().fetch).toBe(4);
  expect(readPage).toHaveBeenCalledTimes(4);
});

it('reports a starved slot as budget exhausted instead of silently empty', async () => {
  const brief = briefWithSlots([{ category: 'shirt' }, { category: 'shorts' }]);
  const { openBrowser } = fakeBrowser(() => ({
    html: jsonLdPage({ title: 'Item', sku: 'IT-1', price: '10.00', currency: 'CAD' }),
  }));
  const searchProducts = vi.fn(async ({ query: text }: { query: string }) => [
    { title: 'a', url: `https://${text.split(' ')[0]}.example/products/item` },
  ]);
  const catalog = liveCatalog(
    brief,
    { BROWSERBASE_API_KEY: 'test-only' },
    { searchProducts, openBrowser, fetchBudget: 1 },
  );
  const context = liveContext(createRunBudget({ fetch: 1 }));
  // One fetch unit cannot cover two slots, so the slot that misses out says why.
  await expect(catalog.search(query(brief, 0, 'shirt'), context)).resolves.toHaveLength(1);
  await expect(catalog.search(query(brief, 1, 'shorts'), context)).rejects.toThrow('budget');
});

it('skips an unsupported page, an unsafe redirect and a failed navigation, then verifies the next candidate', async () => {
  const brief = briefWithSlots([{ category: 'top' }]);
  const { readPage, openBrowser } = fakeBrowser((url) => {
    if (url === 'https://blog.example/products/a')
      return { html: '<html><body>An article</body></html>' };
    if (url === 'https://redirect.example/products/b') {
      return { html: '<html></html>', finalUrl: 'https://10.0.0.5/products/b' };
    }
    if (url === 'https://good.example/products/c') {
      return {
        html: jsonLdPage({ title: 'Olive shirt', sku: 'G-1', price: '55.00', currency: 'CAD' }),
      };
    }
    return undefined;
  });
  const searchProducts = vi.fn(async () => [
    { title: 'a', url: 'https://blog.example/products/a' },
    { title: 'b', url: 'https://redirect.example/products/b' },
    { title: 'c', url: 'https://good.example/products/c' },
  ]);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const catalog = liveCatalog(
    brief,
    { BROWSERBASE_API_KEY: 'test-only' },
    { searchProducts, openBrowser, fetchBudget: 6 },
  );
  const offers = await catalog.search(query(brief), liveContext());
  expect(offers).toHaveLength(1);
  expect(offers[0]?.merchant.domain).toBe('good.example');
  expect(readPage).toHaveBeenCalledTimes(3);
  const failures = warn.mock.calls.map(([, payload]) => JSON.parse(String(payload)).failure);
  expect(failures).toEqual(['unsupported_product_page', 'unsafe_url']);
  // Logs carry codes and hosts only: no shopper text, page bodies or provider messages.
  const logged = JSON.parse(String(warn.mock.calls[0]?.[1]));
  expect(Object.keys(logged).sort()).toEqual([
    'category',
    'event',
    'failure',
    'host',
    'sessionId',
    'slotId',
  ]);
  warn.mockRestore();
});

it('runs one broader fallback query when the planned query verifies nothing', async () => {
  const brief = briefWithSlots([{ category: 'top', description: "women's linen top" }]);
  const { openBrowser } = fakeBrowser((url) =>
    url.includes('found.example')
      ? { html: jsonLdPage({ title: 'Linen top', sku: 'L-1', price: '70.00', currency: 'CAD' }) }
      : { html: '<html><body>no products</body></html>' },
  );
  const searchProducts = vi.fn(async ({ query: text }: { query: string }) =>
    text.includes('linen')
      ? [{ title: 'x', url: 'https://empty.example/products/x' }]
      : [{ title: 'y', url: 'https://found.example/products/y' }],
  );
  const catalog = liveCatalog(
    brief,
    { BROWSERBASE_API_KEY: 'test-only' },
    { searchProducts, openBrowser },
  );
  const context = liveContext();
  const offers = await catalog.search(query(brief, 0, 'top linen'), context);
  expect(searchProducts.mock.calls.map(([call]) => call.query)).toEqual([
    'women top linen Canada',
    'women top Canada',
  ]);
  expect(offers).toHaveLength(1);
  expect(context.consume).toHaveBeenCalledWith('catalog_query', 1);
});

it('drops offers for the opposite audience when the brief states one', async () => {
  const brief = briefWithSlots([{ category: 'top', description: "women's olive top" }]);
  const titles: Record<string, [string, string]> = {
    'https://shop.example/products/shirt': ["Men's olive shirt", 'M-1'],
    'https://shop.example/products/blouse': ["Women's olive blouse", 'W-1'],
  };
  const { openBrowser } = fakeBrowser((url) => {
    const [title, sku] = titles[url] ?? [];
    return title && sku
      ? { html: jsonLdPage({ title, sku, price: '40.00', currency: 'CAD' }) }
      : undefined;
  });
  const searchProducts = vi.fn(async () => [
    { title: 'a', url: 'https://shop.example/products/shirt' },
    { title: 'b', url: 'https://shop.example/products/blouse' },
  ]);
  const catalog = liveCatalog(
    brief,
    { BROWSERBASE_API_KEY: 'test-only' },
    { searchProducts, openBrowser, fetchBudget: 6 },
  );
  const offers = await catalog.search(query(brief, 0, 'top olive'), liveContext());
  expect(offers.map((offer) => offer.title)).toEqual(["Women's olive blouse"]);
});

it('stops on cancellation and closes the session exactly once', async () => {
  const brief = briefWithSlots([{ category: 'top' }]);
  const controller = new AbortController();
  const { close, openBrowser } = fakeBrowser(() => {
    controller.abort();
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  });
  const searchProducts = vi.fn(async () => [
    { title: 'a', url: 'https://shop.example/products/a' },
  ]);
  const catalog = liveCatalog(
    brief,
    { BROWSERBASE_API_KEY: 'test-only' },
    { searchProducts, openBrowser },
  );
  await expect(
    catalog.search(query(brief), {
      sampleOrigin: 'live',
      signal: controller.signal,
      consume() {},
    }),
  ).rejects.toThrow();
  await catalog.close();
  await catalog.close();
  expect(close).toHaveBeenCalledTimes(1);
});

it('never contacts providers for a synthetic brief or a pre-cancelled run', async () => {
  const openBrowser = vi.fn();
  const searchProducts = vi.fn();
  const brief = IntentBriefSchema.parse(seed);
  const catalog = liveCatalog(brief, {}, { searchProducts, openBrowser });
  await expect(
    catalog.search(query(brief), {
      sampleOrigin: 'seed',
      signal: new AbortController().signal,
      consume() {},
    }),
  ).rejects.toThrow('live brief');
  const live = liveCatalog({ ...brief, sampleOrigin: 'live' }, {}, { searchProducts, openBrowser });
  await expect(
    live.search(query(brief), { sampleOrigin: 'live', signal: AbortSignal.abort(), consume() {} }),
  ).rejects.toThrow();
  expect(searchProducts).not.toHaveBeenCalled();
  expect(openBrowser).not.toHaveBeenCalled();
});

it('requires explicit credentials for live catalog composition', () => {
  expect(() => defaultProviders({ CATALOG_PROVIDER: 'browserbase' })).toThrow('requires');
  expect(
    typeof defaultProviders({
      CATALOG_PROVIDER: 'browserbase',
      BROWSERBASE_API_KEY: 'test-only',
    }).catalog,
  ).toBe('function');
});
