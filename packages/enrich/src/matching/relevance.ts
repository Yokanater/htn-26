/** Transparent relevance signal. Owner: L2 (S2-L2-1). Design v3 §5.3.
 * Ranks only after coverage and constraints. A 0–1000 integer score, not a probability.
 */
import type { IntentSlot, ProductOffer } from '@sei/contracts';

const STOPWORDS = new Set(['a', 'an', 'the', 'and', 'or', 'with', 'for', 'of', 'in', 'on', 'to']);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/** 60% confirmed visual attributes present in the offer text, 40% description word overlap. */
export function relevance(slot: IntentSlot, offer: ProductOffer): number {
  const offerText = [offer.title, offer.category, ...Object.values(offer.attributes)].join(' ');
  const offerTokens = new Set(tokens(offerText));
  const visual = slot.visualAttributes.map(tokens).filter((words) => words.length > 0);
  const described = [...new Set(tokens(slot.description))];
  const textScore = described.length
    ? described.filter((word) => offerTokens.has(word)).length / described.length
    : 0;
  if (visual.length === 0) return Math.round(textScore * 1000);
  const visualScore =
    visual.filter((words) => words.every((word) => offerTokens.has(word))).length / visual.length;
  return Math.round((0.6 * visualScore + 0.4 * textScore) * 1000);
}
