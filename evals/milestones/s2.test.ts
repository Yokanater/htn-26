/**
 * S2 gate: a confirmed brief becomes a real-offer collection in both domains. Owner: L4.
 * Runs the whole stack offline: L1 injected catalog + L2 matcher + L3 runner + L4 routes, with the
 * synthetic seed inventory. Nothing here is mocked except the OpenAI SDK client in the provenance test.
 */
import { readFileSync } from 'node:fs';
import {
  type IntentBrief,
  IntentBriefSchema,
  type ProductOffer,
  ProductOfferSchema,
  type ShoppingDomain,
} from '@sei/contracts';
import type { CollectionRunResult } from '@sei/pipeline';
import { fakeVisionDraft, type OpenAiIntentModelOptions } from '@sei/reason';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../apps/server/src/app';
import { defaultProviders } from '../../apps/server/src/providers';

type App = ReturnType<typeof createApp>;
const S2 = { MILESTONES: 's1,s2' };

interface Case {
  domain: ShoppingDomain;
  text: string;
  /** Category of the slot that carries the hard constraint. */
  slot: string;
  ok: unknown;
  /** Known to be violated by the seed offer for `slot`. */
  violated: unknown;
  /** Not stated anywhere on the seed offer for `slot`. */
  unverifiable: unknown;
}

const CASES: Case[] = [
  {
    domain: 'outfit',
    text: 'A relaxed neutral outfit with a structured bag',
    slot: 'top',
    ok: { kind: 'size', value: 'M' },
    violated: { kind: 'size', value: 'L' },
    unverifiable: { kind: 'exclude_material', value: 'leather' },
  },
  {
    domain: 'setup',
    text: 'A compact desk setup with warm lighting',
    slot: 'desk',
    ok: { kind: 'dimension', axis: 'width', maxCm: 120 },
    violated: { kind: 'dimension', axis: 'width', maxCm: 50 },
    unverifiable: { kind: 'mounting', value: 'no_drilling' },
  },
];

const seedOffers = (domain: ShoppingDomain): ProductOffer[] =>
  z
    .array(ProductOfferSchema)
    .parse(
      JSON.parse(
        readFileSync(new URL(`../../fixtures/seed/${domain}/offers.json`, import.meta.url), 'utf8'),
      ),
    );

const json = (cookie: string) => ({ cookie, 'Content-Type': 'application/json' });
const session = async (app: App) =>
  (await app.request('/api/session')).headers.get('set-cookie')?.split(';')[0] ?? '';

async function draft(app: App, cookie: string, c: Case): Promise<IntentBrief> {
  const response = await app.request('/api/briefs', {
    method: 'POST',
    headers: json(cookie),
    body: JSON.stringify({ domain: c.domain, text: c.text }),
  });
  return IntentBriefSchema.parse(await response.json());
}

