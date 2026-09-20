/** S3-L2-1 deterministic demand projection. Design v3 §§6.1–6.2. No provider calls. */
import { readFileSync } from 'node:fs';
import type {
  ConsentRecord,
  DemandEvent,
  IntentBrief,
  SampleOrigin,
  ShoppingDomain,
} from '@sei/contracts';
import { DemandAggregateSchema, MerchantDemandSummarySchema } from '@sei/contracts';
import type { DemandAggregationInput } from '@sei/core';
import { describe, expect, it } from 'vitest';
import { createDemandAggregator } from '../src/demand/index';

const WINDOW = { start: new Date('2026-09-01T00:00:00Z'), end: new Date('2026-10-01T00:00:00Z') };

const CATEGORIES: Record<ShoppingDomain, [string, string]> = {
  outfit: ['bag', 'top'],
  setup: ['desk', 'lighting'],
};

function brief(domain: ShoppingDomain, sessionSeq: number, over: Partial<IntentBrief> = {}) {
  const [first, second] = CATEGORIES[domain];
  return {
    id: `brief_${sessionSeq}`,
    domain,
    revision: 1,
    status: 'confirmed',
    input: { kind: 'text', text: 'seed brief' },
    slots: [
      {
        id: 'slot_1',
        category: first,
        description: 'first item',
        required: true,
        visualAttributes: [],
        constraints: [],
      },
      {
        id: 'slot_2',
        category: second,
        description: 'second item',
        required: false,
        visualAttributes: [],
        constraints: [],
      },
    ],
    country: 'CA',
    currency: 'CAD',
    itemBudget: null,
    sampleOrigin: 'seed',
    createdAt: '2026-09-05T12:00:00Z',
    ...over,
  } as IntentBrief;
}

function consent(sessionSeq: number, over: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    sessionId: `sess_${sessionSeq}`,
    version: 1,
    state: 'granted',
    updatedAt: '2026-09-05T12:00:00Z',
    ...over,
  };
}

let eventSeq = 0;
function confirmed(sessionSeq: number, over: Partial<DemandEvent> = {}): DemandEvent {
  eventSeq += 1;
  return {
    id: `evt_${eventSeq}`,
    sessionId: `sess_${sessionSeq}`,
    briefId: `brief_${sessionSeq}`,
    briefRevision: 1,
    consentVersion: 1,
    occurredAt: '2026-09-10T12:00:00Z',
    sampleOrigin: 'seed',
    kind: 'brief_confirmed',
    matchId: null,
    selections: [],
    rejectionReason: null,
    ...over,
  } as DemandEvent;
}

function input(
  domain: ShoppingDomain,
  sessions: number,
  over: Partial<DemandAggregationInput> = {},
): DemandAggregationInput {
  const seqs = Array.from({ length: sessions }, (_, index) => index + 1);
  return {
    events: seqs.map((seq) => confirmed(seq)),
    briefs: seqs.map((seq) => brief(domain, seq)),
    consents: seqs.map((seq) => consent(seq)),
    window: WINDOW,
    origin: 'seed' as SampleOrigin,
    minimumSessions: 5,
    ...over,
  };
}

function selection(merchantSeq: number, slotId = 'slot_1') {
  return { slotId, offerId: `offer_${merchantSeq}`, merchantId: `mer_${merchantSeq}` };
}

function selected(
  sessionSeq: number,
  kind: DemandEvent['kind'],
  selections: ReturnType<typeof selection>[],
  over: Partial<DemandEvent> = {},
): DemandEvent {
  return confirmed(sessionSeq, {
    kind,
    matchId: `match_${sessionSeq}`,
    selections,
    ...over,
  });
}

