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

  it('does not treat generic Product JSON-LD as Shopify proof or demand', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34' }]);
    const body = `<html><script type="application/ld+json">{"@type":"Product","name":"Candle"}</script></html>`;
    const result = await profileMerchantCatalog('https://claims.example/', context(), {
      fetch: vi.fn(async () => {
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }) as unknown as typeof fetch,
      lookup,
    });
    expect(result.shopifySignalsPresent).toBe(false);
    expect(result.merchantClaims).toContain('Candle');
    expect(result.offers[0]?.price).toBeNull();
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