async function save(
  app: App,
  cookie: string,
  brief: IntentBrief,
  status: 'draft' | 'confirmed',
  constraints: Record<string, unknown[]>,
): Promise<IntentBrief> {
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

const confirmWith = async (app: App, cookie: string, c: Case, ...constraints: unknown[]) =>
  save(app, cookie, await draft(app, cookie, c), 'confirmed', { [c.slot]: constraints });

async function search(app: App, cookie: string, brief: IntentBrief) {
  const started = await app.request(`/api/briefs/${brief.id}/matches`, {
    method: 'POST',
    headers: json(cookie),
    body: '{}',
  });
  expect(started.status).toBe(202);
  const { runId } = (await started.json()) as { runId: string };
  const text = await (
    await app.request(`/api/runs/${runId}/events`, { headers: { cookie } })
  ).text();
  const frames = text
    .trim()
    .split(/\n\n+/)
    .map((block) => {
      const data = block.split('\n').find((line) => line.startsWith('data:'));
      return JSON.parse(data?.slice(5) ?? 'null') as { type: string; result?: CollectionRunResult };
    });
  const result = frames.find((frame) => frame.type === 'result')?.result;
  expect(result, 'the run streams a result').toBeDefined();
  return { runId, result: result as CollectionRunResult };
}

describe.each(CASES)('S2 $domain collection', (c) => {
  it('turns a confirmed brief into real seller offers whose known constraints hold', async () => {
    const app = createApp(S2);
    const cookie = await session(app);
    const brief = await confirmWith(app, cookie, c, c.ok);
    const { result } = await search(app, cookie, brief);
    const offers = seedOffers(c.domain);

    expect(result).toMatchObject({ status: 'ready', briefRevision: brief.revision, missing: [] });
    const match = result.collection!.match;
    expect(match.slots.map((slot) => slot.selectedOfferId)).toEqual(offers.map((o) => o.id));
    // Seller, product and variant identity all travel with the offer.
    for (const offer of result.offers) {
      expect(offer.merchant.domain).toBeTruthy();
      expect(offer.productId).toBeTruthy();
      expect(offer.variantId).toBeTruthy();
    }
    // Deterministic arithmetic in one currency; shipping and tax are never claimed.
    const expected = offers.reduce((sum, offer) => sum + (offer.price?.amount ?? 0), 0);
    expect(match.itemSubtotal).toEqual({ amount: expected, currency: brief.currency });
    expect(match.excludesShippingAndTax).toBe(true);
    expect(Object.keys(match).join(' ')).not.toMatch(/cart|checkout|shippingTotal/i);
    // Every hard constraint that was checked passed, and carries evidence.
    const constrained = match.slots.find((slot) =>
      slot.checks.some((check) => check.key !== 'availability'),
    );
    expect(constrained!.checks.every((check) => check.status === 'pass')).toBe(true);
    expect(result.collection!.explanation.summary.length).toBeGreaterThan(0);
    // Provenance: synthetic in, synthetic out.
    expect(result.sampleOrigin).toBe('seed');
    expect(match.sampleOrigin).toBe('seed');
  });

  it('charges each catalog query once through the real catalog adapter', async () => {
    const app = createApp(S2);
    const cookie = await session(app);
    const brief = await confirmWith(app, cookie, c, c.ok);
    const { result } = await search(app, cookie, brief);
    expect(result.queries.length).toBeGreaterThan(0);
    expect(result.usage.catalog_query).toBe(result.queries.length);
  });

  it('names an unverifiable hard constraint instead of calling the collection ready', async () => {
    const app = createApp(S2);
    const cookie = await session(app);
    const brief = await confirmWith(app, cookie, c, c.ok, c.unverifiable);
    const { result } = await search(app, cookie, brief);
    expect(result.status).toBe('partial');
    expect(result.missing).toContainEqual(
      expect.objectContaining({ kind: 'constraint', status: 'unknown' }),
    );
  });

  it('never forces an offer that violates a hard constraint', async () => {
    const app = createApp(S2);
    const cookie = await session(app);
    const brief = await confirmWith(app, cookie, c, c.violated);
    const { result } = await search(app, cookie, brief);
    const [violatedOffer] = seedOffers(c.domain);
    expect(result.status).toBe('partial');
    expect(result.missing).toContainEqual(
      expect.objectContaining({ kind: 'slot', reason: 'no_eligible_offer', category: c.slot }),
    );
    const selected = result.collection?.match.slots.map((slot) => slot.selectedOfferId) ?? [];
    expect(selected).not.toContain(violatedOffer!.id);
  });

  it('invalidates the old result when the brief revision changes', async () => {
    const app = createApp(S2);
    const cookie = await session(app);
    const first = await confirmWith(app, cookie, c, c.ok);
    const old = await search(app, cookie, first);
    expect(old.result.status).toBe('ready');

    const second = await save(app, cookie, first, 'confirmed', { [c.slot]: [c.violated] });
    expect(second.revision).toBe(first.revision + 1);
    const stale = await (
      await app.request(`/api/runs/${old.runId}`, { headers: { cookie } })
    ).json();
    expect(stale).toMatchObject({ status: 'superseded', result: null });

    const fresh = await search(app, cookie, second);
    expect(fresh.result.briefRevision).toBe(second.revision);
    expect(fresh.result.status).toBe('partial');
  });

  it('keeps searches private to their owner and behind the confirmation barrier', async () => {
    const app = createApp(S2);
    const owner = await session(app);
    const stranger = await session(app);
    const unconfirmed = await draft(app, owner, c);
    expect(
      (
        await app.request(`/api/briefs/${unconfirmed.id}/matches`, {
          method: 'POST',
          headers: json(owner),
          body: '{}',
        })
      ).status,
    ).toBe(409);

    const brief = await save(app, owner, unconfirmed, 'confirmed', { [c.slot]: [c.ok] });
    const { runId } = await search(app, owner, brief);
    for (const path of [`/api/runs/${runId}`, `/api/runs/${runId}/events`]) {
      expect((await app.request(path, { headers: { cookie: stranger } })).status).toBe(404);
    }
    expect(
      (
        await app.request(`/api/briefs/${brief.id}/matches`, {
          method: 'POST',
          headers: json(stranger),
          body: '{}',
        })
      ).status,
    ).toBe(404);

    const s1Only = createApp({ MILESTONES: 's1' });
    expect(
      (await s1Only.request(`/api/briefs/${brief.id}/matches`, { method: 'POST', body: '{}' }))
        .status,
    ).toBe(401);
  });

  it('never matches synthetic seed offers for a live brief', async () => {
    const env = { ...S2, VISION_PROVIDER: 'openai', OPENAI_MODEL_VISION: 'm', OPENAI_API_KEY: 'k' };
    const create = vi.fn(async () => {
      const text = JSON.stringify(fakeVisionDraft(c.domain));
      return {
        id: 'resp_s2',
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
        output_text: text,
      };
    });
    const providers = defaultProviders(env, {
      intentModel: {
        client: { responses: { create } } as unknown as OpenAiIntentModelOptions['client'],
        logger: () => {},
      },
    });
    const app = createApp(env, providers);
    const cookie = await session(app);
    const created = await draft(app, cookie, c);
    expect(created.sampleOrigin).toBe('live');
    const brief = await save(app, cookie, created, 'confirmed', {});

    const { result } = await search(app, cookie, brief);
    expect(result.sampleOrigin).toBe('live');
    expect(result.offers).toEqual([]);
    expect(result.collection).toBeNull();
    // The searches worked but nothing of this origin exists: partial with every slot named, not a failure.
    expect(result.status).toBe('partial');
    expect(result.missing).toEqual(
      brief.slots.map((slot) =>
        expect.objectContaining({ kind: 'slot', slotId: slot.id, reason: 'no_candidates' }),
      ),
    );
    expect(result.warnings).toContain('foreign_sample_origin_dropped');
  });
});
