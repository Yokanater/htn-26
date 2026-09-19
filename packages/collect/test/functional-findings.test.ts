import type { ShoppingContext } from '@sei/core';
import { describe, expect, it, vi } from 'vitest';
import { createInjectedShoppingCatalog, MAX_OFFERS_PER_SLOT } from '../src/injected-catalog';
import { normalizeCatalogHits, normalizeCatalogInventory } from '../src/normalize';

function context(overrides?: Partial<ShoppingContext>): ShoppingContext {
  return {
    signal: overrides?.signal ?? new AbortController().signal,
    sampleOrigin: overrides?.sampleOrigin ?? 'seed',
    consume: overrides?.consume ?? vi.fn(),
  };
}

function hit(overrides: Record<string, unknown>) {
  return {
    merchant: { name: 'A', domain: 'a.example' },
    productId: 'p1',
    variantId: 'v1',
    title: 'Item',
    category: 'top',
    productUrl: 'https://a.example/products/p1',
    ...overrides,
  };
}

describe('stable identities', () => {
  it('returns identical offer and evidence IDs for identical dynamic searches', async () => {
    const catalog = createInjectedShoppingCatalog({
      hitSource: async () => [hit({ title: 'Jacket', productId: 'jacket', variantId: 'm' })],
      sampleOrigin: 'seed',
    });
    const q = {
      slotId: 'slot_1',
      text: 'Jacket',
      country: 'CA',
      currency: 'CAD',
      limit: 8,
    };
    const first = await catalog.search(q, context());
    const second = await catalog.search(q, context());
    expect(first[0]?.id).toBe(second[0]?.id);
    expect(first[0]?.evidence.map((e) => e.id)).toEqual(second[0]?.evidence.map((e) => e.id));
    expect(first[0]?.merchant.id).toBe(second[0]?.merchant.id);
  });

  it('reuses identity across different queries that return the same logical offer', async () => {
    const catalog = createInjectedShoppingCatalog({
      hitSource: async (query) => {
        if (!/jacket|linen/i.test(query.text)) return [];
        return [hit({ title: 'Linen jacket', productId: 'jacket', variantId: 'm' })];
      },
      sampleOrigin: 'seed',
    });
    const a = await catalog.search(
      { slotId: 'slot_1', text: 'jacket', country: 'CA', currency: 'CAD', limit: 8 },
      context(),
    );
    const b = await catalog.search(
      { slotId: 'slot_1', text: 'linen', country: 'CA', currency: 'CAD', limit: 8 },
      context(),
    );
    expect(a[0]?.id).toBe(b[0]?.id);
    expect(a[0]?.merchant.id).toBe(b[0]?.merchant.id);
  });

  it('shares identities between search and profileMerchant', async () => {
    const catalog = createInjectedShoppingCatalog({
      hits: [
        hit({
          merchant: { name: 'A', domain: 'shared.example' },
          productUrl: 'https://shared.example/products/p1',
        }),
      ],
      sampleOrigin: 'seed',
    });
    const found = await catalog.search(
      { slotId: 'slot_1', text: 'Item', country: 'CA', currency: 'CAD', limit: 8 },
      context(),
    );
    const profile = await catalog.profileMerchant('shared.example', context());
    expect(profile.merchant.id).toBe(found[0]?.merchant.id);
    expect(profile.offers[0]?.id).toBe(found[0]?.id);
    expect(profile.offers.every((o) => o.merchant.id === profile.merchant.id)).toBe(true);
  });

  it('maps one domain to one merchant ID across products; sellers stay distinct', () => {
    const { offers } = normalizeCatalogInventory(
      [
        hit({
          merchant: { name: 'A', domain: 'same.example' },
          productId: 'p1',
          productUrl: 'https://same.example/products/p1',
        }),
        hit({
          merchant: { name: 'A', domain: 'same.example' },
          productId: 'p2',
          variantId: 'v2',
          title: 'Other',
          productUrl: 'https://same.example/products/p2',
        }),
        hit({
          merchant: { name: 'B', domain: 'other.example' },
          productId: 'p1',
          productUrl: 'https://other.example/products/p1',
        }),
      ],
      { sampleOrigin: 'seed' },
    );
    const sameDomain = offers.filter((o) => o.merchant.domain === 'same.example');
    expect(sameDomain).toHaveLength(2);
    expect(sameDomain[0]?.merchant.id).toBe(sameDomain[1]?.merchant.id);
    expect(offers.find((o) => o.merchant.domain === 'other.example')?.merchant.id).not.toBe(
      sameDomain[0]?.merchant.id,
    );
    expect(offers.filter((o) => o.productId === 'p1')).toHaveLength(2);
  });
});

