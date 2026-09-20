import type { ShoppingContext } from '@sei/core';
import { describe, expect, it, vi } from 'vitest';
import { profileMerchantCatalog } from '../src/merchant/profile';

function context(consume = vi.fn()): ShoppingContext {
  return {
    signal: new AbortController().signal,
    sampleOrigin: 'live',
    consume,
  };
}

describe('profileMerchantCatalog', () => {
  it('profiles a large decoded Shopify homepage while retaining a hard size limit', async () => {
    const makeDeps = (size: number) => ({
      lookup: async () => [{ address: '93.184.216.34' }],
      fetch: vi.fn(async (input: string | URL | Request) =>
        String(input).includes('/products.json')
          ? Response.json({
              products: [
                {
                  id: 1,
                  handle: 'shoe',
                  title: 'Leather shoe',
                  variants: [{ id: 2, available: true }],
                },
              ],
            })
          : new Response(`<html>${' '.repeat(size)}</html>`, {
              headers: { 'content-type': 'text/html', 'content-length': '70182' },
            }),
      ),
    });
    const allowed = makeDeps(800_000);
    const result = await profileMerchantCatalog('https://store.example/', context(), allowed);
    expect(result.offers[0]?.title).toBe('Leather shoe');
    expect(allowed.fetch).toHaveBeenCalledTimes(2);
    const oversized = makeDeps(2_000_001);
    await expect(
      profileMerchantCatalog('https://store.example/', context(), oversized),
    ).rejects.toMatchObject({ code: 'body_too_large' });
    expect(oversized.fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects cross-store seller attribution even from an injected extractor', async () => {
    await expect(
      profileMerchantCatalog('https://store.example/', context(), {
        lookup: async () => [{ address: '93.184.216.34' }],
        fetch: async () => new Response('store', { headers: { 'content-type': 'text/html' } }),
        extractOffers: () => [
          {
            merchant: { name: 'Other seller', domain: 'other.example' },
            productId: 'p1',
            variantId: 'v1',
            title: 'Shirt',
            category: 'top',
            productUrl: 'https://other.example/products/shirt',
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'catalog_unavailable' });
  });

  it('does not treat a catalog redirect to another merchant as the original store inventory', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.includes('/products.json'))
        return new Response('store', { headers: { 'content-type': 'text/html' } });
      if (url.startsWith('https://store.example'))
        return new Response(null, {
          status: 302,
          headers: { location: 'https://other.example/products.json' },
        });
      return Response.json({ products: [] });
    });
    await expect(
      profileMerchantCatalog('https://store.example/', context(), {
        lookup: async () => [{ address: '93.184.216.34' }],
        fetch,
      }),
    ).rejects.toMatchObject({ code: 'catalog_unavailable' });
  });
  it('profiles outfit and setup merchants from injected extractors', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34' }]);
    const html = '<html><body>store</body></html>';
    const fetchImpl = vi.fn(async () => {
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    });

    for (const [domain, title, category] of [
      ['outfit-new.example', 'Outfit jacket', 'jacket'],
      ['setup-new.example', 'Oak desk', 'desk'],
    ] as const) {
      const result = await profileMerchantCatalog(`https://${domain}/`, context(), {
        fetch: fetchImpl as unknown as typeof fetch,
        lookup,
        extractOffers: () => [
          {
            merchant: { name: domain, domain },
            productId: 'p1',
            variantId: 'v1',
            title,
            category,
            productUrl: `https://${domain}/products/p1`,
            price: { amount: 5000, currency: 'CAD' },
            availability: 'available',
            shipsTo: ['CA'],
            attributes:
              category === 'jacket'
                ? ({ size: 'M' } as Record<string, string | number>)
                : ({ width_cm: 120 } as Record<string, string | number>),
          },
        ],
      });
      expect(result.merchant.domain).toBe(domain);
      expect(result.offers).toHaveLength(1);
      expect(result.shopifySignalsPresent).toBe(false);
    }
  });

  it('rejects unsafe URLs and unavailable catalogs', async () => {
    const lookup = vi.fn(async () => [{ address: '127.0.0.1' }]);
    await expect(
      profileMerchantCatalog('https://localhost/', context(), {
        fetch: vi.fn() as unknown as typeof fetch,
        lookup,
      }),
    ).rejects.toThrow();

    const publicLookup = vi.fn(async () => [{ address: '93.184.216.34' }]);
    await expect(
      profileMerchantCatalog('https://empty.example/', context(), {
        fetch: vi.fn(async () => {
          return new Response('<html></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          });
        }) as unknown as typeof fetch,
        lookup: publicLookup,
        extractOffers: () => [],
      }),
    ).rejects.toMatchObject({ code: 'catalog_unavailable' });
  });

  it('rejects article Product markup instead of manufacturing merchant products', async () => {
    const body = `<html><script type="application/ld+json">{"@type":"Product","name":"Candle"}</script></html>`;
    await expect(
      profileMerchantCatalog('https://claims.example/articles/best-candles', context(), {
        lookup: async () => [{ address: '93.184.216.34' }],
        fetch: vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/html' } })),
      }),
    ).rejects.toMatchObject({ code: 'content_type' });
  });

  it.each([
    ['Linen shirt', 'top'],
    ['Oak desk', 'desk'],
  ])(
    'reads actual %s inventory with source links and no guessed currency',
    async (title, category) => {
      const fetch = vi.fn(async (input: string | URL | Request) =>
        String(input).includes('/products.json')
          ? Response.json({
              products: [
                {
                  id: 1,
                  handle: 'real-product',
                  title,
                  variants: [{ id: 11, price: '42.00', available: true }],
                },
              ],
            })
          : new Response('<html>Shopify.theme = {};</html>', {
              headers: { 'content-type': 'text/html' },
            }),
      );
      const result = await profileMerchantCatalog('https://store.example/', context(), {
        fetch,
        lookup: async () => [{ address: '93.184.216.34' }],
      });
      expect(result.offers).toHaveLength(1);
      expect(result.offers[0]).toMatchObject({
        title,
        category,
        productId: '1',
        variantId: '11',
        productUrl: 'https://store.example/products/real-product',
        price: null,
        availability: 'available',
      });
      expect(result.offers[0]?.evidence[0]?.url).toBe(
        'https://store.example/products.json?limit=50&page=1',
      );
      expect(result.shopifySignalsPresent).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it('bounds repeated pagination and keeps explicit variant prices', async () => {
    const products = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      handle: `shirt-${i}`,
      title: `Shirt ${i}`,
      variants: [{ id: i + 100, price: '12.50' }],
    }));
    const fetch = vi.fn(async (input: string | URL | Request) =>
      String(input).includes('/products.json')
        ? Response.json({ products })
        : new Response(`<script>Shopify.currency = {"active":"CAD"};</script>`, {
            headers: { 'content-type': 'text/html' },
          }),
    );
    const result = await profileMerchantCatalog('https://store.example/', context(), {
      fetch,
      lookup: async () => [{ address: '93.184.216.34' }],
    });
    expect(result.offers).toHaveLength(50);
    expect(result.offers[0]?.price).toEqual({ amount: 1250, currency: 'CAD' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('canonicalizes through a safe redirect', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34' }]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: 'https://custom.example/' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('<html>ok</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      );
    const result = await profileMerchantCatalog('https://www.custom.example/', context(), {
      fetch: fetchImpl as unknown as typeof fetch,
      lookup,
      extractOffers: ({ domain }) => [
        {
          merchant: { name: 'Custom', domain },
          productId: 'p1',
          variantId: 'v1',
          title: 'Custom lamp',
          category: 'lighting',
          productUrl: `https://${domain}/products/p1`,
        },
      ],
    });
    expect(result.sourceUrl).toBe('https://custom.example/');
    expect(result.merchant.domain).toBe('custom.example');
  });
});
