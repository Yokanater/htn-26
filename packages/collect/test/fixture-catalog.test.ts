import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ProductOffer, ProductOfferSchema } from '@sei/contracts';
import type { ShoppingContext } from '@sei/core';
import { describe, expect, it, vi } from 'vitest';
import { createFixtureShoppingCatalog, MAX_OFFERS_PER_SLOT } from '../src/fixture-catalog';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function loadOffers(domain: 'outfit' | 'setup'): ProductOffer[] {
  const raw = JSON.parse(
    readFileSync(join(root, `fixtures/seed/${domain}/offers.json`), 'utf8'),
  ) as unknown[];
  return raw.map((item) => ProductOfferSchema.parse(item));
}

function context(overrides?: Partial<ShoppingContext>): ShoppingContext {
  const consume = vi.fn();
  return {
    signal: overrides?.signal ?? new AbortController().signal,
    sampleOrigin: overrides?.sampleOrigin ?? 'seed',
    consume: overrides?.consume ?? consume,
  };
}

describe('createFixtureShoppingCatalog', () => {
  it('returns outfit and setup offers without mutating fixtures', async () => {
    const outfit = loadOffers('outfit');
    const setup = loadOffers('setup');
    const originalTitle = outfit[0]!.title;
    const catalog = createFixtureShoppingCatalog([...outfit, ...setup]);

    const tops = await catalog.search(
      { slotId: 'slot_1', text: 'top', country: 'CA', currency: 'CAD', limit: 8 },
      context(),
    );
    expect(tops.some((o) => o.category === 'top')).toBe(true);

    const desks = await catalog.search(
      { slotId: 'slot_2', text: 'desk', country: 'CA', currency: 'CAD', limit: 8 },
      context(),
    );
    expect(desks.some((o) => o.category === 'desk')).toBe(true);

    tops[0]!.title = 'mutated';
    expect(outfit[0]!.title).toBe(originalTitle);
  });

  it('enforces the per-slot cap and consumes budget', async () => {
    const offers = loadOffers('outfit');
    const catalog = createFixtureShoppingCatalog(offers);
    const ctx = context();
    const result = await catalog.search(
      { slotId: 'slot_1', text: 'synthetic', country: 'CA', currency: 'CAD', limit: 99 },
      ctx,
    );
    expect(result.length).toBeLessThanOrEqual(MAX_OFFERS_PER_SLOT);
    expect(ctx.consume).toHaveBeenCalledWith('catalog_query', 1);
  });

  it('rejects promptly when aborted', async () => {
    const catalog = createFixtureShoppingCatalog(loadOffers('outfit'));
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    await expect(
      catalog.search(
        { slotId: 'slot_1', text: 'top', country: 'CA', currency: 'CAD', limit: 8 },
        context({ signal: controller.signal }),
      ),
    ).rejects.toThrow(/stop|cancelled/i);
  });

  it('keeps unknown shipping and null price as unknowns', async () => {
    const base = loadOffers('outfit')[0]!;
    const unknown: ProductOffer = {
      ...base,
      id: 'offer_unknown_ship',
      title: 'Unknown ship top',
      shipsTo: null,
      price: null,
    };
    const catalog = createFixtureShoppingCatalog([unknown]);
    const [hit] = await catalog.search(
      { slotId: 'slot_1', text: 'Unknown ship', country: 'CA', currency: 'CAD', limit: 8 },
      context(),
    );
    expect(hit?.shipsTo).toBeNull();
    expect(hit?.price).toBeNull();
  });

  it('returns deterministic ordering', async () => {
    const catalog = createFixtureShoppingCatalog(loadOffers('setup'));
    const a = await catalog.search(
      { slotId: 'slot_1', text: 'synthetic', country: 'CA', currency: 'CAD', limit: 8 },
      context(),
    );
    const b = await catalog.search(
      { slotId: 'slot_1', text: 'synthetic', country: 'CA', currency: 'CAD', limit: 8 },
      context(),
    );
    expect(a.map((o) => o.id)).toEqual(b.map((o) => o.id));
  });
});
