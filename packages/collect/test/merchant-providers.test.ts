import { describe, expect, it, vi } from 'vitest';
import { createBasetenCatalogExtractor } from '../src/merchant/baseten';
import { createLiveMerchantProfiler } from '../src/merchant/workflow';

describe.each(['outfit', 'setup'] as const)('%s provider pipeline', (domain) => {
  it('combines browser capture, verified variants and quoted Baseten facts', async () => {
    const progress = vi.fn();
    const browser = vi.fn(async () => ({
      url: 'https://store.example/collections/all',
      text: 'Products',
      productUrls: ['https://store.example/products/item'],
    }));
    const fetch = vi.fn(async (url: string | URL | Request) =>
      Response.json(
        String(url).endsWith('/cart.js')
          ? { currency: 'CAD' }
          : {
              id: 123,
              title: 'Natural item',
              description: 'Made from linen',
              variants: [{ id: 456, title: 'Default Title', price: 1299, available: true }],
            },
      ),
    );
    const model = vi.fn(async () =>
      Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                products: [
                  {
                    productId: '123',
                    category: domain === 'outfit' ? 'top' : 'lighting',
                    material: 'linen',
                    materialQuote: 'Made from linen',
                    function: null,
                    functionQuote: null,
                  },
                ],
              }),
            },
          },
        ],
      }),
    );
    const profiler = createLiveMerchantProfiler({
      browser,
      fetch,
      lookup: async () => [{ address: '93.184.216.34' }],
      extract: createBasetenCatalogExtractor({ apiKey: 'test', model: 'test', fetch: model }),
    });
    const result = await profiler.profile({
      url: 'https://store.example',
      domain,
      signal: new AbortController().signal,
      progress,
      liveView: vi.fn(),
    });
    expect(result.offers[0]).toMatchObject({
      price: { amount: 1299, currency: 'CAD' },
      variantId: '456',
      attributes: { material: 'linen' },
      sampleOrigin: 'live',
      shipsTo: null,
    });
    expect(result.offers[0].evidence.some((item) => item.value === 'Made from linen')).toBe(true);
    expect(browser).toHaveBeenCalledOnce();
    expect(model).toHaveBeenCalledOnce();
    expect(progress.mock.calls.map((call) => call[0])).toEqual(['browser', 'verify', 'extract']);
  });
  it('rejects hallucinated quotes and unknown product references', async () => {
    for (const product of [
      { productId: 'other', material: null, materialQuote: null },
      { productId: '123', material: 'silk', materialQuote: 'Made from silk' },
    ]) {
      const extract = createBasetenCatalogExtractor({
        apiKey: 'test',
        model: 'test',
        fetch: async () =>
          Response.json({
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  content: JSON.stringify({
                    products: [
                      { ...product, category: 'top', function: null, functionQuote: null },
                    ],
                  }),
                },
              },
            ],
          }),
      });
      await expect(
        extract(
          [{ productId: '123', title: 'Item', description: 'linen' }],
          domain,
          new AbortController().signal,
        ),
      ).rejects.toThrow();
    }
  });
  it('retains verified products on model outage without inventing unknown facts', async () => {
    const profiler = createLiveMerchantProfiler({
      browser: async () => ({
        url: 'https://store.example',
        text: '',
        productUrls: ['https://store.example/products/item'],
      }),
      lookup: async () => [{ address: '93.184.216.34' }],
      fetch: async (url) =>
        String(url).includes('cart.js')
          ? new Response('', { status: 503 })
          : Response.json({
              id: 1,
              title: 'Item',
              type: 'desk',
              variants: [{ id: 2, title: 'Default Title', price: 1, available: true }],
            }),
      extract: async () => {
        throw new Error('Outage');
      },
    });
    const result = await profiler.profile({
      url: 'https://store.example',
      domain,
      signal: new AbortController().signal,
      progress: vi.fn(),
      liveView: vi.fn(),
    });
    expect(result.offers[0].price).toBeNull();
    expect(result.offers[0].attributes).toEqual({});
    expect(result.warnings.join(' ')).toContain('Baseten extraction unavailable');
  });
});
