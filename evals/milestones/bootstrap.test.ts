/** S0 contract/fixture integration only. Does not assert that S1–S5 are implemented. */
import { readFileSync } from 'node:fs';
import {
  CollectionMatchSchema,
  ConsentRecordSchema,
  DemandAggregateSchema,
  DemandEventSchema,
  IntentBriefSchema,
  MerchantOpportunitySchema,
  ProductOfferSchema,
} from '@sei/contracts';
import { featureFlags, resolveMilestones, SHOPPING_DOMAINS } from '@sei/core';
import { describe, expect, it } from 'vitest';

function fixture(domain: string, name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../fixtures/seed/${domain}/${name}.json`, import.meta.url), 'utf8'),
  );
}

describe('S0 equal-domain contract wiring', () => {
  it('the active minimum product includes the shopper-to-merchant loop', () => {
    expect(resolveMilestones('s1,s2,s3,s4').sections).toEqual([
      'intent',
      'collections',
      'demand',
      'opportunities',
    ]);
    const flags = featureFlags({ MILESTONES: 's1,s2,s3,s4' });
    expect(flags.FEATURE_MERCHANT_OPPORTUNITIES).toBe(true);
    expect(flags.FEATURE_DRAFT_ACTIVATION).toBe(false);
    expect(Object.keys(SHOPPING_DOMAINS).sort()).toEqual(['outfit', 'setup']);
  });

  it.each(['outfit', 'setup'])(
    '%s fixture references preserve provenance and ownership',
    (domain) => {
      const briefs = IntentBriefSchema.array().parse(fixture(domain, 'briefs'));
      const offers = ProductOfferSchema.array().parse(fixture(domain, 'offers'));
      const matches = CollectionMatchSchema.array().parse(fixture(domain, 'matches'));
      const events = DemandEventSchema.array().parse(fixture(domain, 'demand-events'));
      const consents = ConsentRecordSchema.array().parse(fixture(domain, 'consents'));
      const aggregate = DemandAggregateSchema.parse(fixture(domain, 'aggregate'));
      const opportunity = MerchantOpportunitySchema.parse(fixture(domain, 'opportunity'));
      expect(briefs.every((b) => b.domain === domain && b.sampleOrigin === 'seed')).toBe(true);
      expect(offers.every((o) => o.sampleOrigin === 'seed')).toBe(true);
      expect(aggregate.sampleOrigin).toBe('seed');
      expect(opportunity.demand.aggregateId).toBe(aggregate.id);
      expect(opportunity.demand.sampleOrigin).toBe('seed');
      expect(consents.some((c) => c.state === 'withdrawn')).toBe(true);
      expect(new Set(events.map((e) => e.briefId)).size).toBe(events.length);
      for (const event of events) {
        const brief = briefs.find((b) => b.id === event.briefId);
        const match = matches.find((m) => m.id === event.matchId);
        expect(brief).toBeDefined();
        expect(match?.briefId).toBe(event.briefId);
        expect(match?.briefRevision).toBe(event.briefRevision);
        expect(consents.some((c) => c.sessionId === event.sessionId)).toBe(true);
        for (const selection of event.selections) {
          const offer = offers.find((o) => o.id === selection.offerId);
          expect(offer?.merchant.id).toBe(selection.merchantId);
          expect(match?.slots.find((s) => s.slotId === selection.slotId)?.selectedOfferId).toBe(
            selection.offerId,
          );
        }
      }
      for (const evidenceId of opportunity.productEvidenceIds) {
        expect(offers.some((o) => o.evidence.some((e) => e.id === evidenceId))).toBe(true);
      }
      // This hand-check validates the fixture story, not a yet-unimplemented S3 projection engine.
      const contributingSessions = new Set(
        events
          .filter((e) =>
            consents.some(
              (c) =>
                c.sessionId === e.sessionId &&
                c.state === 'granted' &&
                c.version === e.consentVersion,
            ),
          )
          .map((e) => e.sessionId),
      );
      expect(aggregate.eligibleSessions).toBe(contributingSessions.size);
    },
  );
});
