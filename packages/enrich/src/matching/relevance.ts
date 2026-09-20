/** Transparent relevance signal. Owner: L2 (S2-L2-1). Design v3 §5.3.
 * Ranks only after coverage and constraints. A 0–1000 integer score, not a probability.
 */
import type { IntentSlot, ProductOffer } from '@sei/contracts';
import { offerIntentText, productIntentFit } from '@sei/core';

/** Use the same item type, colour and construction signals as discovery. */
export function relevance(slot: IntentSlot, offer: ProductOffer): number {
  return productIntentFit(slot, offerIntentText(offer)).score;
}