describe('inventory size vs search cap', () => {
  it('retains 12+ static offers and can return/profile items past position eight', async () => {
    const hits = Array.from({ length: 12 }, (_, i) =>
      hit({
        productId: `product-${i}`,
        variantId: `variant-${i}`,
        title: `UniqueTitle${i}`,
        productUrl: `https://a.example/products/${i}`,
        merchant:
          i === 10
            ? { name: 'Late', domain: 'late-merchant.example' }
            : { name: 'A', domain: 'a.example' },
        ...(i === 10 ? { productUrl: 'https://late-merchant.example/products/10' } : {}),
      }),
    );
    const catalog = createInjectedShoppingCatalog({ hits, sampleOrigin: 'seed' });

    const late = await catalog.search(
      { slotId: 'slot_1', text: 'UniqueTitle10', country: 'CA', currency: 'CAD', limit: 8 },
      context(),
    );
    expect(late).toHaveLength(1);
    expect(late[0]?.title).toBe('UniqueTitle10');

    const profile = await catalog.profileMerchant('late-merchant.example', context());
    expect(profile.offers.length).toBeGreaterThan(0);

    const broad = await catalog.search(
      { slotId: 'slot_1', text: 'UniqueTitle', country: 'CA', currency: 'CAD', limit: 99 },
      context(),
    );
    expect(broad.length).toBeLessThanOrEqual(MAX_OFFERS_PER_SLOT);

    expect(
      (
        await catalog.search(
          { slotId: 'slot_1', text: 'UniqueTitle', country: 'CA', currency: 'CAD', limit: 0 },
          context(),
        )
      ).length,
    ).toBe(0);
    expect(
      (
        await catalog.search(
          { slotId: 'slot_1', text: 'UniqueTitle', country: 'CA', currency: 'CAD', limit: -3 },
          context(),
        )
      ).length,
    ).toBe(0);
  });
});

describe('cancellation after async hitSource', () => {
  it('does not invoke the source when already aborted', async () => {
    const hitSource = vi.fn(async () => [hit({})]);
    const controller = new AbortController();
    controller.abort(new Error('already'));
    const catalog = createInjectedShoppingCatalog({ hitSource, sampleOrigin: 'seed' });
    await expect(
      catalog.search(
        { slotId: 'slot_1', text: 'Item', country: 'CA', currency: 'CAD', limit: 8 },
        context({ signal: controller.signal }),
      ),
    ).rejects.toThrow(/already|cancelled/i);
    expect(hitSource).not.toHaveBeenCalled();
  });

  it('rejects after abort during awaited dynamic search and returns no result', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hitSource = vi.fn(async () => {
      await gate;
      return [hit({})];
    });
    const controller = new AbortController();
    const catalog = createInjectedShoppingCatalog({ hitSource, sampleOrigin: 'seed' });
    const pending = catalog.search(
      { slotId: 'slot_1', text: 'Item', country: 'CA', currency: 'CAD', limit: 8 },
      context({ signal: controller.signal }),
    );
    await vi.waitFor(() => expect(hitSource).toHaveBeenCalled());
    controller.abort(new Error('mid-flight'));
    release();
    await expect(pending).rejects.toThrow(/mid-flight|cancelled/i);
  });

  it('rejects after abort during awaited dynamic merchant lookup', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hitSource = vi.fn(async () => {
      await gate;
      return [
        hit({
          merchant: { name: 'Dyn', domain: 'dyn.example' },
          productUrl: 'https://dyn.example/products/p1',
        }),
      ];
    });
    const controller = new AbortController();
    const catalog = createInjectedShoppingCatalog({ hitSource, sampleOrigin: 'seed' });
    const pending = catalog.profileMerchant('dyn.example', context({ signal: controller.signal }));
    await vi.waitFor(() => expect(hitSource).toHaveBeenCalled());
    controller.abort(new Error('profile-abort'));
    release();
    await expect(pending).rejects.toThrow(/profile-abort|cancelled/i);
  });

  it('consumes catalog_query exactly once per search', async () => {
    const consume = vi.fn();
    const catalog = createInjectedShoppingCatalog({
      hitSource: async () => [hit({})],
      sampleOrigin: 'seed',
    });
    await catalog.search(
      { slotId: 'slot_1', text: 'Item', country: 'CA', currency: 'CAD', limit: 8 },
      context({ consume }),
    );
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledWith('catalog_query', 1);
  });
});

describe('invalid evidence URL', () => {
  it('does not abort the batch; diagnoses and keeps later valid hits', () => {
    const { offers, diagnostics } = normalizeCatalogHits(
      [
        hit({
          evidenceUrl: 'http://insecure.example/ev',
          title: 'Bad evidence',
        }),
        hit({
          productId: 'p2',
          variantId: 'v2',
          title: 'Good later',
          productUrl: 'https://a.example/products/p2',
        }),
      ],
      { sampleOrigin: 'seed' },
    );
    expect(diagnostics.some((d) => /invalid evidenceUrl/i.test(d))).toBe(true);
    expect(offers.map((o) => o.title)).toEqual(['Good later']);
  });
});

describe('mutation and cloning', () => {
  it('does not mutate inputs; returned results are isolated clones', async () => {
    const source = [
      hit({
        merchant: { name: 'A', domain: 'clone.example' },
        productUrl: 'https://clone.example/products/p1',
      }),
    ];
    const catalog = createInjectedShoppingCatalog({ hits: source, sampleOrigin: 'seed' });
    const first = await catalog.search(
      { slotId: 'slot_1', text: 'Item', country: 'CA', currency: 'CAD', limit: 8 },
      context(),
    );
    first[0]!.title = 'mutated';
    (source[0] as { title: string }).title = 'source-mutated';
    const second = await catalog.search(
      { slotId: 'slot_1', text: 'Item', country: 'CA', currency: 'CAD', limit: 8 },
      context(),
    );
    expect(second[0]?.title).toBe('Item');
  });
});
