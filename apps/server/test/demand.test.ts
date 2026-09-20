import { readFileSync } from 'node:fs';
import {
  CollectionMatchSchema,
  type DemandEvent,
  IntentBriefSchema,
  ProductOfferSchema,
} from '@sei/contracts';
import type { CollectionRunResult } from '@sei/pipeline';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PrivateDemandLedger } from '../src/services/demand';
import { IntakeStore } from '../src/services/intake';
import { RunRegistry } from '../src/services/runs';

const S3 = { MILESTONES: 's1,s2,s3' };
const fixture = (domain: string, file: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../fixtures/seed/${domain}/${file}.json`, import.meta.url), 'utf8'),
  );
const json = (cookie: string) => ({ cookie, 'content-type': 'application/json' });
const session = async (app: ReturnType<typeof createApp>) =>
  (await app.request('/api/session')).headers.get('set-cookie')!.split(';')[0]!;

async function setup(domain: 'outfit' | 'setup') {
  const intake = new IntakeStore();
  const runs = new RunRegistry();
  const demand = new PrivateDemandLedger();
  const now = new Date('2026-09-19T15:00:00Z');
  const app = createApp(S3, { intake, runs, demand, now: () => now });
  const cookie = await session(app);
  const ownerId = cookie.split('=')[1]!;
  const brief = IntentBriefSchema.parse(fixture(domain, 'brief'));
  const match = CollectionMatchSchema.parse(fixture(domain, 'matches')[0]);
  const offers = ProductOfferSchema.array().parse(fixture(domain, 'offers'));
  const runId = `run_${domain}_decision`;
  const result: CollectionRunResult = {
    runId,
    briefId: brief.id,
    briefRevision: brief.revision,
    domain,
    sampleOrigin: 'seed',
    status: 'ready',
    collection: { match, explanation: { matchId: match.id, summary: [], slots: [] } },
    alternatives: [],
    offers,
    candidates: match.slots.map((slot) => ({
      slotId: slot.slotId,
      offerIds: [slot.selectedOfferId, ...slot.alternativeOfferIds].filter(
        (id): id is string => id !== null,
      ),
    })),
    missing: [],
    queries: [],
    stages: [],
    warnings: [],
    usage: { catalog_query: 0, fetch: 0, browser_session: 0, model_call: 0 },
    startedAt: now.toISOString(),
    finishedAt: now.toISOString(),
  };
  intake.saveBrief(ownerId, brief, null);
  runs.start(ownerId, () => ({
    runId,
    briefId: brief.id,
    briefRevision: brief.revision,
    result: Promise.resolve(result),
    cancel() {},
  }));
  await Promise.resolve();
  const selections = match.slots.flatMap((slot) =>
    slot.selectedOfferId ? [{ slotId: slot.slotId, offerId: slot.selectedOfferId }] : [],
  );
  return { app, brief, cookie, demand, match, offers, ownerId, runId, selections };
}

describe.each(['outfit', 'setup'] as const)('S3 %s private demand API', (domain) => {
  it('records displayed choices, derives private fields, and deduplicates retries', async () => {
    const state = await setup(domain);
    const consent = await state.app.request('/api/consent', {
      method: 'PUT',
      headers: json(state.cookie),
      body: JSON.stringify({ state: 'granted', expectedVersion: null }),
    });
    expect(consent.status).toBe(200);
    const request = {
      idempotencyKey: `${domain}-save-0001`,
      briefRevision: state.brief.revision,
      runId: state.runId,
      matchId: state.match.id,
      kind: 'collection_saved',
      selections: state.selections,
      rejectionReason: null,
    };
    const first = await state.app.request(`/api/briefs/${state.brief.id}/decisions`, {
      method: 'POST',
      headers: json(state.cookie),
      body: JSON.stringify(request),
    });
    expect(first.status).toBe(201);
    const created = (await first.json()) as { event: DemandEvent; duplicate: boolean };
    expect(created).toMatchObject({
      duplicate: false,
      event: {
        sessionId: state.ownerId,
        consentVersion: 1,
        occurredAt: '2026-09-19T15:00:00.000Z',
        sampleOrigin: 'seed',
      },
    });
    expect(created.event.selections.map((value) => value.merchantId)).toEqual(
      state.selections.map(
        (selection) => state.offers.find((offer) => offer.id === selection.offerId)!.merchant.id,
      ),
    );
    const retry = await state.app.request(`/api/briefs/${state.brief.id}/decisions`, {
      method: 'POST',
      headers: json(state.cookie),
      body: JSON.stringify(request),
    });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ event: created.event, duplicate: true });
    const conflict = await state.app.request(`/api/briefs/${state.brief.id}/decisions`, {
      method: 'POST',
      headers: json(state.cookie),
      body: JSON.stringify({ ...request, kind: 'offer_requested' }),
    });
    expect(conflict.status).toBe(409);
    const recorded = await state.demand.readWindow(
      new Date('2026-09-19T00:00:00Z'),
      new Date('2026-09-20T00:00:00Z'),
    );
    // Opting in records one confirmation observation; the retry and the conflicting
    // request add no second decision.
    expect(recorded.filter((event) => event.kind === 'brief_confirmed')).toHaveLength(1);
    expect(recorded.filter((event) => event.kind !== 'brief_confirmed')).toHaveLength(1);
    await state.demand.deleteSession(state.ownerId);
    await expect(state.demand.append(created.event, `${domain}-late-write`)).rejects.toThrow(
      'deleted',
    );
  });

  it('rejects foreign owners, private fields, stale and forged selections', async () => {
    const state = await setup(domain);
    const stranger = await session(state.app);
    const base = {
      idempotencyKey: `${domain}-forge-01`,
      briefRevision: state.brief.revision,
      runId: state.runId,
      matchId: state.match.id,
      kind: 'item_accepted',
      selections: [state.selections[0]!],
      rejectionReason: null,
    };
    const post = (cookie: string, body: unknown) =>
      state.app.request(`/api/briefs/${state.brief.id}/decisions`, {
        method: 'POST',
        headers: json(cookie),
        body: JSON.stringify(body),
      });
    expect((await post(stranger, base)).status).toBe(404);
    expect(
      (
        await post(state.cookie, {
          ...base,
          sessionId: state.ownerId,
          sampleOrigin: 'live',
        })
      ).status,
    ).toBe(400);
    expect(
      (await post(state.cookie, { ...base, briefRevision: state.brief.revision + 1 })).status,
    ).toBe(409);
    const wrongOffer = state.selections[1]?.offerId ?? 'offer_unseen';
    expect(
      (
        await post(state.cookie, {
          ...base,
          selections: [{ slotId: state.selections[0]!.slotId, offerId: wrongOffer }],
        })
      ).status,
    ).toBe(422);
  });

  it('records brief confirmation as a consented observation on opt-in', async () => {
    const { app, brief, cookie, demand } = await setup(domain);

    // Opting in is the moment a confirmed brief becomes an eligible contribution (§6.1),
    // so a shopper who confirms requirements but picks nothing still has a denominator entry.
    const granted = await app.request('/api/consent', {
      method: 'PUT',
      headers: json(cookie),
      body: JSON.stringify({ state: 'granted', expectedVersion: null }),
    });
    expect(granted.status).toBe(200);

    const events = await demand.readWindow(
      new Date('2000-01-01T00:00:00Z'),
      new Date('2100-01-01T00:00:00Z'),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      briefId: brief.id,
      briefRevision: brief.revision,
      kind: 'brief_confirmed',
      consentVersion: 1,
      matchId: null,
      selections: [],
    });
  });

  it('records a confirmation made after opt-in, not only the one at opt-in', async () => {
    const state = await setup(domain);
    await state.app.request('/api/consent', {
      method: 'PUT',
      headers: json(state.cookie),
      body: JSON.stringify({ state: 'granted', expectedVersion: null }),
    });

    // Confirming another revision while consent already stands is still a contribution.
    const revised = await state.app.request(`/api/briefs/${state.brief.id}`, {
      method: 'PATCH',
      headers: json(state.cookie),
      body: JSON.stringify({
        expectedRevision: state.brief.revision,
        status: 'confirmed',
        slots: state.brief.slots,
        country: state.brief.country,
        currency: state.brief.currency,
        itemBudget: state.brief.itemBudget,
      }),
    });
    expect(revised.status).toBe(200);

    const events = await state.demand.readWindow(
      new Date('2000-01-01T00:00:00Z'),
      new Date('2100-01-01T00:00:00Z'),
    );
    const revisions = events
      .filter((event) => event.kind === 'brief_confirmed')
      .map((event) => event.briefRevision)
      .sort();
    expect(revisions).toEqual([state.brief.revision, state.brief.revision + 1]);
  });

  it('versions consent, blocks stale writes, and erases all session demand', async () => {
    const state = await setup(domain);
    state.demand.publishSnapshot('snapshot_test', { privateCount: 7 });
    const putConsent = (stateName: 'granted' | 'withdrawn', expectedVersion: number | null) =>
      state.app.request('/api/consent', {
        method: 'PUT',
        headers: json(state.cookie),
        body: JSON.stringify({ state: stateName, expectedVersion }),
      });
    expect((await putConsent('granted', null)).status).toBe(200);
    expect(state.demand.readSnapshot('snapshot_test')).toBeNull();
    state.demand.publishSnapshot('snapshot_test', { privateCount: 7 });
    const withdraw = await putConsent('withdrawn', 1);
    expect(withdraw.status).toBe(200);
    expect(await withdraw.json()).toMatchObject({ version: 2, state: 'withdrawn' });
    expect(state.demand.readSnapshot('snapshot_test')).toBeNull();
    expect((await putConsent('granted', 1)).status).toBe(409);
    expect(await (await putConsent('granted', 2)).json()).toMatchObject({
      version: 3,
      state: 'granted',
    });
    state.demand.publishSnapshot('snapshot_test', { privateCount: 7 });
    expect(
      (
        await state.app.request('/api/session', {
          method: 'DELETE',
          headers: { cookie: state.cookie },
        })
      ).status,
    ).toBe(200);
    expect(await state.demand.getConsent(state.ownerId)).toBeNull();
    expect(
      await state.demand.readWindow(
        new Date('2026-09-19T00:00:00Z'),
        new Date('2026-09-20T00:00:00Z'),
      ),
    ).toEqual([]);
    expect(state.demand.readSnapshot('snapshot_test')).toBeNull();
  });
});

it('keeps consent available with obsolete S1/S2 configuration', async () => {
  const app = createApp({ MILESTONES: 's1,s2' });
  const cookie = await session(app);
  expect((await app.request('/api/consent', { headers: { cookie } })).status).toBe(200);
});
