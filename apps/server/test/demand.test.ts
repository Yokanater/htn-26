/** S3-L4 demand ledger: owner decisions, consent CAS, erasure, snapshot invalidation. */

import { readFileSync } from 'node:fs';
import {
  type ConsentRecord,
  ConsentRecordSchema,
  type DemandEvent,
  DemandEventSchema,
  type IntentBrief,
  IntentBriefSchema,
  newId,
  type ProductOffer,
  ProductOfferSchema,
  type ShoppingDomain,
} from '@sei/contracts';
import type { CollectionRunner, CollectionRunResult } from '@sei/pipeline';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app';
import { defaultProviders } from '../src/providers';
import {
  DemandLedger,
  filterEligibleDemandEvents,
  SnapshotInvalidatedError,
} from '../src/services/demand';

type App = ReturnType<typeof createApp>;
const S3 = { MILESTONES: 's1,s2,s3' };
const S2 = { MILESTONES: 's1,s2' };

const CASES = [
  {
    domain: 'outfit' as const,
    text: 'A relaxed neutral outfit with a structured bag',
    slot: 'top',
    constraint: { kind: 'size', value: 'M' },
  },
  {
    domain: 'setup' as const,
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
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

const seedOffers = (domain: ShoppingDomain): ProductOffer[] =>
  z
    .array(ProductOfferSchema)
    .parse(
      JSON.parse(
        readFileSync(
          new URL(`../../../fixtures/seed/${domain}/offers.json`, import.meta.url),
          'utf8',
        ),
      ),
    );

async function draftBrief(app: App, cookie: string, domain: ShoppingDomain, text: string) {
  const response = await app.request('/api/briefs', {
    method: 'POST',
    headers: json(cookie),
    body: JSON.stringify({ domain, text }),
  });
  return IntentBriefSchema.parse(await response.json());
}

async function patchBrief(
  app: App,
  cookie: string,
  brief: IntentBrief,
  status: 'draft' | 'confirmed',
  constraints: Record<string, unknown[]> = {},
) {
  const response = await app.request(`/api/briefs/${brief.id}`, {
    method: 'PATCH',
    headers: json(cookie),
    body: JSON.stringify({
      expectedRevision: brief.revision,
      status,
      slots: brief.slots.map((slot) => ({
        ...slot,
        constraints: constraints[slot.category] ?? slot.constraints,
      })),
      country: brief.country,
      currency: brief.currency,
      itemBudget: brief.itemBudget,
    }),
  });
  expect(response.status).toBe(200);
  return IntentBriefSchema.parse(await response.json());
}

async function confirmedBrief(app: App, cookie: string, c: (typeof CASES)[number]) {
  const draft = await draftBrief(app, cookie, c.domain, c.text);
  return patchBrief(app, cookie, draft, 'confirmed', { [c.slot]: [c.constraint] });
}

async function completeRun(app: App, cookie: string, briefId: string) {
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
    status: string;
    result: CollectionRunResult | null;
  };
  return { runId, status: body.status, result: body.result };
}

const decide = (app: App, cookie: string, briefId: string, body: unknown, key = 'key-1') =>
  app.request(`/api/briefs/${briefId}/decisions`, {
    method: 'POST',
    headers: json(cookie, { 'Idempotency-Key': key }),
    body: JSON.stringify(body),
  });

const putConsent = (app: App, cookie: string, body: unknown) =>
  app.request('/api/consent', {
    method: 'PUT',
    headers: json(cookie),
    body: JSON.stringify(body),
  });

function hangingCatalog() {
  const catalog = {
    async search(_query: unknown, context: { signal: AbortSignal }) {
      await new Promise<never>((_, reject) =>
        context.signal.addEventListener('abort', () => reject(context.signal.reason), {
          once: true,
        }),
      );
      return [];
    },
    async profileMerchant() {
      throw new Error('not used');
    },
  };
  return catalog;
}

function scriptedRunner(
  build: (brief: IntentBrief, runId: string) => CollectionRunResult,
): CollectionRunner {
  const latest = new Map<string, number>();
  return {
    start(brief) {
      latest.set(brief.id, Math.max(latest.get(brief.id) ?? 0, brief.revision));
      const runId = newId('run_');
      const result = build(brief, runId);
      return {
        runId,
        briefId: brief.id,
        briefRevision: brief.revision,
        result: Promise.resolve(result),
        cancel() {},
      };
    },
    invalidate(briefId, revision) {
      latest.set(briefId, Math.max(latest.get(briefId) ?? 0, revision));
    },
    latestRevision(briefId) {
      return latest.get(briefId) ?? null;
    },
  };
}

function readyResult(
  brief: IntentBrief,
  runId: string,
  offers: ProductOffer[],
  extra: Partial<CollectionRunResult> & {
    extraOffers?: ProductOffer[];
    alternativeOfferIds?: string[][];
  } = {},
): CollectionRunResult {
  const { extraOffers = [], alternativeOfferIds = [], ...overrides } = extra;
  const matchId = newId('match_');
  const match = {
    id: matchId,
    briefId: brief.id,
    briefRevision: brief.revision,
    status: 'ready' as const,
    slots: brief.slots.map((slot, index) => ({
      slotId: slot.id,
      selectedOfferId: offers[index]!.id,
      alternativeOfferIds: alternativeOfferIds[index] ?? [],
      required: slot.required,
      checks: [
        {
          key: 'availability',
          status: 'pass' as const,
          evidenceIds: [offers[index]!.evidence[0]!.id],
          explanation: 'Available.',
        },
      ],
    })),
    itemSubtotal: {
      amount: offers.reduce((sum, offer) => sum + (offer.price?.amount ?? 0), 0),
      currency: brief.currency,
    },
    excludesShippingAndTax: true as const,
    warnings: [],
    sampleOrigin: offers[0]!.sampleOrigin,
  };
  return {
    runId,
    briefId: brief.id,
    briefRevision: brief.revision,
    domain: brief.domain,
    sampleOrigin: offers[0]!.sampleOrigin,
    status: 'ready',
    collection: {
      match,
      explanation: {
        matchId,
        summary: [{ text: 'A collection.', basis: 'computed_summary', evidenceIds: [] }],
        slots: match.slots.map((slot) => ({
          slotId: slot.slotId,
          category: offers.find((offer) => offer.id === slot.selectedOfferId)?.category ?? 'item',
          required: slot.required,
          state: 'selected' as const,
          lines: [],
        })),
      },
    },
    alternatives: [],
    offers: [...offers, ...extraOffers],
    candidates: brief.slots.map((slot, index) => ({
      slotId: slot.id,
      offerIds: [offers[index]!.id, ...(extraOffers.map((offer) => offer.id) ?? [])],
    })),
    missing: [],
    queries: [],
    stages: [],
    warnings: [],
    usage: { catalog_query: 0, fetch: 0, browser_session: 0, model_call: 0 },
    startedAt: '2026-09-19T12:00:00.000Z',
    finishedAt: '2026-09-19T12:00:01.000Z',
    ...overrides,
  };
}

describe.each(CASES)('$domain demand routes', (c) => {
  it('records explicit product and brief decisions with server-owned provenance', async () => {
    const app = createApp(S3);
    const cookie = await session(app);
    const brief = await confirmedBrief(app, cookie, c);
    const { runId, result } = await completeRun(app, cookie, brief.id);
    expect(result?.collection).not.toBeNull();
    const slot = result!.collection!.match.slots.find((item) => item.selectedOfferId)!;
    const offer = result!.offers.find((item) => item.id === slot.selectedOfferId)!;

    const accepted = await decide(
      app,
      cookie,
      brief.id,
      {
        kind: 'item_accepted',
        runId,
        matchId: result!.collection!.match.id,
        selections: [{ slotId: slot.slotId, offerId: offer.id }],
        briefRevision: brief.revision,
      },
      'accept-1',
    );
    expect(accepted.status).toBe(201);
    const event = DemandEventSchema.parse(await accepted.json());
    expect(event.sessionId).toBe(ownerIdOf(cookie));
    expect(event.sampleOrigin).toBe(result!.sampleOrigin);
    expect(event.selections[0]?.merchantId).toBe(offer.merchant.id);
    expect(event.consentVersion).toBeNull();

    const confirmed = await decide(
      app,
      cookie,
      brief.id,
      { kind: 'brief_confirmed', briefRevision: brief.revision },
      'confirm-1',
    );
    expect(confirmed.status).toBe(201);
    expect(DemandEventSchema.parse(await confirmed.json())).toMatchObject({
      kind: 'brief_confirmed',
      matchId: null,
      selections: [],
    });
  });

  it('rejects unfinished, cancelled, superseded and deleted runs', async () => {
    const hanging = hangingCatalog();
    const app = createApp(S3, { catalog: hanging });
    const cookie = await session(app);
    const brief = await confirmedBrief(app, cookie, c);
    const started = await app.request(`/api/briefs/${brief.id}/matches`, {
      method: 'POST',
      headers: json(cookie),
      body: '{}',
    });
    const { runId } = (await started.json()) as { runId: string };
    await tick();
    expect(
      (
        await decide(app, cookie, brief.id, {
          kind: 'item_accepted',
          runId,
          matchId: 'match_unfinished',
          selections: [{ slotId: brief.slots[0]!.id, offerId: 'offer_x' }],
          briefRevision: brief.revision,
        })
      ).status,
    ).toBe(404);

    await app.request(`/api/runs/${runId}`, { method: 'DELETE', headers: { cookie } });
    await (await app.request(`/api/runs/${runId}/events`, { headers: { cookie } })).text();
    expect(
      (
        await decide(app, cookie, brief.id, {
          kind: 'item_accepted',
          runId,
          matchId: 'match_cancelled',
          selections: [{ slotId: brief.slots[0]!.id, offerId: 'offer_x' }],
          briefRevision: brief.revision,
        })
      ).status,
    ).toBe(404);
  });

  it('returns 409 when a finished run is superseded by a newer brief revision', async () => {
    const app = createApp(S3);
    const cookie = await session(app);
    const brief = await confirmedBrief(app, cookie, c);
    const { runId, result } = await completeRun(app, cookie, brief.id);
    const slot = result!.collection!.match.slots.find((item) => item.selectedOfferId)!;
    const next = await patchBrief(app, cookie, brief, 'confirmed');
    expect(next.revision).toBeGreaterThan(brief.revision);
    const response = await decide(app, cookie, next.id, {
      kind: 'item_accepted',
      runId,
      matchId: result!.collection!.match.id,
      selections: [{ slotId: slot.slotId, offerId: slot.selectedOfferId }],
      briefRevision: next.revision,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'STALE_REVISION' } });
  });
});

