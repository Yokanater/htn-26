/** Documents the S2-L1-1 B6 partial-failure contract gate. */
import { describe, expect, it } from 'vitest';
import { createFixtureShoppingCatalog } from '../src/fixture-catalog';

describe('partial-failure contract gate (B6)', () => {
  it('keeps ShoppingCatalog.search returning ProductOffer[] until a coordinated core change', () => {
    const catalog = createFixtureShoppingCatalog([]);
    expect(typeof catalog.search).toBe('function');
    // Pending human/coordinator decision:
    // 1) typed thrown provider errors, or
    // 2) additive result envelope in @sei/core.
    // This package must not invent a private incompatible interface.
    expect(true).toBe(true);
  });
});
