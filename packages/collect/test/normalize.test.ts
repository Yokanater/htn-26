import { describe, expect, it } from 'vitest';
import { normalizeCatalogHits, normalizeCatalogInventory } from '../src/normalize';

describe('normalizeCatalogHits', () => {
  it('keeps the same product/variant from different sellers as separate offers', () => {
    const { offers } = normalizeCatalogHits(
      [
        {
          merchant: { name: 'A', domain: 'a.example' },
          productId: 'p1',
          variantId: 'v1',
          title: 'Shared shoe',
          category: 'shoes',
          productUrl: 'https://a.example/products/p1',
          price: { amount: 1000, currency: 'CAD' },
          availability: 'available',
        },
        {
          merchant: { name: 'B', domain: 'b.example' },
          productId: 'p1',
          variantId: 'v1',
          title: 'Shared shoe',
          category: 'shoes',
          productUrl: 'https://b.example/products/p1',
          price: { amount: 1200, currency: 'CAD' },
          availability: 'available',
        },
      ],
      { sampleOrigin: 'seed' },
    );
    expect(offers).toHaveLength(2);
    expect(new Set(offers.map((o) => o.merchant.domain)).size).toBe(2);
  });

  it('deduplicates exact seller/product/variant duplicates', () => {
    const hit = {
      merchant: { name: 'A', domain: 'a.example' },
      productId: 'p1',
      variantId: 'v1',
      title: 'Item',
      category: 'top',
      productUrl: 'https://a.example/products/p1',
    };
    const { offers, diagnostics } = normalizeCatalogHits([hit, hit], { sampleOrigin: 'seed' });
    expect(offers).toHaveLength(1);
    expect(diagnostics.some((d) => /duplicate/i.test(d))).toBe(true);
  });

  it('preserves missing size, dimensions, shipping, and null price', () => {
    const { offers } = normalizeCatalogHits(
      [
        {
          merchant: { name: 'A', domain: 'a.example' },
          productId: 'p1',
          variantId: 'v1',
          title: 'Sparse',
          category: 'bag',
          productUrl: 'https://a.example/products/p1',
          price: null,
          shipsTo: null,
          attributes: {},
        },
      ],
      { sampleOrigin: 'seed' },
    );
    expect(offers[0]?.price).toBeNull();
    expect(offers[0]?.shipsTo).toBeNull();
    expect(offers[0]?.attributes.size).toBeUndefined();
    expect(offers[0]?.availability).toBe('unknown');
    expect(offers[0]?.evidence.length).toBeGreaterThan(0);
  });

  it('does not convert currencies and keeps mixed currency offers distinct', () => {
    const { offers } = normalizeCatalogHits(
      [
        {
          merchant: { name: 'A', domain: 'a.example' },
          productId: 'p1',
          variantId: 'v1',
          title: 'CAD item',
          category: 'top',
          productUrl: 'https://a.example/products/p1',
          price: { amount: 1000, currency: 'CAD' },
        },
        {
          merchant: { name: 'B', domain: 'b.example' },
          productId: 'p2',
          variantId: 'v2',
          title: 'USD item',
          category: 'top',
          productUrl: 'https://b.example/products/p2',
          price: { amount: 1000, currency: 'USD' },
        },
      ],
      { sampleOrigin: 'seed' },
    );
    expect(offers.map((o) => o.price?.currency).sort()).toEqual(['CAD', 'USD']);
  });

  it('records discovery snippets without turning them into hard attributes', () => {
    const { offers } = normalizeCatalogHits(
      [
        {
          merchant: { name: 'A', domain: 'a.example' },
          productId: 'p1',
          variantId: 'v1',
          title: 'Hinted',
          category: 'top',
          productUrl: 'https://a.example/products/p1',
          searchSnippet: 'Size M ships to Canada for $10',
          attributes: {},
        },
      ],
      { sampleOrigin: 'replay' },
    );
    expect(offers[0]?.attributes).toEqual({});
    expect(offers[0]?.evidence.some((e) => e.field === 'discovery_snippet')).toBe(true);
    expect(offers[0]?.sampleOrigin).toBe('replay');
  });

  it('omits invalid catalog hits with diagnostics', () => {
    const { offers, diagnostics } = normalizeCatalogHits(
      [{ title: 'nope' }, { merchant: { name: 'A', domain: 'a.example' } }],
      { sampleOrigin: 'seed' },
    );
    expect(offers).toHaveLength(0);
    expect(diagnostics.some((d) => /invalid catalog hit/i.test(d))).toBe(true);
  });

  it('assigns one merchant ID per domain and diagnoses conflicting explicit IDs', () => {
    const { offers, diagnostics } = normalizeCatalogInventory(
      [
        {
          merchant: { id: 'mer_explicit_a', name: 'A', domain: 'one.example' },
          productId: 'p1',
          variantId: 'v1',
          title: 'One',
          category: 'top',
          productUrl: 'https://one.example/products/p1',
        },
        {
          merchant: { id: 'mer_explicit_b', name: 'A', domain: 'one.example' },
          productId: 'p2',
          variantId: 'v2',
          title: 'Two',
          category: 'top',
          productUrl: 'https://one.example/products/p2',
        },
      ],
      { sampleOrigin: 'seed' },
    );
    expect(offers).toHaveLength(2);
    expect(offers[0]?.merchant.id).toBe(offers[1]?.merchant.id);
    expect(diagnostics.some((d) => /conflicting explicit merchant id/i.test(d))).toBe(true);
  });
});
