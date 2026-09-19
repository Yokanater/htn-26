import type { ShoppingContext } from '@sei/core';
import { describe, expect, it, vi } from 'vitest';
import {
  createFixtureShoppingCatalog,
  createInjectedShoppingCatalog,
  MAX_OFFERS_PER_SLOT,
} from '../src/injected-catalog';
import { normalizeCatalogHits } from '../src/normalize';
import { SYNTHETIC_OUTFIT_HITS, SYNTHETIC_SETUP_HITS } from './fixtures/synthetic-catalog-hits';

function context(overrides?: Partial<ShoppingContext>): ShoppingContext {
  return {
    signal: overrides?.signal ?? new AbortController().signal,
    sampleOrigin: overrides?.sampleOrigin ?? 'seed',
    consume: overrides?.consume ?? vi.fn(),
  };
}

describe('createInjectedShoppingCatalog', () => {
  it('searches synthetic outfit and setup hits through normalize', async () => {
    const outfitCatalog = createInjectedShoppingCatalog({
      hits: SYNTHETIC_OUTFIT_HITS,
      sampleOrigin: 'seed',
    });
    const jackets = await outfitCatalog.search(
      { slotId: 'slot_1', text: 'jacket', country: 'CA', currency: 'CAD', limit: 8 },
      context(),
    );
    expect(jackets.length).toBe(2);
    expect(new Set(jackets.map((o) => o.merchant.domain)).size).toBe(2);
    expect(jackets.every((o) => o.productId === 'product-jacket')).toBe(true);

    const setupCatalog = createInjectedShoppingCatalog({
      hits: SYNTHETIC_SETUP_HITS,
      sampleOrigin: 'seed',
    });
    const desks = await setupCatalog.search(
      { slotId: 'slot_2', text: 'desk', country: 'CA', currency: 'CAD', limit: 8 },
      context(),
    );
    expect(desks.length).toBe(2);
    expect(desks.some((o) => o.shipsTo === null)).toBe(true);
  });

  it('keeps unknown price and shipping unknown from synthetic hits', async () => {
    const catalog = createInjectedShoppingCatalog({
      hits: SYNTHETIC_OUTFIT_HITS,
      sampleOrigin: 'seed',
    });
    const bags = await catalog.search(
      { slotId: 'slot_1', text: 'tote', country: 'CA', currency: 'CAD', limit: 8 },
      context(),
    );
    expect(bags[0]?.price).toBeNull();
    expect(bags[0]?.shipsTo).toBeNull();
    expect(bags[0]?.availability).toBe('unknown');
  });

  it('enforces the per-slot cap and consumes budget', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...SYNTHETIC_OUTFIT_HITS[0]!,
      productId: `product-${i}`,
      variantId: `variant-${i}`,
      title: `Synthetic item ${i}`,
      productUrl: `https://synthetic-outfit-a.example/products/${i}`,
    }));
    const consume = vi.fn();
    const catalog = createInjectedShoppingCatalog({ hits: many, sampleOrigin: 'seed' });
    const result = await catalog.search(
      { slotId: 'slot_1', text: 'Synthetic', country: 'CA', currency: 'CAD', limit: 99 },
      context({ consume }),
    );
    expect(result.length).toBeLessThanOrEqual(MAX_OFFERS_PER_SLOT);
    expect(consume).toHaveBeenCalledWith('catalog_query', 1);
  });

  it('rejects when aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    const catalog = createInjectedShoppingCatalog({
      hits: SYNTHETIC_OUTFIT_HITS,
      sampleOrigin: 'seed',
    });
    await expect(
      catalog.search(
        { slotId: 'slot_1', text: 'jacket', country: 'CA', currency: 'CAD', limit: 8 },
        context({ signal: controller.signal }),
      ),
    ).rejects.toThrow(/stop|cancelled/i);
  });

  it('merges hitSource results without mutating static hits', async () => {
    const originalTitle = SYNTHETIC_SETUP_HITS[0]!.title;
    const catalog = createInjectedShoppingCatalog({
      hits: [SYNTHETIC_SETUP_HITS[2]!],
      hitSource: async () => [SYNTHETIC_SETUP_HITS[0]!],
      sampleOrigin: 'seed',
    });
    const desks = await catalog.search(
      { slotId: 'slot_1', text: 'desk', country: 'CA', currency: 'CAD', limit: 8 },
      context(),
    );
    expect(desks.some((o) => o.category === 'desk')).toBe(true);
    expect(SYNTHETIC_SETUP_HITS[0]!.title).toBe(originalTitle);
  });

  it('createFixtureShoppingCatalog remains a thin offers wrapper', async () => {
    const { offers } = normalizeCatalogHits(SYNTHETIC_OUTFIT_HITS, { sampleOrigin: 'seed' });
    const viaFixture = createFixtureShoppingCatalog(offers);
    const viaInjected = createInjectedShoppingCatalog({ offers, sampleOrigin: 'seed' });
    const q = {
      slotId: 'slot_1' as const,
      text: 'jacket',
      country: 'CA',
      currency: 'CAD',
      limit: 8,
    };
    const a = await viaFixture.search(q, context());
    const b = await viaInjected.search(q, context());
    expect(a.map((o) => o.merchant.domain).sort()).toEqual(b.map((o) => o.merchant.domain).sort());
  });

  it('profiles a merchant domain from synthetic inventory', async () => {
    const catalog = createInjectedShoppingCatalog({
      hits: SYNTHETIC_OUTFIT_HITS,
      sampleOrigin: 'seed',
    });
    const profile = await catalog.profileMerchant('synthetic-outfit-a.example', context());
    expect(profile.merchant.domain).toBe('synthetic-outfit-a.example');
    expect(profile.offers.length).toBeGreaterThan(0);
  });
});
