/** S3-L4 integration gate: explicit choices, consent versions, ownership and erasure. */
import { type DemandEvent, IntentBriefSchema } from '@sei/contracts';
import { createDemandAggregator } from '@sei/enrich';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../apps/server/src/app';
import { PrivateDemandLedger } from '../../apps/server/src/services/demand';
import { DemandProjectionService } from '../../apps/server/src/services/demand-projection';
import { IntakeStore } from '../../apps/server/src/services/intake';

const headers = (cookie: string) => ({ cookie, 'content-type': 'application/json' });
const getSession = async (app: ReturnType<typeof createApp>) =>
  (await app.request('/api/session')).headers.get('set-cookie')!.split(';')[0]!;

describe.each([
  ['outfit', 'A relaxed neutral outfit with a structured bag'],
  ['setup', 'A compact writing setup with a warm desk light'],
] as const)('S3 %s explicit-choice journey', (domain, text) => {
  it('records one current, consented collection and erases it with the session', async () => {
    const demand = new PrivateDemandLedger();
    const app = createApp({ MILESTONES: 's1,s2,s3' }, { demand });
    const cookie = await getSession(app);
    const created = IntentBriefSchema.parse(
      await (
        await app.request('/api/briefs', {
          method: 'POST',
          headers: headers(cookie),
          body: JSON.stringify({ domain, text, country: 'CA', currency: 'CAD' }),
        })
      ).json(),
    );
    const confirmed = IntentBriefSchema.parse(
      await (
        await app.request(`/api/briefs/${created.id}`, {
          method: 'PATCH',
          headers: headers(cookie),
          body: JSON.stringify({
            expectedRevision: created.revision,
            status: 'confirmed',
            slots: created.slots,
            country: created.country,
            currency: created.currency,
            itemBudget: null,
          }),
        })
      ).json(),
    );
    const started = await app.request(`/api/briefs/${confirmed.id}/matches`, {
      method: 'POST',
      headers: headers(cookie),
      body: '{}',
    });
    expect(started.status).toBe(202);
    const { runId } = (await started.json()) as { runId: string };
    let result: {
      collection: {
        match: { id: string; slots: { slotId: string; selectedOfferId: string | null }[] };
      };
    } | null = null;
    await expect
      .poll(async () => {
        const run = (await (
          await app.request(`/api/runs/${runId}`, { headers: { cookie } })
        ).json()) as { result: typeof result };
        result = run.result;
        return result?.collection?.match.id;
      })
      .toMatch(/^match_/);
    const consent = await app.request('/api/consent', {
      method: 'PUT',
      headers: headers(cookie),
      body: JSON.stringify({ state: 'granted', expectedVersion: null }),
    });
    expect(consent.status).toBe(200);
    const selections = result!.collection.match.slots.flatMap((slot) =>
      slot.selectedOfferId ? [{ slotId: slot.slotId, offerId: slot.selectedOfferId }] : [],
    );
    const decisionBody = {
      idempotencyKey: `${domain}-milestone-save`,
      briefRevision: confirmed.revision,
      runId,
      matchId: result!.collection.match.id,
      kind: 'collection_saved',
      selections,
      rejectionReason: null,
    };
    const choice = await app.request(`/api/briefs/${confirmed.id}/decisions`, {
      method: 'POST',
      headers: headers(cookie),
      body: JSON.stringify(decisionBody),
    });
    expect(choice.status).toBe(201);
    const event = ((await choice.json()) as { event: DemandEvent }).event;
    expect(event).toMatchObject({
      briefId: confirmed.id,
      briefRevision: confirmed.revision,
      consentVersion: 1,
      kind: 'collection_saved',
      sampleOrigin: 'seed',
    });
    expect(event.selections).toHaveLength(selections.length);
    const stranger = await getSession(app);
    expect(
      (
        await app.request(`/api/briefs/${confirmed.id}/decisions`, {
          method: 'POST',
          headers: headers(stranger),
          body: JSON.stringify({ ...decisionBody, idempotencyKey: `${domain}-stranger-save` }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request('/api/session', {
          method: 'DELETE',
          headers: { cookie },
        })
      ).status,
    ).toBe(200);
    expect(
      await demand.readWindow(new Date('2000-01-01T00:00:00Z'), new Date('2100-01-01T00:00:00Z')),
    ).toEqual([]);
  });
});

/**
 * S3's remaining exit criteria: consent gates aggregate use, deduplication holds, and a
 * withdrawal makes a published snapshot unreadable until it is recomputed.
 */
describe.each([
  ['outfit', 'A relaxed neutral outfit with a structured bag'],
  ['setup', 'A compact writing setup with a warm desk light'],
] as const)('S3 %s consented aggregation', (domain, text) => {
  async function shopperSaves(
    app: ReturnType<typeof createApp>,
    seq: number,
  ): Promise<{ cookie: string }> {
    const cookie = await getSession(app);
    const created = IntentBriefSchema.parse(
      await (
        await app.request('/api/briefs', {
          method: 'POST',
          headers: headers(cookie),
          body: JSON.stringify({ domain, text, country: 'CA', currency: 'CAD' }),
        })
      ).json(),
    );
    const confirmed = IntentBriefSchema.parse(
      await (
        await app.request(`/api/briefs/${created.id}`, {
          method: 'PATCH',
          headers: headers(cookie),
          body: JSON.stringify({
            expectedRevision: created.revision,
            status: 'confirmed',
            slots: created.slots,
            country: created.country,
            currency: created.currency,
            itemBudget: null,
          }),
        })
      ).json(),
    );
    const { runId } = (await (
      await app.request(`/api/briefs/${confirmed.id}/matches`, {
        method: 'POST',
        headers: headers(cookie),
        body: '{}',
      })
    ).json()) as { runId: string };
    let match: { id: string; slots: { slotId: string; selectedOfferId: string | null }[] } | null =
      null;
    await expect
      .poll(async () => {
        const run = (await (
          await app.request(`/api/runs/${runId}`, { headers: { cookie } })
        ).json()) as { result: { collection: { match: typeof match } } | null };
        match = run.result?.collection?.match ?? null;
        return match?.id;
      })
      .toMatch(/^match_/);
    await app.request('/api/consent', {
      method: 'PUT',
      headers: headers(cookie),
      body: JSON.stringify({ state: 'granted', expectedVersion: null }),
    });
    const body = {
      idempotencyKey: `${domain}-agg-${seq}`,
      briefRevision: confirmed.revision,
      runId,
      matchId: match!.id,
      kind: 'collection_saved',
      selections: match!.slots.flatMap((slot) =>
        slot.selectedOfferId ? [{ slotId: slot.slotId, offerId: slot.selectedOfferId }] : [],
      ),
      rejectionReason: null,
    };
    const first = await app.request(`/api/briefs/${confirmed.id}/decisions`, {
      method: 'POST',
      headers: headers(cookie),
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(201);
    // The same key retried must not add a second observation.
    const retry = await app.request(`/api/briefs/${confirmed.id}/decisions`, {
      method: 'POST',
      headers: headers(cookie),
      body: JSON.stringify(body),
    });
    expect(retry.status).toBe(200);
    return { cookie };
  }

  it('publishes only a consent-gated, coarse cohort and drops it on withdrawal', async () => {
    const demand = new PrivateDemandLedger();
    const intake = new IntakeStore();
    const projection = new DemandProjectionService({
      ledger: demand,
      briefs: (ids) => intake.findBriefs(ids),
      aggregator: createDemandAggregator(),
      minimumSessions: 5,
      retentionDays: 30,
      snapshotMinutes: 15,
      now: () => new Date(),
    });
    const app = createApp(
      { MILESTONES: 's1,s2,s3' },
      { demand, intake, demandProjection: projection },
    );

    const shoppers = [];
    for (let seq = 1; seq <= 6; seq += 1) shoppers.push(await shopperSaves(app, seq));

    const [summary, ...rest] = await projection.refresh('seed');
    expect(rest).toEqual([]);
    expect(summary.status).toBe('available');
    expect(summary.cohort.domain).toBe(domain);
    // Published evidence is banded and carries no session or event identifier.
    expect(typeof summary.eligibleSessions).not.toBe('number');
    expect(JSON.stringify(summary)).not.toMatch(/sess_|evt_|brief_/);
    expect(projection.published(summary.aggregateId)).toEqual(summary);

    // Erasing one contributor invalidates the snapshot until it is recomputed.
    await app.request('/api/session', {
      method: 'DELETE',
      headers: { cookie: shoppers[0]!.cookie },
    });
    expect(projection.published(summary.aggregateId)).toBeNull();

    const [recomputed] = await projection.refresh('seed');
    expect(recomputed.aggregateId).toBe(summary.aggregateId);
    expect(recomputed.status).toBe('available');
  });
});
