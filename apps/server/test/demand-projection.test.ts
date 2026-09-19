/** S3 integration: the ledger's private events become consent-gated published snapshots.
 * Owner: L4. Design v3 §§6.1–6.2. No provider calls.
 */

import type { DemandEvent, IntentBrief, ShoppingDomain } from '@sei/contracts';
import { createDemandAggregator } from '@sei/enrich';
import { describe, expect, it } from 'vitest';
import { PrivateDemandLedger } from '../src/services/demand';
import { DemandProjectionService } from '../src/services/demand-projection';

const NOW = new Date('2026-09-19T12:00:00Z');

const CATEGORIES: Record<ShoppingDomain, [string, string]> = {
  outfit: ['bag', 'top'],
  setup: ['desk', 'lighting'],
};

function brief(domain: ShoppingDomain, seq: number): IntentBrief {
  const [first, second] = CATEGORIES[domain];
  return {
    id: `brief_${domain}_${seq}`,
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
    createdAt: '2026-09-18T12:00:00Z',
  } as IntentBrief;
}

function savedCollection(domain: ShoppingDomain, seq: number): DemandEvent {
  return {
    id: `evt_${domain}_${seq}`,
    sessionId: `sess_${domain}_${seq}`,
    briefId: `brief_${domain}_${seq}`,
    briefRevision: 1,
    consentVersion: 1,
    occurredAt: '2026-09-19T11:00:00Z',
    sampleOrigin: 'seed',
    kind: 'collection_saved',
    matchId: `match_${domain}_${seq}`,
    selections: [
      { slotId: 'slot_1', offerId: 'offer_1', merchantId: 'mer_1' },
      { slotId: 'slot_2', offerId: 'offer_2', merchantId: 'mer_2' },
    ],
    rejectionReason: null,
  } as DemandEvent;
}

async function ledgerWith(domain: ShoppingDomain, sessions: number, clock: () => Date = () => NOW) {
  const ledger = new PrivateDemandLedger();
  const briefs = new Map<string, IntentBrief>();
  for (let seq = 1; seq <= sessions; seq += 1) {
    const sessionId = `sess_${domain}_${seq}`;
    await ledger.setConsent(
      { sessionId, version: 1, state: 'granted', updatedAt: '2026-09-19T10:00:00Z' },
      null,
    );
    briefs.set(`brief_${domain}_${seq}`, brief(domain, seq));
    await ledger.append(savedCollection(domain, seq), `key-${seq}`);
  }
  const service = new DemandProjectionService({
    ledger,
    briefs: (ids) => ids.flatMap((id) => (briefs.has(id) ? [briefs.get(id) as IntentBrief] : [])),
    aggregator: createDemandAggregator(),
    minimumSessions: 5,
    retentionDays: 30,
    snapshotMinutes: 15,
    now: clock,
  });
  return { ledger, service };
}

describe.each(['outfit', 'setup'] as const)('%s demand projection service', (domain) => {
  it('publishes a coarse consented summary once the cohort clears the threshold', async () => {
    const { service } = await ledgerWith(domain, 6);

    const [summary, ...rest] = await service.refresh('seed');

    expect(rest).toEqual([]);
    expect(summary.status).toBe('available');
    expect(summary.eligibleSessions).toEqual({ min: 5, max: 10 });
    expect(summary.cohort.domain).toBe(domain);
    expect(service.published(summary.aggregateId)).toEqual(summary);
  });

  it('never puts an exact private count in a published snapshot', async () => {
    const { service } = await ledgerWith(domain, 6);

    const [summary] = await service.refresh('seed');
    const published = service.published(summary.aggregateId) as Record<string, unknown>;

    // The private aggregate's exact fields must not survive publication.
    expect(published.pairs).toBeUndefined();
    expect(typeof published.eligibleSessions).not.toBe('number');
    expect(JSON.stringify(published)).not.toMatch(/sess_/);
  });

  it('reports insufficient evidence without disclosing a thin cohort', async () => {
    const { service } = await ledgerWith(domain, 3);

    const [summary] = await service.refresh('seed');

    expect(summary.status).toBe('insufficient_evidence');
    expect(summary.eligibleSessions).toBeNull();
  });

  it('blocks a stale snapshot after a withdrawal until it is recomputed', async () => {
    const { ledger, service } = await ledgerWith(domain, 6);
    const [before] = await service.refresh('seed');
    expect(service.published(before.aggregateId)).not.toBeNull();

    // Two withdrawals drop the cohort from six to four, under the threshold of five.
    for (const seq of [1, 2]) {
      await ledger.setConsent(
        {
          sessionId: `sess_${domain}_${seq}`,
          version: 2,
          state: 'withdrawn',
          updatedAt: '2026-09-19T11:30:00Z',
        },
        1,
      );
    }

    expect(service.published(before.aggregateId)).toBeNull();
    const [after] = await service.refresh('seed');
    expect(after.aggregateId).toBe(before.aggregateId);
    expect(after.status).toBe('insufficient_evidence');
    expect(after.eligibleSessions).toBeNull();
  });

  it('does not publish a contribution withdrawn while the projection was reading', async () => {
    // Exactly at the threshold: losing one contributor must flip the verdict, so a stale
    // publication is visible rather than hidden behind an identical band.
    const { ledger, service } = await ledgerWith(domain, 5);
    const readConsent = ledger.getConsent.bind(ledger);
    let interleaved = false;
    ledger.getConsent = async (sessionId: string) => {
      const record = await readConsent(sessionId);
      if (!interleaved) {
        interleaved = true;
        await ledger.setConsent(
          {
            sessionId: `sess_${domain}_1`,
            version: 2,
            state: 'withdrawn',
            updatedAt: '2026-09-19T11:30:00Z',
          },
          1,
        );
      }
      return record;
    };

    const summaries = await service.refresh('seed');

    // Anything readable afterwards must already exclude the withdrawn contribution.
    for (const summary of summaries) {
      expect(summary.status).toBe('insufficient_evidence');
      expect(service.published(summary.aggregateId)?.status).not.toBe('available');
    }
  });

  it('stops serving a snapshot once its window has passed', async () => {
    let now = NOW;
    const { service } = await ledgerWith(domain, 6, () => now);
    const [summary] = await service.refresh('seed');
    expect(service.published(summary.aggregateId)).not.toBeNull();

    now = new Date(NOW.getTime() + 60 * 24 * 60 * 60 * 1000);

    expect(service.published(summary.aggregateId)).toBeNull();
  });

  it('keeps seed observations out of a live projection', async () => {
    const { service } = await ledgerWith(domain, 6);

    expect(await service.refresh('live')).toEqual([]);
  });
});