describe.each(['outfit', 'setup'] as const)('%s demand projection', (domain) => {
  it('counts consented sessions with a confirmed brief as the cohort denominator', () => {
    const [aggregate, ...rest] = createDemandAggregator().aggregate(input(domain, 6));

    expect(rest).toEqual([]);
    expect(aggregate.eligibleSessions).toBe(6);
    expect(aggregate.cohort.domain).toBe(domain);
    expect(aggregate.cohort.categories).toEqual([...CATEGORIES[domain]].sort());
  });

  it('excludes declined, withdrawn and stale-consent-version sessions', () => {
    const base = input(domain, 3);
    const aggregate = createDemandAggregator().aggregate({
      ...base,
      consents: [
        consent(1),
        consent(2, { state: 'declined' }),
        // Re-consent starts a new version and does not revive the old contribution (§6.1).
        consent(3, { version: 2 }),
      ],
    })[0];

    expect(aggregate.eligibleSessions).toBe(1);
  });

  it('ignores events outside the window, of another origin, or on a superseded revision', () => {
    const base = input(domain, 4);
    const aggregate = createDemandAggregator().aggregate({
      ...base,
      events: [
        confirmed(1),
        confirmed(2, { occurredAt: '2026-08-01T12:00:00Z' }),
        confirmed(3, { sampleOrigin: 'live' }),
        confirmed(4, { briefRevision: 1 }),
      ],
      briefs: [
        brief(domain, 1),
        brief(domain, 2),
        brief(domain, 3),
        // Session 4's confirmed brief moved on; its revision-1 event no longer counts.
        brief(domain, 4, { revision: 2 }),
      ],
    })[0];

    expect(aggregate.eligibleSessions).toBe(1);
  });

  it('counts merchant support from any explicit selection but pairs only from saved collections', () => {
    const base = input(domain, 6);
    const aggregate = createDemandAggregator().aggregate({
      ...base,
      events: [
        ...base.events,
        // Five sessions save a collection holding both merchants.
        ...[1, 2, 3, 4, 5].map((seq) =>
          selected(seq, 'collection_saved', [selection(1), selection(2, 'slot_2')]),
        ),
        // The sixth only accepts one item, so it supports merchant 1 but no pair.
        selected(6, 'item_accepted', [selection(1)]),
      ],
    })[0];

    expect(aggregate.merchantSupport).toEqual([
      { merchantId: 'mer_1', supportingSessions: 6 },
      { merchantId: 'mer_2', supportingSessions: 5 },
    ]);
    expect(aggregate.pairs).toEqual([{ merchantIds: ['mer_1', 'mer_2'], supportingSessions: 5 }]);
  });

  it('lets a later rejection withdraw an earlier acceptance of the same slot', () => {
    const base = input(domain, 1);
    const aggregate = createDemandAggregator().aggregate({
      ...base,
      events: [
        ...base.events,
        selected(1, 'item_accepted', [selection(1)], { occurredAt: '2026-09-10T12:00:00Z' }),
        selected(1, 'item_rejected', [selection(1)], {
          occurredAt: '2026-09-10T13:00:00Z',
          rejectionReason: 'price',
        }),
      ],
    })[0];

    expect(aggregate.merchantSupport ?? []).toEqual([]);
    expect(aggregate.gaps).toEqual([{ kind: 'rejection', reason: 'price', sessions: 1 }]);
  });

  it('publishes coarse bands and suppresses cells below the threshold', () => {
    const base = input(domain, 6);
    const aggregate = createDemandAggregator().aggregate({
      ...base,
      events: [
        ...base.events,
        ...[1, 2, 3, 4, 5, 6].map((seq) => selected(seq, 'item_accepted', [selection(1)])),
        // A single session is not enough to publish merchant 2.
        selected(1, 'item_accepted', [selection(2, 'slot_2')]),
      ],
    })[0];

    const summary = createDemandAggregator().summarize(aggregate, 5);

    expect(MerchantDemandSummarySchema.parse(summary).status).toBe('available');
    expect(summary.eligibleSessions).toEqual({ min: 5, max: 10 });
    expect(summary.merchantSupport).toEqual([
      { merchantId: 'mer_1', support: { min: 5, max: 10 } },
    ]);
    expect(summary.aggregateId).toBe(aggregate.id);
  });

  it('reports insufficient evidence without disclosing any count', () => {
    const aggregate = createDemandAggregator().aggregate(input(domain, 3))[0];

    const summary = createDemandAggregator().summarize(aggregate, 5);

    expect(MerchantDemandSummarySchema.parse(summary).status).toBe('insufficient_evidence');
    expect(summary.eligibleSessions).toBeNull();
    expect(summary.merchantSupport ?? []).toEqual([]);
    expect(summary.gaps ?? []).toEqual([]);
  });

  it('publishes saved-together pair bands only above threshold and removes them on withdrawal', () => {
    const aggregator = createDemandAggregator();
    const base = input(domain, 6);
    const events = [
      ...base.events,
      ...[1, 2, 3, 4, 5].map((seq) =>
        selected(seq, 'collection_saved', [selection(1), selection(2, 'slot_2')]),
      ),
      selected(6, 'collection_saved', [selection(1), selection(3, 'slot_2')]),
    ];
    const summary = aggregator.summarize(aggregator.aggregate({ ...base, events })[0], 5);
    expect(summary.pairSupport).toEqual([
      { merchantIds: ['mer_1', 'mer_2'], support: { min: 5, max: 10 } },
    ]);
    expect(MerchantDemandSummarySchema.safeParse(summary).success).toBe(true);
    const after = aggregator.summarize(
      aggregator.aggregate({
        ...base,
        events,
        consents: [consent(1, { state: 'withdrawn' }), ...[2, 3, 4, 5, 6].map((n) => consent(n))],
      })[0],
      5,
    );
    expect(after.status).toBe('available');
    expect(after.pairSupport).toEqual([]);
    expect(
      MerchantDemandSummarySchema.safeParse({
        ...after,
        pairSupport: [{ merchantIds: ['mer_1', 'mer_2'], support: { min: 4, max: 5 } }],
      }).success,
    ).toBe(false);
    expect(
      MerchantDemandSummarySchema.safeParse({
        ...summary,
        status: 'insufficient_evidence',
        eligibleSessions: null,
        merchantSupport: [],
        gaps: [],
      }).success,
    ).toBe(false);
  });

  it('keeps the cohort ID but changes the version when a withdrawal changes the contents', () => {
    const base = input(domain, 6);
    const before = createDemandAggregator().aggregate(base)[0];

    const after = createDemandAggregator().aggregate({
      ...base,
      consents: [consent(1, { state: 'withdrawn' }), ...[2, 3, 4, 5, 6].map((seq) => consent(seq))],
    })[0];

    expect(after.id).toBe(before.id);
    expect(after.eligibleSessions).toBe(5);
    expect(after.version).not.toBe(before.version);
  });

  it('keeps seed and replay datasets out of a live projection', () => {
    const base = input(domain, 6);
    const live = createDemandAggregator().aggregate({ ...base, origin: 'live' });

    expect(live).toEqual([]);
  });

  it('emits aggregates that satisfy the private aggregate contract', () => {
    const base = input(domain, 6);
    const aggregate = createDemandAggregator().aggregate({
      ...base,
      events: [
        ...base.events,
        ...[1, 2, 3, 4, 5].map((seq) =>
          selected(seq, 'collection_saved', [selection(1), selection(2, 'slot_2')]),
        ),
        selected(6, 'item_rejected', [selection(1)], { rejectionReason: 'price' }),
      ],
    })[0];

    expect(() => DemandAggregateSchema.parse(aggregate)).not.toThrow();
  });

  it('does not pair merchants that were never saved together', () => {
    const base = input(domain, 1);
    const aggregate = createDemandAggregator().aggregate({
      ...base,
      events: [
        ...base.events,
        // The shopper saved a collection holding merchants 1 and 2.
        selected(1, 'collection_saved', [selection(1), selection(2, 'slot_2')], {
          occurredAt: '2026-09-10T12:00:00Z',
        }),
        // Then swapped slot 2 to merchant 3 with a single item decision.
        // Merchants 1 and 3 were never saved as a collection together.
        selected(1, 'item_accepted', [selection(3, 'slot_2')], {
          occurredAt: '2026-09-10T13:00:00Z',
        }),
      ],
    })[0];

    expect(aggregate.merchantSupport).toEqual([
      { merchantId: 'mer_1', supportingSessions: 1 },
      { merchantId: 'mer_3', supportingSessions: 1 },
    ]);
    expect(aggregate.pairs).toEqual([]);
  });

  it('counts a repeated identical decision once', () => {
    const base = input(domain, 1);
    const twice = selected(1, 'item_accepted', [selection(1)]);
    const aggregate = createDemandAggregator().aggregate({
      ...base,
      events: [...base.events, twice, { ...twice, id: 'evt_repeat' }],
    })[0];

    expect(aggregate.merchantSupport).toEqual([{ merchantId: 'mer_1', supportingSessions: 1 }]);
  });
});