describe('decision membership and provenance', () => {
  const c = CASES[0]!;

  it('rejects a match from another run and offers that were only discovered', async () => {
    const offers = seedOffers('outfit');
    const ghost = { ...offers[0]!, id: 'offer_ghost_discovered' };
    const runner = scriptedRunner((brief, runId) =>
      readyResult(brief, runId, offers, { extraOffers: [ghost] }),
    );
    const app = createApp(S3, { runner });
    const cookie = await session(app);
    const first = await confirmedBrief(app, cookie, c);
    const secondDraft = await draftBrief(app, cookie, c.domain, `${c.text} and a second look`);
    const second = await patchBrief(app, cookie, secondDraft, 'confirmed');
    const a = await completeRun(app, cookie, first.id);
    const b = await completeRun(app, cookie, second.id);
    const slot = a.result!.collection!.match.slots[0]!;

    expect(
      (
        await decide(app, cookie, second.id, {
          kind: 'item_accepted',
          runId: b.runId,
          matchId: a.result!.collection!.match.id,
          selections: [{ slotId: slot.slotId, offerId: slot.selectedOfferId }],
          briefRevision: second.revision,
        })
      ).status,
    ).toBe(404);

    const discovered = await decide(app, cookie, first.id, {
      kind: 'item_accepted',
      runId: a.runId,
      matchId: a.result!.collection!.match.id,
      selections: [{ slotId: slot.slotId, offerId: ghost.id }],
      briefRevision: first.revision,
    });
    expect(discovered.status).toBe(400);
    expect(await discovered.json()).toMatchObject({ error: { code: 'INVALID_SELECTION' } });
  });

  it('rejects slot/offer mismatch and client-supplied server fields', async () => {
    const offers = seedOffers('outfit');
    const app = createApp(S3, {
      runner: scriptedRunner((brief, runId) => readyResult(brief, runId, offers)),
    });
    const cookie = await session(app);
    const brief = await confirmedBrief(app, cookie, c);
    const { runId, result } = await completeRun(app, cookie, brief.id);
    const [first, second] = result!.collection!.match.slots;
    expect(
      (
        await decide(app, cookie, brief.id, {
          kind: 'item_accepted',
          runId,
          matchId: result!.collection!.match.id,
          selections: [{ slotId: first!.slotId, offerId: second!.selectedOfferId }],
          briefRevision: brief.revision,
        })
      ).status,
    ).toBe(400);

    for (const extra of [
      { id: 'evt_forged' },
      { sessionId: ownerIdOf(cookie) },
      { occurredAt: '2026-01-01T00:00:00.000Z' },
      { sampleOrigin: 'live' },
      { consentVersion: 1 },
      { merchantId: 'mer_forged' },
    ]) {
      const response = await decide(app, cookie, brief.id, {
        kind: 'brief_confirmed',
        briefRevision: brief.revision,
        ...extra,
      });
      expect(response.status, JSON.stringify(extra)).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
    }

    const withMerchant = await decide(app, cookie, brief.id, {
      kind: 'item_accepted',
      runId,
      matchId: result!.collection!.match.id,
      selections: [
        {
          slotId: first!.slotId,
          offerId: first!.selectedOfferId,
          merchantId: 'mer_forged',
        },
      ],
      briefRevision: brief.revision,
    });
    expect(withMerchant.status).toBe(400);

    expect(
      (
        await app.request(`/api/briefs/${brief.id}/decisions`, {
          method: 'POST',
          headers: json(cookie),
          body: JSON.stringify({ kind: 'brief_confirmed', briefRevision: brief.revision }),
        })
      ).status,
    ).toBe(400);
  });

  it('rejects decisions against a failed run', async () => {
    const offers = seedOffers('outfit');
    const app = createApp(S3, {
      runner: scriptedRunner((brief, runId) =>
        readyResult(brief, runId, offers, { status: 'failed', collection: null, alternatives: [] }),
      ),
    });
    const cookie = await session(app);
    const brief = await confirmedBrief(app, cookie, c);
    const { runId } = await completeRun(app, cookie, brief.id);
    expect(
      (
        await decide(app, cookie, brief.id, {
          kind: 'item_accepted',
          runId,
          matchId: 'match_failed_run',
          selections: [{ slotId: brief.slots[0]!.id, offerId: offers[0]!.id }],
          briefRevision: brief.revision,
        })
      ).status,
    ).toBe(404);
  });

  it('allows rejecting a displayed alternative but not accepting it as the selected item', async () => {
    const offers = seedOffers('outfit');
    const alt = { ...offers[0]!, id: 'offer_alt_shown' };
    const runner = scriptedRunner((brief, runId) =>
      readyResult(brief, runId, offers, {
        extraOffers: [alt],
        alternativeOfferIds: [[alt.id]],
      }),
    );
    const app = createApp(S3, { runner });
    const cookie = await session(app);
    const brief = await confirmedBrief(app, cookie, c);
    const { runId, result } = await completeRun(app, cookie, brief.id);
    const slot = result!.collection!.match.slots[0]!;
    expect(
      (
        await decide(
          app,
          cookie,
          brief.id,
          {
            kind: 'item_accepted',
            runId,
            matchId: result!.collection!.match.id,
            selections: [{ slotId: slot.slotId, offerId: alt.id }],
            briefRevision: brief.revision,
          },
          'accept-alt',
        )
      ).status,
    ).toBe(400);
    const rejected = await decide(
      app,
      cookie,
      brief.id,
      {
        kind: 'item_rejected',
        runId,
        matchId: result!.collection!.match.id,
        selections: [{ slotId: slot.slotId, offerId: alt.id }],
        rejectionReason: 'style',
        briefRevision: brief.revision,
      },
      'reject-alt',
    );
    expect(rejected.status).toBe(201);
  });

  it('rejects brief_confirmed product fields and product decisions without a completed run', async () => {
    const app = createApp(S3);
    const cookie = await session(app);
    const brief = await confirmedBrief(app, cookie, c);
    expect(
      (
        await decide(app, cookie, brief.id, {
          kind: 'brief_confirmed',
          briefRevision: brief.revision,
          runId: 'run_not_allowed',
          matchId: 'match_not_allowed',
          selections: [{ slotId: brief.slots[0]!.id, offerId: 'offer_x' }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await decide(app, cookie, brief.id, {
          kind: 'item_accepted',
          briefRevision: brief.revision,
          selections: [{ slotId: brief.slots[0]!.id, offerId: 'offer_x' }],
        })
      ).status,
    ).toBe(400);
  });

  it('returns the original event for the same key and 409 for a different payload', async () => {
    const offers = seedOffers('outfit');
    const app = createApp(S3, {
      runner: scriptedRunner((brief, runId) => readyResult(brief, runId, offers)),
    });
    const cookie = await session(app);
    const brief = await confirmedBrief(app, cookie, c);
    const { runId, result } = await completeRun(app, cookie, brief.id);
    const slot = result!.collection!.match.slots[0]!;
    const body = {
      kind: 'item_accepted' as const,
      runId,
      matchId: result!.collection!.match.id,
      selections: [{ slotId: slot.slotId, offerId: slot.selectedOfferId }],
      briefRevision: brief.revision,
    };
    const first = await decide(app, cookie, brief.id, body, 'same-key');
    const retry = await decide(app, cookie, brief.id, body, 'same-key');
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(await first.json());

    const conflict = await decide(
      app,
      cookie,
      brief.id,
      { kind: 'brief_confirmed', briefRevision: brief.revision },
      'same-key',
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
  });

  it('hides foreign briefs and runs with 404 and requires a session', async () => {
    const app = createApp(S3);
    const owner = await session(app);
    const stranger = await session(app);
    const brief = await confirmedBrief(app, owner, c);
    const { runId, result } = await completeRun(app, owner, brief.id);
    const slot = result!.collection!.match.slots.find((item) => item.selectedOfferId)!;
    expect(
      (
        await decide(app, stranger, brief.id, {
          kind: 'item_accepted',
          runId,
          matchId: result!.collection!.match.id,
          selections: [{ slotId: slot.slotId, offerId: slot.selectedOfferId }],
          briefRevision: brief.revision,
        })
      ).status,
    ).toBe(404);
    expect(
      (await decide(app, '', brief.id, { kind: 'brief_confirmed', briefRevision: 1 })).status,
    ).toBe(401);
  });

  it('returns 404 and mutates nothing when the demand flag is off', async () => {
    const demand = new DemandLedger();
    const app = createApp(S2, { demand });
    const cookie = await session(app);
    const brief = await confirmedBrief(app, cookie, c);
    expect(
      (
        await decide(app, cookie, brief.id, {
          kind: 'brief_confirmed',
          briefRevision: brief.revision,
        })
      ).status,
    ).toBe(404);
    expect(
      (await putConsent(app, cookie, { state: 'granted', expectedVersion: null })).status,
    ).toBe(404);
    const windowEnd = new Date('2026-09-20T00:00:00.000Z');
    expect(await demand.readWindow(new Date(0), windowEnd)).toEqual([]);
    expect(await demand.getConsent(ownerIdOf(cookie))).toBeNull();
  });
});

describe('consent, snapshots and deletion', () => {
  const c = CASES[0]!;

  it('versions consent with CAS and invalidates snapshots on withdraw and re-consent', async () => {
    const demand = new DemandLedger();
    const app = createApp(S3, { demand });
    const cookie = await session(app);
    const sessionId = ownerIdOf(cookie);
    expect(
      (await putConsent(app, cookie, { state: 'withdrawn', expectedVersion: null })).status,
    ).toBe(400);
    const granted = ConsentRecordSchema.parse(
      await (await putConsent(app, cookie, { state: 'granted', expectedVersion: null })).json(),
    );
    expect(granted).toMatchObject({ sessionId, version: 1, state: 'granted' });

    await demand.append(liveEvent(sessionId, 1, '2026-09-19T12:00:00.000Z'), 'live-v1');
    const [firstSnap] = await demand.project({
      window: {
        start: new Date('2026-09-01T00:00:00.000Z'),
        end: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
    expect(firstSnap?.contributingSessions).toEqual([{ sessionId, consentVersion: 1 }]);

    const withdrawn = ConsentRecordSchema.parse(
      await (await putConsent(app, cookie, { state: 'withdrawn', expectedVersion: 1 })).json(),
    );
    expect(withdrawn.version).toBe(2);
    expect(() => demand.readSnapshot(firstSnap!.id)).toThrow(SnapshotInvalidatedError);

    const regranted = ConsentRecordSchema.parse(
      await (await putConsent(app, cookie, { state: 'granted', expectedVersion: 2 })).json(),
    );
    expect(regranted.version).toBe(3);
    const [revived] = await demand.project({
      window: {
        start: new Date('2026-09-01T00:00:00.000Z'),
        end: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
    expect(revived?.contributingSessions).toEqual([]);

    expect((await putConsent(app, cookie, { state: 'granted', expectedVersion: 2 })).status).toBe(
      409,
    );
  });

  it('rejects one of two concurrent consent updates sharing expectedVersion', async () => {
    const app = createApp(S3);
    const cookie = await session(app);
    expect(
      (await putConsent(app, cookie, { state: 'granted', expectedVersion: null })).status,
    ).toBe(200);
    const [first, second] = await Promise.all([
      putConsent(app, cookie, { state: 'withdrawn', expectedVersion: 1 }),
      putConsent(app, cookie, { state: 'declined', expectedVersion: 1 }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('cannot append a decision after the session is revoked', async () => {
    const demand = new DemandLedger();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    demand.beforeRecord = () => held;

    const offers = seedOffers('outfit');
    const app = createApp(S3, {
      demand,
      runner: scriptedRunner((brief, runId) => readyResult(brief, runId, offers)),
    });
    const cookie = await session(app);
    const brief = await confirmedBrief(app, cookie, c);
    const { runId, result } = await completeRun(app, cookie, brief.id);
    const slot = result!.collection!.match.slots[0]!;
    const pending = decide(
      app,
      cookie,
      brief.id,
      {
        kind: 'item_accepted',
        runId,
        matchId: result!.collection!.match.id,
        selections: [{ slotId: slot.slotId, offerId: slot.selectedOfferId }],
        briefRevision: brief.revision,
      },
      'race-key',
    );
    await tick();
    expect(
      (await app.request('/api/session', { method: 'DELETE', headers: { cookie } })).status,
    ).toBe(200);
    release();
    const raced = await pending;
    expect(raced.status).toBe(401);
    expect(await demand.readWindow(new Date(0), new Date('2099-01-01T00:00:00.000Z'))).toEqual([]);
  });

  it('deletes a run independently of the session and refuses later decisions', async () => {
    const providers = defaultProviders(S3);
    const app = createApp(S3, providers);
    const cookie = await session(app);
    const brief = await confirmedBrief(app, cookie, c);
    const { runId, result } = await completeRun(app, cookie, brief.id);
    const slot = result!.collection!.match.slots.find((item) => item.selectedOfferId)!;
    providers.runs.deleteOwner(ownerIdOf(cookie));
    expect(
      (
        await decide(app, cookie, brief.id, {
          kind: 'item_accepted',
          runId,
          matchId: result!.collection!.match.id,
          selections: [{ slotId: slot.slotId, offerId: slot.selectedOfferId }],
          briefRevision: brief.revision,
        })
      ).status,
    ).toBe(404);
  });
});

describe('fake aggregator eligibility', () => {
  it('keeps seed, withdrawn, stale-consent and out-of-window events out of live snapshots', async () => {
    const demand = new DemandLedger();
    const sessionId = 'sess_live_filter';
    await demand.setConsent(
      {
        sessionId,
        version: 1,
        state: 'granted',
        updatedAt: '2026-09-19T12:00:00.000Z',
      },
      null,
    );
    await demand.append(liveEvent(sessionId, 1, '2026-09-19T12:00:00.000Z', 'seed'), 'seed');
    await demand.append(liveEvent(sessionId, 1, '2026-08-01T00:00:00.000Z'), 'old');
    await demand.append(liveEvent(sessionId, 1, '2026-09-19T12:00:00.000Z'), 'live');
    const window = {
      start: new Date('2026-09-01T00:00:00.000Z'),
      end: new Date('2026-10-01T00:00:00.000Z'),
    };
    const [snapshot] = await demand.project({ window });
    expect(snapshot?.summary.status).toBe('insufficient_evidence');
    expect(snapshot?.contributingSessions).toEqual([{ sessionId, consentVersion: 1 }]);
    expect(snapshot?.sessionRefs.map((ref) => ref.sessionId)).toEqual([sessionId]);

    const consents: ConsentRecord[] = [
      { sessionId, version: 1, state: 'granted', updatedAt: '2026-09-19T12:00:00.000Z' },
    ];
    const events = await demand.readWindow(window.start, window.end);
    expect(
      filterEligibleDemandEvents({
        events,
        briefs: [],
        consents,
        window,
        origin: 'live',
        minimumSessions: 5,
      }).map((event) => event.id),
    ).toHaveLength(1);

    await demand.deleteSession(sessionId);
    expect(() => demand.readSnapshot(snapshot!.id)).toThrow(SnapshotInvalidatedError);
    expect(await demand.readWindow(window.start, window.end)).toEqual([]);
    expect(
      demand
        .listSnapshots()
        .some(
          (item) =>
            item.sessionRefs.some((ref) => ref.sessionId === sessionId) ||
            item.contributingSessions.some((ref) => ref.sessionId === sessionId),
        ),
    ).toBe(false);
  });

  it('does not leave deleted session IDs in a mixed-session snapshot listing', async () => {
    const demand = new DemandLedger();
    const window = {
      start: new Date('2026-09-01T00:00:00.000Z'),
      end: new Date('2026-10-01T00:00:00.000Z'),
    };
    const keep = 'sess_keep_listed';
    const gone = 'sess_erase_listed';
    for (const sessionId of [keep, gone]) {
      await demand.setConsent(
        {
          sessionId,
          version: 1,
          state: 'granted',
          updatedAt: '2026-09-19T12:00:00.000Z',
        },
        null,
      );
      await demand.append(liveEvent(sessionId, 1, '2026-09-19T12:00:00.000Z'), 'live');
    }
    const [mixed] = await demand.project({ window });
    expect(mixed?.sessionRefs.map((ref) => ref.sessionId).sort()).toEqual([gone, keep].sort());

    await demand.deleteSession(gone);
    expect(
      demand
        .listSnapshots()
        .flatMap((item) => [
          ...item.sessionRefs.map((ref) => ref.sessionId),
          ...item.contributingSessions.map((ref) => ref.sessionId),
        ]),
    ).not.toContain(gone);
    expect(() => demand.readSnapshot(mixed!.id)).toThrow(SnapshotInvalidatedError);
  });
});

describe('projection races with consent and erasure', () => {
  const window = {
    start: new Date('2026-09-01T00:00:00.000Z'),
    end: new Date('2026-10-01T00:00:00.000Z'),
  };

  it('does not publish a snapshot that still names a deleted session', async () => {
    const demand = new DemandLedger();
    const sessionId = 'sess_project_delete_race';
    await demand.setConsent(
      {
        sessionId,
        version: 1,
        state: 'granted',
        updatedAt: '2026-09-19T12:00:00.000Z',
      },
      null,
    );
    await demand.append(liveEvent(sessionId, 1, '2026-09-19T12:00:00.000Z'), 'live');
    const [prior] = await demand.project({ window });
    expect(prior?.sessionRefs.map((ref) => ref.sessionId)).toEqual([sessionId]);

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const atHook = new Promise<void>((resolve) => {
      entered = resolve;
    });
    demand.beforeProjectCommit = async () => {
      entered();
      await held;
    };
    const pending = demand.project({ window });
    await atHook;
    await demand.deleteSession(sessionId);
    release();

    const published = await pending;
    const listed = demand.listSnapshots();
    for (const snapshot of [...published, ...listed]) {
      expect(snapshot.sessionRefs.map((ref) => ref.sessionId)).not.toContain(sessionId);
      expect(snapshot.contributingSessions.map((ref) => ref.sessionId)).not.toContain(sessionId);
    }
    expect(() => demand.readSnapshot(prior!.id)).toThrow(SnapshotInvalidatedError);
  });

  it('does not resurrect withdrawn consent as a freshly valid snapshot', async () => {
    const demand = new DemandLedger();
    const sessionId = 'sess_project_withdraw_race';
    await demand.setConsent(
      {
        sessionId,
        version: 1,
        state: 'granted',
        updatedAt: '2026-09-19T12:00:00.000Z',
      },
      null,
    );
    await demand.append(liveEvent(sessionId, 1, '2026-09-19T12:00:00.000Z'), 'live');
    const [prior] = await demand.project({ window });
    expect(prior?.contributingSessions).toEqual([{ sessionId, consentVersion: 1 }]);

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const atHook = new Promise<void>((resolve) => {
      entered = resolve;
    });
    demand.beforeProjectCommit = async () => {
      entered();
      await held;
    };
    const pending = demand.project({ window });
    await atHook;
    await demand.setConsent(
      {
        sessionId,
        version: 2,
        state: 'withdrawn',
        updatedAt: '2026-09-19T12:01:00.000Z',
      },
      1,
    );
    release();

    const published = await pending;
    expect(() => demand.readSnapshot(prior!.id)).toThrow(SnapshotInvalidatedError);
    for (const snapshot of [
      ...published,
      ...demand.listSnapshots().filter((item) => !item.invalidated),
    ]) {
      expect(snapshot.contributingSessions).toEqual([]);
    }
  });
});

function liveEvent(
  sessionId: string,
  consentVersion: number,
  occurredAt: string,
  sampleOrigin: DemandEvent['sampleOrigin'] = 'live',
): DemandEvent {
  return DemandEventSchema.parse({
    id: newId('evt_'),
    sessionId,
    briefId: 'brief_filter_1',
    briefRevision: 1,
    consentVersion,
    occurredAt,
    sampleOrigin,
    kind: 'brief_confirmed',
    matchId: null,
    selections: [],
    rejectionReason: null,
  });
}
