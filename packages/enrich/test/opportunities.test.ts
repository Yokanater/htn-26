import { readFileSync } from 'node:fs';
import { DemandAggregateSchema, ProductOfferSchema } from '@sei/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createOpportunityMapper } from '../src/opportunities';

describe.each(['outfit', 'setup'])('%s opportunities', (domain) => {
  const read = (file: string) =>
    JSON.parse(
      readFileSync(
        new URL(`../../../fixtures/seed/${domain}/${file}.json`, import.meta.url),
        'utf8',
      ),
    );
  const offers = z.array(ProductOfferSchema).parse(read('offers'));
  const aggregate = DemandAggregateSchema.parse(read('aggregate'));
  const map = (source = offers, data = aggregate) =>
    createOpportunityMapper().map({
      merchant: source[0].merchant,
      offers: source.filter((offer) => offer.merchant.id === source[0].merchant.id),
      partnerOffers: offers,
      aggregates: [data],
      minimumSessions: 5,
    });
  it('retains observed support as a band and cites both catalogs', () => {
    const [opportunity] = map();
    expect(opportunity.basis).toBe('observed_pair');
    expect(opportunity.observedPairSupport?.min).toBeGreaterThanOrEqual(5);
    expect(opportunity.productEvidenceIds).toContain(offers[0].evidence[0].id);
    expect(JSON.stringify(opportunity)).not.toMatch(/sessionId|briefId|eventId|inputText/);
  });
  it('never transfers historical support to a newcomer', () => {
    const newcomer = offers.map((offer) => ({
      ...offer,
      merchant: { id: 'mer_newcomer', name: 'New store', domain: 'newcomer.example' },
    }));
    // Keep only the first category to leave complementary coverage for the partner.
    const [opportunity] = map([newcomer[0]]);
    expect(opportunity.basis).toBe('inferred_supply_fit');
    expect(opportunity.observedPairSupport).toBeNull();
  });
  it('suppresses small cohorts, excludes wrong provenance and unavailable products', () => {
    expect(
      map(offers, { ...aggregate, eligibleSessions: 4, pairs: [], merchantSupport: [] }),
    ).toEqual([]);
    expect(map(offers.map((offer) => ({ ...offer, sampleOrigin: 'live' as const })))).toEqual([]);
    expect(
      map(offers.map((offer) => ({ ...offer, availability: 'unavailable' as const }))),
    ).toEqual([]);
  });
  it('suppresses small pair cells without hiding inferred coverage', () => {
    const [opportunity] = map(offers, {
      ...aggregate,
      pairs: aggregate.pairs.map((pair) => ({ ...pair, supportingSessions: 2 })),
    });
    expect(opportunity.observedPairSupport).toBeNull();
    expect(opportunity.basis).toBe('inferred_supply_fit');
  });
});
