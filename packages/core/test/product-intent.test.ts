import type { IntentSlot } from '@sei/contracts';
import { describe, expect, it } from 'vitest';
import { productIntentFit, requestedAudience, slotSearchTerms } from '../src';

const slot = (description: string, category = 'top'): IntentSlot => ({
  id: 'slot_test',
  category,
  description,
  visualAttributes: [],
  constraints: [],
  required: true,
});

describe('product intent relevance (synthetic regressions from the reported outfit)', () => {
  it('retains colour and shirt construction in both queries, even from generic planner text', () => {
    const shirt = slot('Pale blue plain long-sleeve linen button-up shirt');
    const retry = slotSearchTerms(shirt, true).join(' ');
    expect(retry).toContain('shirt');
    expect(retry).toContain('blue');
    expect(retry).toContain('button-up');
    expect(retry).not.toContain('linen');
    expect(requestedAudience(shirt)).toBeNull();
  });
  it('does not treat a red graphic T-shirt as a button-up or a blouse as a strong plain shirt match', () => {
    const shirt = slot('Mens pale blue plain long-sleeve button-up shirt');
    expect(productIntentFit(shirt, 'Made in Canada Red Graphic T-Shirt').conflict).toBe(true);
    expect(productIntentFit(shirt, 'Womens Blue Striped Blouse').conflict).toBe(true);
    const plain = productIntentFit(shirt, 'Mens Light Blue Solid Long Sleeve Button Down Shirt');
    expect(plain.strong).toBe(true);
    expect(plain.score).toBeGreaterThan(productIntentFit(shirt, 'Mens Red Shirt').score);
  });
  it.each([
    ['Cream chino shorts', 'bottom', 'White Chino Shorts', 'Beige Chino Pants'],
    ['Dark sunglasses', 'accessory', 'Black Sunglasses', 'Silver Wristwatch'],
    ['White desk lamp', 'lighting', 'White Desk Lamp', 'White Writing Desk'],
    ['Oak writing desk', 'desk', 'Oak Writing Desk', 'Oak Desk Lamp'],
  ])(
    'distinguishes %s from another product in the same broad category',
    (description, category, good, bad) => {
      expect(productIntentFit(slot(description, category), good).conflict).toBe(false);
      expect(productIntentFit(slot(description, category), bad).conflict).toBe(true);
    },
  );
  it('honours the explicitly chosen product department over the old description', () => {
    const chosen = { ...slot('Womens blue shirt'), visualAttributes: ['Shopping department: men'] };
    expect(requestedAudience(chosen)).toBe('men');
    expect(productIntentFit(chosen, 'Women Blue Shirt').conflict).toBe(true);
    expect(slotSearchTerms(chosen).join(' ')).not.toContain('department');
  });
});
