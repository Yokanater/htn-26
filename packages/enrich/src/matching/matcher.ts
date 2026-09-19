/** `CollectionMatcher` for the current core port. Owner: L2 (S2-L2-1).
 * Stopgap: the port passes one flat offer list, so offers are assigned to slots by exact
 * (case-insensitive) category. Once the port carries each query's slot ID, the pipeline should
 * call `matchCollections` with per-slot candidates instead.
 */
import type { IntentBrief, ProductOffer } from '@sei/contracts';
import type { CollectionMatcher } from '@sei/core';
import { type MatchOptions, matchCollections, type SlotCandidates } from './engine';

const canonicalCategory = (category: string) => category.trim().toLowerCase().replace(/\s+/g, ' ');

export function groupOffersBySlot(
  brief: IntentBrief,
  offers: readonly ProductOffer[],
): SlotCandidates {
  return Object.fromEntries(
    brief.slots.map((slot) => [
      slot.id,
      offers.filter(
        (offer) => canonicalCategory(offer.category) === canonicalCategory(slot.category),
      ),
    ]),
  );
}

export function createCollectionMatcher(
  options: Omit<MatchOptions, 'sampleOrigin'> = {},
): CollectionMatcher {
  return {
    async match(brief, offers, context) {
      context.signal.throwIfAborted();
      return matchCollections(brief, groupOffersBySlot(brief, offers), {
        ...options,
        sampleOrigin: context.sampleOrigin,
      });
    },
  };
}
