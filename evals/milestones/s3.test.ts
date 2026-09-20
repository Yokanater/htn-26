/**
 * S3 gate: explicit decisions, consent versioning and erasure in both domains. Owner: L4.
 * Projection stays a safe fake: live/granted/current-version only, always insufficient_evidence.
 */
import {
  CapabilitiesSchema,
  ConsentRecordSchema,
  DemandEventSchema,
  type IntentBrief,
  IntentBriefSchema,
  type ShoppingDomain,
} from '@sei/contracts';
import type { CollectionRunResult } from '@sei/pipeline';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../apps/server/src/app';
import { DemandLedger, SnapshotInvalidatedError } from '../../apps/server/src/services/demand';

type App = ReturnType<typeof createApp>;
const S3 = { MILESTONES: 's1,s2,s3' };

const CASES = [
  {
    domain: 'outfit' as const satisfies ShoppingDomain,
    text: 'A relaxed neutral outfit with a structured bag',
    slot: 'top',
    constraint: { kind: 'size', value: 'M' },
  },
  {
    domain: 'setup' as const satisfies ShoppingDomain,
    text: 'A compact desk setup with warm lighting',
    slot: 'desk',
    constraint: { kind: 'dimension', axis: 'width', maxCm: 120 },
  },
];

const json = (cookie: string, extra: Record<string, string> = {}) => ({
  cookie,
  'Content-Type': 'application/json',
  ...extra,
});
const session = async (app: App) =>
  (await app.request('/api/session')).headers.get('set-cookie')?.split(';')[0] ?? '';
const ownerIdOf = (cookie: string) => cookie.replace(/^sei_owner=/, '');

async function confirm(app: App, cookie: string, c: (typeof CASES)[number]): Promise<IntentBrief> {
  const draft = IntentBriefSchema.parse(
    await (
      await app.request('/api/briefs', {
        method: 'POST',
        headers: json(cookie),
        body: JSON.stringify({ domain: c.domain, text: c.text }),
      })
    ).json(),
  );
  const response = await app.request(`/api/briefs/${draft.id}`, {
    method: 'PATCH',
    headers: json(cookie),
    body: JSON.stringify({
      expectedRevision: draft.revision,
      status: 'confirmed',
      slots: draft.slots.map((slot) => ({
        ...slot,
        constraints: slot.category === c.slot ? [c.constraint] : slot.constraints,
      })),
      country: draft.country,
      currency: draft.currency,
      itemBudget: draft.itemBudget,
    }),
  });
  expect(response.status).toBe(200);
  return IntentBriefSchema.parse(await response.json());
}

async function search(app: App, cookie: string, briefId: string) {
  const started = await app.request(`/api/briefs/${briefId}/matches`, {
    method: 'POST',
    headers: json(cookie),
    body: '{}',
  });
  expect(started.status).toBe(202);
  const { runId } = (await started.json()) as { runId: string };
  await (await app.request(`/api/runs/${runId}/events`, { headers: { cookie } })).text();
  const body = (await (
    await app.request(`/api/runs/${runId}`, { headers: { cookie } })
  ).json()) as {
    result: CollectionRunResult | null;
  };
  expect(body.result?.collection).not.toBeNull();
  return { runId, result: body.result as CollectionRunResult };
}

describe.each(CASES)('S3 $domain demand ledger', (c) => {
  it('records a validated selection, gates live eligibility, and erases on delete', async () => {
    const demand = new DemandLedger();
    const app = createApp(S3, { demand });
    const cookie = await session(app);
    const brief = await confirm(app, cookie, c);
    const { runId, result } = await search(app, cookie, brief.id);
    const match = result.collection!.match;
    const selections = match.slots
      .filter((slot) => slot.selectedOfferId)
      .map((slot) => ({ slotId: slot.slotId, offerId: slot.selectedOfferId as string }));

    const saved = await app.request(`/api/briefs/${brief.id}/decisions`, {
      method: 'POST',
      headers: json(cookie, { 'Idempotency-Key': `save-${c.domain}` }),
      body: JSON.stringify({
        kind: 'collection_saved',
        runId,
        matchId: match.id,
        selections,
        briefRevision: brief.revision,
      }),
    });
    expect(saved.status).toBe(201);
    const event = DemandEventSchema.parse(await saved.json());
    expect(event.kind).toBe('collection_saved');
    expect(event.sampleOrigin).toBe('seed');
    expect(event.selections.every((item) => item.merchantId.startsWith('mer_'))).toBe(true);

    const consent = ConsentRecordSchema.parse(
      await (
        await app.request('/api/consent', {
          method: 'PUT',
          headers: json(cookie),
          body: JSON.stringify({ state: 'granted', expectedVersion: null }),
        })
      ).json(),
    );
    expect(consent.state).toBe('granted');

    const window = {
      start: new Date('2026-09-01T00:00:00.000Z'),
      end: new Date('2026-10-01T00:00:00.000Z'),
    };
    const [snapshot] = await demand.project({ window, briefs: [brief] });
    expect(snapshot?.summary.status).toBe('insufficient_evidence');
    // Seed observations never become live support.
    expect(snapshot?.contributingSessions).toEqual([]);
    expect(snapshot?.sessionRefs[0]?.sessionId).toBe(ownerIdOf(cookie));

    expect(
      (
        await app.request('/api/consent', {
          method: 'PUT',
          headers: json(cookie),
          body: JSON.stringify({ state: 'withdrawn', expectedVersion: 1 }),
        })
      ).status,
    ).toBe(200);
    expect(() => demand.readSnapshot(snapshot!.id)).toThrow(SnapshotInvalidatedError);

    expect(
      (await app.request('/api/session', { method: 'DELETE', headers: { cookie } })).status,
    ).toBe(200);
    expect(await demand.readWindow(window.start, window.end)).toEqual([]);
    expect(
      (
        await app.request(`/api/briefs/${brief.id}/decisions`, {
          method: 'POST',
          headers: json(cookie, { 'Idempotency-Key': 'after-delete' }),
          body: JSON.stringify({ kind: 'brief_confirmed', briefRevision: brief.revision }),
        })
      ).status,
    ).toBe(401);
  });
});

describe('S3 flag surface', () => {
  it('advertises the demand section only when S3 is enabled', async () => {
    const enabled = CapabilitiesSchema.parse(
      await (await createApp(S3).request('/api/capabilities')).json(),
    );
    expect(enabled).toMatchObject({
      sections: expect.arrayContaining(['demand']),
      flags: expect.objectContaining({ FEATURE_DEMAND_LEDGER: true }),
    });
    const disabled = CapabilitiesSchema.parse(
      await (await createApp({ MILESTONES: 's1,s2' }).request('/api/capabilities')).json(),
    );
    expect(disabled.flags.FEATURE_DEMAND_LEDGER).toBe(false);
    expect(disabled.sections).not.toContain('demand');
  });
});
