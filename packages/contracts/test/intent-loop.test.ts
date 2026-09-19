import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CollectionMatchSchema,
  DemandAggregateSchema,
  DemandEventSchema,
  InspirationAssetSchema,
  IntentBriefSchema,
  MerchantDemandSummarySchema,
  MerchantOpportunitySchema,
  ProductOfferSchema,
} from '../src/index';

function fixture(domain: string, name: string) {
  return JSON.parse(
    readFileSync(new URL(`../../../fixtures/seed/${domain}/${name}.json`, import.meta.url), 'utf8'),
  );
}

describe.each(['outfit', 'setup'])('%s intent-loop invariants', (domain) => {
  it('rejects duplicate slots, wrong currencies and other-domain constraints', () => {
    const brief = fixture(domain, 'brief');
    expect(
      IntentBriefSchema.safeParse({ ...brief, slots: [brief.slots[0], brief.slots[0]] }).success,
    ).toBe(false);
    expect(
      IntentBriefSchema.safeParse({ ...brief, itemBudget: { amount: 10, currency: 'USD' } })
        .success,
    ).toBe(false);
    brief.slots[0].constraints =
      domain === 'outfit'
        ? [{ kind: 'dimension', axis: 'width', maxCm: 100 }]
        : [{ kind: 'size', value: 'M' }];
    expect(IntentBriefSchema.safeParse(brief).success).toBe(false);
  });

  it('cannot call unresolved hard constraints ready', () => {
    const match = fixture(domain, 'matches')[0];
    match.slots[0].checks[0].status = 'unknown';
    expect(CollectionMatchSchema.safeParse(match).success).toBe(false);
    match.status = 'partial';
    expect(CollectionMatchSchema.safeParse(match).success).toBe(true);
  });

  it('does not invent zero prices or accept unsafe URL schemes', () => {
    const offer = fixture(domain, 'offers')[0];
    expect(
      ProductOfferSchema.parse({ ...offer, price: null, availability: 'unknown', shipsTo: null })
        .price,
    ).toBeNull();
    expect(
      ProductOfferSchema.safeParse({ ...offer, productUrl: 'javascript:alert(1)' }).success,
    ).toBe(false);
  });

  it('does not record model impressions or false product selections as confirmed demand', () => {
    const event = fixture(domain, 'demand-events')[0];
    expect(DemandEventSchema.safeParse({ ...event, kind: 'model_suggested' }).success).toBe(false);
    expect(DemandEventSchema.safeParse({ ...event, kind: 'brief_confirmed' }).success).toBe(false);
    expect(DemandEventSchema.safeParse({ ...event, kind: 'item_rejected' }).success).toBe(false);
    expect(DemandEventSchema.safeParse({ ...event, sessionId: undefined }).success).toBe(false);
  });

  it('checks cohort arithmetic and distinct pairs', () => {
    const aggregate = fixture(domain, 'aggregate');
    aggregate.pairs[0].supportingSessions = aggregate.eligibleSessions + 1;
    expect(DemandAggregateSchema.safeParse(aggregate).success).toBe(false);
    aggregate.pairs[0].supportingSessions = 1;
    aggregate.pairs.push({
      ...aggregate.pairs[0],
      merchantIds: [...aggregate.pairs[0].merchantIds].reverse(),
    });
    expect(DemandAggregateSchema.safeParse(aggregate).success).toBe(false);
  });

  it('suppresses small cohorts and forbids private identifiers in merchant summaries', () => {
    const { demand } = fixture(domain, 'opportunity');
    expect(
      MerchantDemandSummarySchema.safeParse({ ...demand, status: 'insufficient_evidence' }).success,
    ).toBe(false);
    expect(
      MerchantDemandSummarySchema.safeParse({
        ...demand,
        status: 'insufficient_evidence',
        eligibleSessions: null,
      }).success,
    ).toBe(true);
    expect(
      MerchantDemandSummarySchema.safeParse({ ...demand, eligibleSessions: { min: 1, max: 4 } })
        .success,
    ).toBe(false);
    expect(
      MerchantDemandSummarySchema.safeParse({ ...demand, sessionIds: ['sess_private'] }).success,
    ).toBe(false);
    expect(
      MerchantDemandSummarySchema.safeParse({ ...demand, eligibleSessions: { min: 6, max: 6 } })
        .success,
    ).toBe(false);
  });

  it('never transfers observed support to an inferred newcomer match', () => {
    const opportunity = fixture(domain, 'opportunity');
    expect(
      MerchantOpportunitySchema.safeParse({ ...opportunity, basis: 'inferred_supply_fit' }).success,
    ).toBe(false);
    expect(
      MerchantOpportunitySchema.safeParse({
        ...opportunity,
        basis: 'inferred_supply_fit',
        observedPairSupport: null,
      }).success,
    ).toBe(true);
    expect(
      MerchantOpportunitySchema.safeParse({
        ...opportunity,
        observedPairSupport: { min: 1, max: 4 },
      }).success,
    ).toBe(false);
  });
});

it('asset DTOs have no public storage path and enforce accepted upload types/limits', () => {
  const asset = {
    id: 'asset_test',
    mimeType: 'image/png',
    byteLength: 100,
    expiresAt: '2026-09-20T12:00:00Z',
  };
  expect(InspirationAssetSchema.safeParse(asset).success).toBe(true);
  expect(InspirationAssetSchema.safeParse({ ...asset, mimeType: 'image/svg+xml' }).success).toBe(
    false,
  );
  expect(InspirationAssetSchema.safeParse({ ...asset, byteLength: 9 * 1024 * 1024 }).success).toBe(
    false,
  );
  expect(
    InspirationAssetSchema.safeParse({ ...asset, storageKey: '/private/image.png' }).success,
  ).toBe(false);
});
