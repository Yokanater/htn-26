import {
  CollaborationDraftSchema,
  type MerchantProfileSchema,
  MerchantRunSchema,
} from '@sei/contracts';
import { createOpportunityMapper } from '@sei/enrich';
import { createCollaborationComposer } from '@sei/reason';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { defaultProviders } from '../src/providers';
import { MerchantWorkspaceService } from '../src/services/merchant';

const env = {
  MILESTONES: 's1',
  FEATURE_MERCHANT_OPPORTUNITIES: 'false',
  FEATURE_DEMAND_LEDGER: 'false',
};
const session = async (app: ReturnType<typeof createApp>) =>
  (await app.request('/api/session')).headers.get('set-cookie')!.split(';')[0];
const headers = (cookie: string) => ({ cookie, 'content-type': 'application/json' });

describe.each(['outfit', 'setup'])('%s merchant routes', (domain) => {
  it('profiles, confirms, compares, edits and revalidates a private synthetic draft', async () => {
    const app = createApp(env);
    const cookie = await session(app);
    const start = await app.request('/api/merchants/profile', {
      method: 'POST',
      headers: headers(cookie),
      body: JSON.stringify({ url: `https://${domain}-brand-1.example`, domain }),
    });
    expect(start.status).toBe(202);
    const run = MerchantRunSchema.parse(await start.json());
    let profile: ReturnType<typeof MerchantProfileSchema.parse> | null = null;
    await expect
      .poll(async () => {
        const current = MerchantRunSchema.parse(
          await (
            await app.request(`/api/merchants/runs/${run.id}`, { headers: { cookie } })
          ).json(),
        );
        profile = current.profile;
        return current.status;
      })
      .toBe('ready');
    const stranger = await session(app);
    expect(
      (await app.request(`/api/merchants/runs/${run.id}`, { headers: { cookie: stranger } }))
        .status,
    ).toBe(404);
    const profiles = (await (
      await app.request('/api/merchants/profiles', { headers: { cookie } })
    ).json()) as { id: string; discoveredFor?: string; confirmed: boolean }[];
    expect(profiles.some((item) => item.discoveredFor === profile!.id && !item.confirmed)).toBe(
      true,
    );
    const id = profile!.id;
    expect(
      (await app.request(`/api/merchants/${id}/opportunities`, { headers: { cookie } })).status,
    ).toBe(409);
    const confirmation = {
      categories: profile!.offers.map((offer) => ({ offerId: offer.id, category: offer.category })),
    };
    expect(
      (
        await app.request(`/api/merchants/profiles/${id}/confirm`, {
          method: 'POST',
          headers: headers(cookie),
          body: JSON.stringify(confirmation),
        })
      ).status,
    ).toBe(200);
    const comparison = (await (
      await app.request(`/api/merchants/${id}/opportunities`, { headers: { cookie } })
    ).json()) as { opportunities: { id: string; basis: string }[] };
    expect(comparison.opportunities[0].basis).toBe('observed_pair');
    const created = await app.request(
      `/api/opportunities/${comparison.opportunities[0].id}/drafts`,
      { method: 'POST', headers: { cookie } },
    );
    expect(created.status).toBe(201);
    const draft = CollaborationDraftSchema.parse(await created.json());
    expect(draft.hypothesis).toContain('Synthetic');
    const edits = {
      expectedRevision: 1,
      title: 'Our proposal',
      experiment: draft.experiment,
      outreach: draft.outreach,
      merchantNotes: 'Confirm fulfillment.',
    };
    expect(
      (
        await app.request(`/api/drafts/${draft.id}`, {
          method: 'PATCH',
          headers: headers(cookie),
          body: JSON.stringify(edits),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/drafts/${draft.id}`, {
          method: 'PATCH',
          headers: headers(cookie),
          body: JSON.stringify(edits),
        })
      ).status,
    ).toBe(409);
    expect(
      (await app.request(`/api/drafts/${draft.id}`, { headers: { cookie: stranger } })).status,
    ).toBe(404);
    await app.request('/api/session', { method: 'DELETE', headers: { cookie } });
    expect((await app.request(`/api/drafts/${draft.id}`, { headers: { cookie } })).status).toBe(
      401,
    );
  });
});

it('keeps merchant routes available and rejects unauthenticated/malformed writes', async () => {
  const disabled = createApp({ MILESTONES: 's1,s2,s3' });
  expect((await disabled.request('/api/merchants/settings')).status).toBe(401);
  const app = createApp(env);
  expect((await app.request('/api/merchants/settings')).status).toBe(401);
  const cookie = await session(app);
  expect(
    (
      await app.request('/api/merchants/profile', {
        method: 'POST',
        headers: headers(cookie),
        body: JSON.stringify({ url: 'http://localhost', domain: 'outfit' }),
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await app.request('/api/merchants/profile', {
        method: 'POST',
        headers: { ...headers(cookie), origin: 'https://evil.example' },
        body: '{}',
      })
    ).status,
  ).toBe(403);
});

it('cancels provider work, bounds concurrency, and prevents late publication', async () => {
  const base = defaultProviders(env);
  let signal: AbortSignal | undefined;
  const merchants = new MerchantWorkspaceService({
    profiler: {
      origin: 'live',
      profile: async (input) => {
        signal = input.signal;
        return new Promise((_resolve, reject) =>
          input.signal.addEventListener('abort', () => reject(new Error('cancelled'))),
        );
      },
    },
    composer: createCollaborationComposer(),
    mapper: createOpportunityMapper(),
    projection: base.demandProjection,
    ledger: base.demand,
    sessions: base.sessions,
    now: base.now,
  });
  const app = createApp(env, { ...base, merchants });
  const cookie = await session(app);
  const request = () =>
    app.request('/api/merchants/profile', {
      method: 'POST',
      headers: headers(cookie),
      body: JSON.stringify({ url: 'https://store.example', domain: 'setup' }),
    });
  const run = MerchantRunSchema.parse(await (await request()).json());
  expect((await request()).status).toBe(429);
  expect(
    (await app.request(`/api/merchants/runs/${run.id}`, { method: 'DELETE', headers: { cookie } }))
      .status,
  ).toBe(200);
  expect(signal?.aborted).toBe(true);
  expect(
    MerchantRunSchema.parse(
      await (await app.request(`/api/merchants/runs/${run.id}`, { headers: { cookie } })).json(),
    ).status,
  ).toBe('cancelled');
  expect(
    await (await app.request('/api/merchants/profiles', { headers: { cookie } })).json(),
  ).toEqual([]);
});