function seed(domain: ShoppingDomain, name: string) {
  return JSON.parse(
    readFileSync(new URL(`../../../fixtures/seed/${domain}/${name}.json`, import.meta.url), 'utf8'),
  );
}

/**
 * The published seed aggregate must be derivable from the seed event log — otherwise it is
 * an invented number wearing a fixture's clothes. This is the card's hand-count check,
 * automated for both domains.
 */
describe.each(['outfit', 'setup'] as const)('%s seed reconciliation', (domain) => {
  it('derives the published seed aggregate from the seed event log', () => {
    const expected = seed(domain, 'aggregate');

    const [actual, ...rest] = createDemandAggregator().aggregate({
      events: seed(domain, 'demand-events'),
      briefs: seed(domain, 'briefs'),
      consents: seed(domain, 'consents'),
      window: { start: new Date(expected.windowStart), end: new Date(expected.windowEnd) },
      origin: 'seed',
      minimumSessions: 5,
    });

    expect(rest).toEqual([]);
    expect(actual.cohort).toEqual(expected.cohort);
    expect(actual.eligibleSessions).toBe(expected.eligibleSessions);
    expect(actual.pairs).toEqual(expected.pairs);
    expect(actual.merchantSupport).toEqual(expected.merchantSupport);
    expect(actual.gaps ?? []).toEqual(expected.gaps ?? []);
  });
});
