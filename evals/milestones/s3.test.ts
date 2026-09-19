/** S3-L4 integration gate: explicit choices, consent versions, ownership and erasure. */
import { type DemandEvent, IntentBriefSchema } from '@sei/contracts';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../apps/server/src/app';
import { PrivateDemandLedger } from '../../apps/server/src/services/demand';

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
