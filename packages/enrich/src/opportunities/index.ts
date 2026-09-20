import { MerchantOpportunitySchema, newId, type ProductOffer } from '@sei/contracts';
import type { OpportunityMapper } from '@sei/core';
import { createDemandAggregator } from '../demand';

export function createOpportunityMapper(): OpportunityMapper {
  return {
    map({ merchant, offers, partnerOffers, aggregates, minimumSessions }) {
      const results = [];
      for (const aggregate of aggregates) {
        const demand = createDemandAggregator().summarize(aggregate, minimumSessions);
        if (demand.status !== 'available') continue;
        const relevant = (offer: ProductOffer) =>
          offer.sampleOrigin === aggregate.sampleOrigin &&
          aggregate.cohort.categories.includes(offer.category) &&
          offer.availability !== 'unavailable' &&
          (!offer.price || offer.price.currency === aggregate.cohort.currency) &&
          (!offer.shipsTo || offer.shipsTo.includes(aggregate.cohort.country));
        const own = offers.filter((offer) => offer.merchant.id === merchant.id && relevant(offer));
        if (!own.length) continue;
        const ownCategories = new Set(own.map((offer) => offer.category));
        const partners = new Map(
          partnerOffers
            .filter(relevant)
            .filter(
              (offer) =>
                offer.merchant.id !== merchant.id && offer.merchant.domain !== merchant.domain,
            )
            .map((offer) => [offer.merchant.id, offer.merchant]),
        );
        for (const partner of partners.values()) {
          const other = partnerOffers.filter(
            (offer) => offer.merchant.id === partner.id && relevant(offer),
          );
          if (!other.some((offer) => !ownCategories.has(offer.category))) continue;
          const pair = aggregate.pairs.find(
            (entry) =>
              entry.merchantIds.includes(merchant.id) &&
              entry.merchantIds.includes(partner.id) &&
              entry.supportingSessions >= minimumSessions,
          );
          const covered = new Set([...own, ...other].map((offer) => offer.category));
          const missing = aggregate.cohort.categories.filter((category) => !covered.has(category));
          const pairMin = pair
            ? Math.floor(pair.supportingSessions / minimumSessions) * minimumSessions
            : 0;
          results.push(
            MerchantOpportunitySchema.parse({
              id: newId('opp_'),
              merchants: [merchant, partner],
              demand,
              basis: pair ? 'observed_pair' : 'inferred_supply_fit',
              observedPairSupport: pair ? { min: pairMin, max: pairMin + minimumSessions } : null,
              productEvidenceIds: [
                ...new Set(
                  [...own, ...other].flatMap((offer) =>
                    offer.evidence.map((evidence) => evidence.id),
                  ),
                ),
              ],
              proposedExperiment: `Test a co-curated ${aggregate.cohort.domain === 'outfit' ? 'outfit' : 'room or desk'} collection covering ${[...covered].join(', ')}. Ask participants whether the combination meets their requirements before discussing commercial terms.`,
              uncertainties: [
                ...(pair
                  ? []
                  : [
                      'No publishable observed pair support. This is inferred category coverage, not evidence shoppers selected these stores together.',
                    ]),
                ...(missing.length ? [`Uncovered categories: ${missing.join(', ')}.`] : []),
                'Category coverage does not verify individual fit, dimensions, shipping, or other hard constraints.',
                'Partner willingness, costs, discounts, fulfillment and sales outcomes are unknown.',
                ...(aggregate.sampleOrigin === 'live'
                  ? []
                  : ['Synthetic demonstration; no real market demand is claimed.']),
              ],
            }),
          );
        }
      }
      return results
        .sort(
          (a, b) =>
            Number(b.basis === 'observed_pair') - Number(a.basis === 'observed_pair') ||
            (b.demand.eligibleSessions?.min ?? 0) - (a.demand.eligibleSessions?.min ?? 0),
        )
        .slice(0, 12);
    },
  };
}
