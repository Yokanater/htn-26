import { IntentBriefSchema } from '@sei/contracts';
import type { ShoppingContext } from '@sei/core';
import { expect, it, vi } from 'vitest';
import seed from '../../../fixtures/seed/outfit/brief.json';
import { defaultProviders } from '../src/providers';
import { liveCatalog } from '../src/services/live-catalog';

vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
}));
it('maps verified seller variants without guessing shipping and keeps query variants distinct', async () => {
  const brief = IntentBriefSchema.parse({ ...seed, sampleOrigin: 'live' });
  const close = vi.fn(async () => undefined);
  const readPage = vi.fn(async (url: string) => {
    const text = url.endsWith('/products/shirt.js')
      ? JSON.stringify({
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
        })
      : JSON.stringify({ currency: 'CAD' });
    return { requestedUrl: url, finalUrl: url, title: '', text, sessionId: 'bb_test' };
  });
  const openBrowser = vi.fn(async () => ({ sessionId: 'bb_test', readPage, close }));
  const searchProducts = vi.fn(async () => [
    { title: 'Shirt', url: 'https://shop.example/products/shirt' },
  ]);
  const catalog = liveCatalog(
    brief,
    {
      BROWSERBASE_API_KEY: 'test-only',
    },
    { searchProducts, openBrowser },
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
  expect(openBrowser).toHaveBeenCalledTimes(1);
  expect(readPage).toHaveBeenCalledWith('https://shop.example/products/shirt.js', context.signal);
  expect(readPage).toHaveBeenCalledWith('https://shop.example/cart.js', context.signal);
  expect(context.consume).toHaveBeenCalledWith('browser_session', 1);
  expect(offers[0]?.evidence.every((entry) => entry.method === 'browser')).toBe(true);
  await catalog.close();
  expect(close).toHaveBeenCalledTimes(1);
});

it('never contacts providers for a synthetic brief or a pre-cancelled run', async () => {
  const openBrowser = vi.fn();
  const searchProducts = vi.fn();
  const brief = IntentBriefSchema.parse(seed);
  const query = {
    slotId: brief.slots[0]!.id,
    text: 'shirt',
    country: 'CA',
    currency: 'CAD',
    limit: 8,
  };
  const catalog = liveCatalog(brief, {}, { searchProducts, openBrowser });
  await expect(
    catalog.search(query, {
      sampleOrigin: 'seed',
      signal: new AbortController().signal,
      consume() {},
    }),
  ).rejects.toThrow('live brief');
  const live = liveCatalog({ ...brief, sampleOrigin: 'live' }, {}, { searchProducts, openBrowser });
  await expect(
    live.search(query, { sampleOrigin: 'live', signal: AbortSignal.abort(), consume() {} }),
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
