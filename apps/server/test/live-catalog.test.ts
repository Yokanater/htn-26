import { IntentBriefSchema } from '@sei/contracts';
import type { ShoppingContext } from '@sei/core';
import { afterEach, expect, it, vi } from 'vitest';
import seed from '../../../fixtures/seed/outfit/brief.json';
import { defaultProviders } from '../src/providers';
import { liveCatalog } from '../src/services/live-catalog';

vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
}));
afterEach(() => vi.unstubAllGlobals());

it('maps verified seller variants without guessing shipping and keeps query variants distinct', async () => {
  const brief = IntentBriefSchema.parse({ ...seed, sampleOrigin: 'live' });
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/products/shirt.js'))
      return Response.json({
        id: 12,
        title: 'Shirt',
        featured_image: null,
        options: [{ name: 'Size', position: 1 }],
        variants: [{ id: 42, title: 'Medium', available: true, price: 1000, option1: 'M' }],
      });
    if (url.endsWith('/cart.js')) return Response.json({ currency: 'CAD' });
    throw new Error(`Unexpected fake URL: ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  const searchProducts = vi.fn(async () => [
    { title: 'Shirt', url: 'https://shop.example/products/shirt' },
  ]);
  const catalog = liveCatalog(
    brief,
    {
      BROWSERBASE_API_KEY: 'test-only',
    },
    { searchProducts },
  );
  const context: ShoppingContext = {
    sampleOrigin: 'live',
    signal: new AbortController().signal,
    consume: vi.fn(),
  };
  const query = {
    slotId: brief.slots[0]!.id,
    text: 'neutral shirt',
    country: 'CA',
    currency: 'CAD',
    limit: 8,
  };
  const offers = await catalog.search(query, context);
  expect(offers).toHaveLength(1);
  expect(offers[0]).toMatchObject({
    productId: '12',
    variantId: '42',
    merchant: { domain: 'shop.example' },
    attributes: { size: 'M' },
    price: { amount: 1000, currency: 'CAD' },
    shipsTo: null,
    sampleOrigin: 'live',
  });
  await catalog.search(query, context);
  await catalog.search({ ...query, text: 'cotton shirt' }, context);
  expect(searchProducts).toHaveBeenCalledTimes(2);
  expect(searchProducts).toHaveBeenCalledWith(
    expect.objectContaining({ apiKey: 'test-only', limit: 4, signal: context.signal }),
  );
});

it('never contacts providers for a synthetic brief or a pre-cancelled run', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const brief = IntentBriefSchema.parse(seed);
  const query = {
    slotId: brief.slots[0]!.id,
    text: 'shirt',
    country: 'CA',
    currency: 'CAD',
    limit: 8,
  };
  const catalog = liveCatalog(brief, {});
  await expect(
    catalog.search(query, {
      sampleOrigin: 'seed',
      signal: new AbortController().signal,
      consume() {},
    }),
  ).rejects.toThrow('live brief');
  const live = liveCatalog({ ...brief, sampleOrigin: 'live' }, {});
  await expect(
    live.search(query, { sampleOrigin: 'live', signal: AbortSignal.abort(), consume() {} }),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
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
