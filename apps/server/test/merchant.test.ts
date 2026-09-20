/** S4 merchant workspace: fixture-backed profile, opportunities, drafts, live opt-in profiler. */
import type { CatalogHit } from '@sei/collect';
import {
  MerchantCollaborationDraftSchema,
  MerchantOpportunityListSchema,
  MerchantOpportunitySchema,
  MerchantWorkspaceProfileSchema,
} from '@sei/contracts';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app';
import { defaultProviders } from '../src/providers';
import { loadDemoNewcomerHosts, loadSeedOffers } from '../src/replay';
import { PrivateDemandLedger } from '../src/services/demand';
import { MERCHANT_PROFILE_TIMEOUT_MS, merchantCatalogMode } from '../src/services/merchant-catalog';
import { classifyMerchantHost, parseMerchantUrl } from '../src/services/merchant-url';
import { MerchantWorkspaceStore } from '../src/services/merchant-workspace';

type App = ReturnType<typeof createApp>;
const S4 = { MILESTONES: 's1,s2,s3,s4' };
const FAKE = { ...S4, MERCHANT_CATALOG_PROVIDER: 'fake' } as const;
const S3 = { MILESTONES: 's1,s2,s3' };

const SEED_URLS = {
  outfit: 'https://outfit-brand-1.example/',
  setup: 'https://setup-brand-1.example/',
} as const;

const json = (cookie: string, extra: Record<string, string> = {}) => ({
  cookie,
  'Content-Type': 'application/json',
  ...extra,
});
const session = async (app: App) =>
  (await app.request('/api/session')).headers.get('set-cookie')?.split(';')[0] ?? '';
const ownerIdOf = (cookie: string) => cookie.replace(/^sei_owner=/, '');

it('returns a background job immediately, deduplicates it, isolates progress and cancels work', async () => {
  const providers = defaultProviders(FAKE);
  let aborted = false;
  const research = vi
    .spyOn(providers.merchantResearch, 'research')
    .mockImplementation(async (_offers, _request, signal, progress) => {
      progress?.({ stage: 'Checking products', completed: 1, total: 6 });
      return await new Promise((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(new Error('cancelled'));
          },
          { once: true },
        ),
      );
    });
  const app = createApp(FAKE, providers);
  const cookie = await session(app);
  const created = await profile(app, cookie, SEED_URLS.outfit);
  const base = `/api/merchants/${created.profile!.merchant.id}/research`;
  const start = () =>
    app.request(base, {
      method: 'POST',
      headers: json(cookie, { Prefer: 'respond-async' }),
      body: JSON.stringify({ country: 'CA', currency: 'CAD' }),
    });
  const response = await start();
  expect(response.status).toBe(202);
  const job = (await response.json()) as { jobId: string };
  expect(await (await start()).json()).toEqual(job);
  expect(research).toHaveBeenCalledOnce();
  const path = `${base}/jobs/${job.jobId}`;
  expect(await (await app.request(path, { headers: { cookie } })).json()).toMatchObject({
    status: 'running',
    progress: { completed: 1, total: 6 },
  });
  expect((await app.request(path, { headers: { cookie: await session(app) } })).status).toBe(404);
  expect((await app.request(path, { method: 'DELETE', headers: { cookie } })).status).toBe(200);
  expect(aborted).toBe(true);
  expect((await app.request(path, { headers: { cookie } })).status).toBe(404);
});

const PublicMerchantJson = z.union([
  MerchantWorkspaceProfileSchema,
  MerchantOpportunityListSchema,
  MerchantCollaborationDraftSchema,
  MerchantOpportunitySchema,
]);

function assertPublicMerchantPayload(value: unknown): void {
  PublicMerchantJson.parse(structuredClone(value));
  const text = JSON.stringify(value);
  expect(text).not.toMatch(/sess_|evt_|asset_|run_|brief_/);
  expect(text).not.toMatch(/"sessionId"|"consentVersion"|"slotId"/);
  expect(text).not.toMatch(/"eligibleSessions":\s*\d/);
  expect(text).not.toMatch(/"supportingSessions"/);
}

function throwingMerchantCatalog() {
  return {
    profileMerchant: vi.fn(async () => {
      throw new Error('network must not be used');
    }),
  };
}

async function profile(app: App, cookie: string, url: string) {
  const response = await app.request('/api/merchants/profile', {
    method: 'POST',
    headers: json(cookie),
    body: JSON.stringify({ url }),
  });
  const body = await response.json();
  if (response.status === 201) assertPublicMerchantPayload(body);
  return {
    response,
    body,
    profile: response.status === 201 ? MerchantWorkspaceProfileSchema.parse(body) : null,
  };
}

async function listOpportunities(app: App, cookie: string, merchantId: string) {
  const response = await app.request(`/api/merchants/${merchantId}/opportunities`, {
    headers: { cookie },
  });
  const body = await response.json();
  if (response.status === 200) assertPublicMerchantPayload(body);
  return {
    response,
    body,
    list: response.status === 200 ? MerchantOpportunityListSchema.parse(body) : null,
  };
}

async function createDraft(
  app: App,
  cookie: string,
  merchantId: string,
  opportunityId: string,
  body: unknown = {},
) {
  const response = await app.request(
    `/api/merchants/${merchantId}/opportunities/${opportunityId}/drafts`,
    {
      method: 'POST',
      headers: json(cookie),
      body: JSON.stringify(body),
    },
  );
  const payload = await response.json();
  if (response.status === 201) assertPublicMerchantPayload(payload);
  return {
    response,
    body: payload,
    draft: response.status === 201 ? MerchantCollaborationDraftSchema.parse(payload) : null,
  };
}

async function patchDraft(
  app: App,
  cookie: string,
  draftId: string,
  input: {
    expectedVersion: number;
    proposalText: string;
    uncertainties: string[];
    extra?: Record<string, unknown>;
  },
) {
  const { extra, ...fields } = input;
  const response = await app.request(`/api/drafts/${draftId}`, {
    method: 'PATCH',
    headers: json(cookie),
    body: JSON.stringify({ ...fields, ...extra }),
  });
  const payload = await response.json();
  if (response.status === 200) assertPublicMerchantPayload(payload);
  return {
    response,
    body: payload,
    draft: response.status === 200 ? MerchantCollaborationDraftSchema.parse(payload) : null,
  };
}

async function readDraft(app: App, cookie: string, draftId: string) {
  const response = await app.request(`/api/drafts/${draftId}`, { headers: { cookie } });
  const payload = await response.json();
  if (response.status === 200) assertPublicMerchantPayload(payload);
  return {
    response,
    body: payload,
    draft: response.status === 200 ? MerchantCollaborationDraftSchema.parse(payload) : null,
  };
}

describe.each([
  {
    domain: 'outfit' as const,
    url: SEED_URLS.outfit,
    opportunityId: 'opp_outfit_1',
    partner: 'mer_outfit_2',
  },
  {
    domain: 'setup' as const,
    url: SEED_URLS.setup,
    opportunityId: 'opp_setup_1',
    partner: 'mer_setup_2',
  },
])('S4 $domain observed merchant workspace', (c) => {
  it('profiles a seed URL, lists a banded opportunity, and PATCHes a draft', async () => {
    const demand = new PrivateDemandLedger();
    const readSnapshot = vi.spyOn(demand, 'readSnapshot');
    const app = createApp(S4, { demand });
    const cookie = await session(app);

    const created = await profile(app, cookie, c.url);
    expect(created.response.status).toBe(201);
    expect(created.profile?.workspace).toBe('synthetic_demo');
    expect(created.profile?.sampleOrigin).toBe('seed');
    const merchantId = created.profile!.merchant.id;

    const listed = await listOpportunities(app, cookie, merchantId);
    expect(listed.response.status).toBe(200);
    expect(listed.list?.opportunities).toHaveLength(1);
    const opportunity = listed.list!.opportunities[0]!;
    expect(opportunity.id).toBe(c.opportunityId);
    expect(opportunity.basis).toBe('observed_pair');
    expect(opportunity.demand.eligibleSessions).toEqual({ min: 5, max: 9 });
    expect(opportunity.observedPairSupport).toEqual({ min: 5, max: 9 });
    expect(opportunity.merchants.map((merchant) => merchant.id)).toContain(c.partner);
    const proposalText = opportunity.proposedExperiment;

    listed.list!.opportunities[0]!.proposedExperiment = 'mutated locally';
    const again = await listOpportunities(app, cookie, merchantId);
    expect(again.list!.opportunities[0]!.proposedExperiment).toBe(proposalText);

    const minted = await createDraft(app, cookie, merchantId, opportunity.id);
    expect(minted.response.status).toBe(201);
    expect(minted.draft?.version).toBe(1);
    expect(minted.draft?.proposalText).toBe(proposalText);

    const saved = await patchDraft(app, cookie, minted.draft!.id, {
      expectedVersion: 1,
      proposalText: 'Try a labeled synthetic co-curated drop',
      uncertainties: ['Costs, terms, and partner willingness are unknown'],
    });
    expect(saved.response.status).toBe(200);
    expect(saved.draft?.version).toBe(2);
    expect(saved.draft?.proposalText).toContain('synthetic');
    expect(readSnapshot).not.toHaveBeenCalled();
  });
});

describe('S4 merchant isolation and safety', () => {
  it('defaults every server to live merchant catalogs and normalizes bare domains to HTTPS', () => {
    expect(merchantCatalogMode(S4)).toBe('live');
    expect(merchantCatalogMode({ ...S4, MERCHANT_CATALOG_PROVIDER: '' })).toBe('live');
    expect(MERCHANT_PROFILE_TIMEOUT_MS).toBe(240_000);
    expect(parseMerchantUrl('store.example.com/collections/all')).toEqual({
      href: 'https://store.example.com/collections/all',
      host: 'store.example.com',
    });
  });

  it('keeps shopper Browserbase search off the merchant profiler and never hits the network for seed URLs', async () => {
    const merchantCatalog = throwingMerchantCatalog();
    const catalog = () => ({
      search: vi.fn(async () => {
        throw new Error('shopper search is not merchant profiling');
      }),
    });
    const app = createApp(S4, { catalog, merchantCatalog });
    const cookie = await session(app);
    const created = await profile(app, cookie, SEED_URLS.outfit);
    expect(created.response.status).toBe(201);
    expect(merchantCatalog.profileMerchant).not.toHaveBeenCalled();
  });

  it('rejects an unknown non-allowlisted domain without calling merchantCatalog', async () => {
    const merchantCatalog = throwingMerchantCatalog();
    const app = createApp(FAKE, { merchantCatalog });
    const cookie = await session(app);
    const created = await profile(app, cookie, 'https://not-a-seed.com/');
    expect(created.response.status).toBe(503);
    expect(created.body).toMatchObject({ error: { code: 'MERCHANT_CATALOG_DISABLED' } });
    expect(merchantCatalog.profileMerchant).not.toHaveBeenCalled();
  });

  it('rejects unsafe URLs before domain extraction', async () => {
    const merchantCatalog = throwingMerchantCatalog();
    const app = createApp(FAKE, { merchantCatalog });
    const cookie = await session(app);
    for (const url of [
      'http://outfit-brand-1.example/',
      'https://user:pass@outfit-brand-1.example/',
      'https://localhost/',
      'https://127.0.0.1/',
      'https://outfit-brand-1.example/?next=https://evil.test',
    ]) {
      expect((await profile(app, cookie, url)).response.status).toBe(400);
    }
    expect(merchantCatalog.profileMerchant).not.toHaveBeenCalled();
  });

  it('returns 401 without a session and 404 for a foreign merchant, opportunity, or draft', async () => {
    const app = createApp(S4);
    expect((await profile(app, '', SEED_URLS.outfit)).response.status).toBe(401);
    const first = await session(app);
    const second = await session(app);
    const created = await profile(app, first, SEED_URLS.outfit);
    const merchantId = created.profile!.merchant.id;
    const listed = await listOpportunities(app, first, merchantId);
    const minted = await createDraft(app, first, merchantId, listed.list!.opportunities[0]!.id);

    expect((await listOpportunities(app, second, merchantId)).response.status).toBe(404);
    expect((await createDraft(app, first, merchantId, 'opp_setup_1')).response.status).toBe(404);
    expect(
      (
        await patchDraft(app, second, minted.draft!.id, {
          expectedVersion: 1,
          proposalText: 'Should not work',
          uncertainties: ['Still unknown'],
        })
      ).response.status,
    ).toBe(404);
    expect((await readDraft(app, second, minted.draft!.id)).response.status).toBe(404);
    const current = await readDraft(app, first, minted.draft!.id);
    expect(current.response.status).toBe(200);
    expect(current.draft?.version).toBe(1);
  });

  it('rejects forged draft evidence IDs', async () => {
    const app = createApp(S4);
    const cookie = await session(app);
    const created = await profile(app, cookie, SEED_URLS.setup);
    const merchantId = created.profile!.merchant.id;
    const listed = await listOpportunities(app, cookie, merchantId);
    const minted = await createDraft(app, cookie, merchantId, listed.list!.opportunities[0]!.id);
    expect(
      (
        await patchDraft(app, cookie, minted.draft!.id, {
          expectedVersion: 1,
          proposalText: 'Keep the synthetic experiment',
          uncertainties: ['Unknown partner terms'],
          extra: { evidenceIds: ['ev_forged_1'] },
        })
      ).response.status,
    ).toBe(400);
    expect(
      (
        await createDraft(app, cookie, merchantId, listed.list!.opportunities[0]!.id, {
          evidenceIds: ['ev_forged_1'],
        })
      ).response.status,
    ).toBe(400);
  });

  it('returns the same merchant id on duplicate profile of the same domain', async () => {
    const app = createApp(S4);
    const cookie = await session(app);
    const first = await profile(app, cookie, SEED_URLS.outfit);
    const second = await profile(app, cookie, SEED_URLS.outfit);
    expect(second.profile?.merchant.id).toBe(first.profile?.merchant.id);
  });

  it('keeps two sessions that claim the same seed domain isolated', async () => {
    const app = createApp(S4);
    const first = await session(app);
    const second = await session(app);
    const a = await profile(app, first, SEED_URLS.outfit);
    const b = await profile(app, second, SEED_URLS.outfit);
    expect(a.profile?.merchant.id).toBe(b.profile?.merchant.id);
    const draftA = await createDraft(
      app,
      first,
      a.profile!.merchant.id,
      (await listOpportunities(app, first, a.profile!.merchant.id)).list!.opportunities[0]!.id,
    );
    expect(
      (
        await patchDraft(app, second, draftA.draft!.id, {
          expectedVersion: 1,
          proposalText: 'Cross-owner write',
          uncertainties: ['Should 404'],
        })
      ).response.status,
    ).toBe(404);
  });

  it('conflicts when two PATCH requests share expectedVersion', async () => {
    const workspace = new MerchantWorkspaceStore();
    const app = createApp(S4, { merchantWorkspace: workspace });
    const cookie = await session(app);
    const created = await profile(app, cookie, SEED_URLS.outfit);
    const merchantId = created.profile!.merchant.id;
    const opportunityId = (await listOpportunities(app, cookie, merchantId)).list!.opportunities[0]!
      .id;
    const minted = await createDraft(app, cookie, merchantId, opportunityId);
    let entered = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let bothEntered!: () => void;
    const ready = new Promise<void>((resolve) => {
      bothEntered = resolve;
    });
    workspace.beforePersist = async () => {
      entered += 1;
      if (entered === 2) bothEntered();
      await held;
    };
    const first = patchDraft(app, cookie, minted.draft!.id, {
      expectedVersion: 1,
      proposalText: 'First concurrent save',
      uncertainties: ['Unknown costs'],
    });
    const second = patchDraft(app, cookie, minted.draft!.id, {
      expectedVersion: 1,
      proposalText: 'Second concurrent save',
      uncertainties: ['Unknown terms'],
    });
    await ready;
    release();
    const statuses = [(await first).response.status, (await second).response.status].sort();
    expect(statuses).toEqual([200, 409]);
    const current = await readDraft(app, cookie, minted.draft!.id);
    expect(current.draft?.version).toBe(2);
  });

  it('does not resurrect workspace rows after a racing session delete', async () => {
    const workspace = new MerchantWorkspaceStore();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const atHook = new Promise<void>((resolve) => {
      entered = resolve;
    });
    workspace.beforePersist = async () => {
      entered();
      await held;
    };
    const app = createApp(S4, { merchantWorkspace: workspace });
    const cookie = await session(app);
    const ownerId = ownerIdOf(cookie);
    const pending = profile(app, cookie, SEED_URLS.setup);
    await atHook;
    expect(
      (await app.request('/api/session', { method: 'DELETE', headers: { cookie } })).status,
    ).toBe(200);
    release();
    expect((await pending).response.status).toBe(401);
    expect(workspace.ownerHasRows(ownerId)).toBe(false);
    expect(workspace.isEmpty()).toBe(true);
  });

  it('returns 409 when the frozen aggregate version changed', async () => {
    const workspace = new MerchantWorkspaceStore();
    const app = createApp(S4, { merchantWorkspace: workspace });
    const cookie = await session(app);
    const created = await profile(app, cookie, SEED_URLS.outfit);
    const merchantId = created.profile!.merchant.id;
    const opportunityId = (await listOpportunities(app, cookie, merchantId)).list!.opportunities[0]!
      .id;
    workspace.beforePersist = async () => {
      workspace.bumpStoredAggregateVersion(ownerIdOf(cookie), merchantId);
    };
    expect((await createDraft(app, cookie, merchantId, opportunityId)).response.status).toBe(409);
  });

  it('404s and stores nothing when FEATURE_MERCHANT_OPPORTUNITIES is off', async () => {
    const merchantCatalog = throwingMerchantCatalog();
    const merchantWorkspace = new MerchantWorkspaceStore();
    const app = createApp(S3, { merchantCatalog, merchantWorkspace });
    const cookie = await session(app);
    expect((await profile(app, cookie, SEED_URLS.outfit)).response.status).toBe(404);
    expect(merchantCatalog.profileMerchant).not.toHaveBeenCalled();
    expect(merchantWorkspace.isEmpty()).toBe(true);
  });
});

describe.each([
  {
    domain: 'outfit' as const,
    host: 'newcomer-outfit.example',
    partner: 'mer_outfit_2',
    partnerEvidence: 'ev_outfit_2',
  },
  {
    domain: 'setup' as const,
    host: 'newcomer-setup.example',
    partner: 'mer_setup_2',
    partnerEvidence: 'ev_setup_2',
  },
])('S4 $domain inferred newcomer', (c) => {
  it('pairs a complementary seed merchant on the default catalog without inheriting pair support', async () => {
    const demand = new PrivateDemandLedger();
    const readSnapshot = vi.spyOn(demand, 'readSnapshot');
    const app = createApp(S4, { demand });
    const cookie = await session(app);
    const created = await profile(app, cookie, `https://${c.host}/`);
    expect(created.response.status).toBe(201);
    const listed = await listOpportunities(app, cookie, created.profile!.merchant.id);
    const opportunity = MerchantOpportunitySchema.parse(listed.list!.opportunities[0]);
    expect(opportunity.basis).toBe('inferred_supply_fit');
    expect(opportunity.observedPairSupport).toBeNull();
    expect(opportunity.merchants[0]?.id).toBe(created.profile!.merchant.id);
    expect(opportunity.merchants[1]?.id).toBe(c.partner);
    expect(opportunity.productEvidenceIds).toEqual(expect.arrayContaining([c.partnerEvidence]));
    expect(opportunity.productEvidenceIds.length).toBeGreaterThan(1);
    expect(opportunity.demand.sampleOrigin).toBe('seed');
    expect(readSnapshot).not.toHaveBeenCalled();
  });
});

const LIVE = { MILESTONES: 's1,s2,s3,s4', MERCHANT_CATALOG_PROVIDER: 'live' } as const;
const PUBLIC_URLS = {
  outfit: 'https://public-outfit.shop/collections/all',
  setup: 'https://public-setup.shop/collections/all',
} as const;
const PUBLIC_IP = [{ address: '93.184.216.34', family: 4 as const }];
const SEED_DOMAINS = new Set(loadSeedOffers().map((offer) => offer.merchant.domain));
const NEWCOMER_HOSTS = loadDemoNewcomerHosts();

function publicHits(domain: 'outfit' | 'setup'): CatalogHit[] {
  const host = domain === 'outfit' ? 'public-outfit.shop' : 'public-setup.shop';
  const category = domain === 'outfit' ? 'top' : 'desk';
  return [
    {
      merchant: { name: `Live ${domain} shop`, domain: host },
      productId: `product-${category}`,
      variantId: `variant-${category}-1`,
      title: `Live ${category}`,
      category,
      productUrl: `https://${host}/products/${category}`,
      imageUrl: null,
      price: { amount: 4500, currency: 'CAD' },
      availability: 'available',
      shipsTo: ['CA'],
      attributes: {},
      evidenceMethod: 'fetch',
    },
  ];
}

function liveProfileDeps(
  domain: 'outfit' | 'setup',
  options: {
    lookupAddresses?: Array<{ address: string; family?: number }>;
    extractOffers?: CatalogHit[];
    fetch?: typeof fetch;
  } = {},
) {
  const lookup = vi.fn(async () => options.lookupAddresses ?? PUBLIC_IP);
  const extractOffers = vi.fn(() => options.extractOffers ?? publicHits(domain));
  const fetch =
    options.fetch ??
    vi.fn(
      async () =>
        new Response('<html><body>public catalog</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    );
  return { lookup, extractOffers, fetch };
}

describe('S4 merchant host classification', () => {
  it('keeps seed and allowlisted newcomers in-memory and only marks non-example hosts public in live mode', () => {
    expect(
      classifyMerchantHost('outfit-brand-1.example', SEED_DOMAINS, NEWCOMER_HOSTS, 'fake'),
    ).toBe('seed');
    expect(
      classifyMerchantHost('newcomer-setup.example', SEED_DOMAINS, NEWCOMER_HOSTS, 'live'),
    ).toBe('synthetic_example');
    expect(classifyMerchantHost('other-store.example', SEED_DOMAINS, NEWCOMER_HOSTS, 'live')).toBe(
      'rejected',
    );
    expect(classifyMerchantHost('public-outfit.shop', SEED_DOMAINS, NEWCOMER_HOSTS, 'live')).toBe(
      'public',
    );
    expect(classifyMerchantHost('public-outfit.shop', SEED_DOMAINS, NEWCOMER_HOSTS, 'fake')).toBe(
      'rejected',
    );
  });
});

describe.each([
  {
    domain: 'outfit' as const,
    url: PUBLIC_URLS.outfit,
    partner: 'mer_outfit_2',
    partnerEvidence: 'ev_outfit_2',
  },
  {
    domain: 'setup' as const,
    url: PUBLIC_URLS.setup,
    partner: 'mer_setup_2',
    partnerEvidence: 'ev_setup_2',
  },
])('S4 $domain live public merchant profiler', (c) => {
  it('profiles a bare domain as HTTPS by default and never fabricates a seed partner', async () => {
    const deps = liveProfileDeps(c.domain);
    const providers = defaultProviders(S4, { merchantProfile: deps });
    const spy = vi.spyOn(providers.merchantCatalog, 'profileMerchant');
    const app = createApp(S4, providers);
    const cookie = await session(app);
    const created = await profile(app, cookie, c.url.replace('https://', ''));
    expect(created.response.status).toBe(201);
    expect(created.profile?.sampleOrigin).toBe('live');
    expect(created.profile?.workspace).toBe('synthetic_demo');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe(c.url);
    expect(deps.lookup).toHaveBeenCalled();
    expect(deps.fetch).toHaveBeenCalled();

    const listed = await listOpportunities(app, cookie, created.profile!.merchant.id);
    expect(listed.list!.opportunities).toEqual([]);
    const catalog = await app.request(`/api/merchants/${created.profile!.merchant.id}/catalog`, {
      headers: { cookie },
    });
    expect(catalog.status).toBe(200);
    expect(await catalog.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: `Live ${c.domain === 'outfit' ? 'top' : 'desk'}` }),
      ]),
    );
    const otherCookie = await session(app);
    expect(
      (
        await app.request(`/api/merchants/${created.profile!.merchant.id}/catalog`, {
          headers: { cookie: otherCookie },
        })
      ).status,
    ).toBe(404);
  });

  it('reports disabled live analysis for a valid URL in fake mode without invoking L1', async () => {
    const deps = liveProfileDeps(c.domain);
    const app = createApp(FAKE, undefined, { merchantProfile: deps });
    const cookie = await session(app);
    const created = await profile(app, cookie, c.url);
    expect(created.response.status).toBe(503);
    expect(deps.lookup).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});

describe('S4 live merchant profiler failures', () => {
  it('reports an oversized page separately from an unreachable provider', async () => {
    const deps = liveProfileDeps('outfit', {
      fetch: async () =>
        new Response('page', {
          headers: { 'content-type': 'text/html', 'content-length': '2000001' },
        }),
    });
    const app = createApp(LIVE, undefined, { merchantProfile: deps });
    const cookie = await session(app);
    const created = await profile(app, cookie, PUBLIC_URLS.outfit);
    expect(created.response.status).toBe(422);
    expect(created.body).toMatchObject({ error: { code: 'MERCHANT_RESPONSE_TOO_LARGE' } });
  });

  it('reports the store HTTP status without exposing its response body', async () => {
    const deps = liveProfileDeps('outfit', {
      fetch: async () => new Response('private upstream details', { status: 403 }),
    });
    const app = createApp(LIVE, undefined, { merchantProfile: deps });
    const cookie = await session(app);
    const created = await profile(app, cookie, PUBLIC_URLS.outfit);
    expect(created.response.status).toBe(502);
    expect(created.body).toMatchObject({
      error: { code: 'MERCHANT_STORE_HTTP_ERROR', message: expect.stringContaining('HTTP 403') },
    });
    expect(JSON.stringify(created.body)).not.toContain('private upstream details');
  });
  it('constructs opt-in live mode without making a provider call', () => {
    expect(() => createApp(LIVE)).not.toThrow();
  });

  it('rejects syntax-unsafe URLs before L1 and leaves lookup uncalled', async () => {
    const deps = liveProfileDeps('outfit');
    const app = createApp(LIVE, undefined, { merchantProfile: deps });
    const cookie = await session(app);
    for (const url of [
      'http://public-outfit.shop/',
      'https://user:pass@public-outfit.shop/',
      'https://localhost/',
      'https://127.0.0.1/',
      'https://public-outfit.shop/?next=https://evil.test',
    ]) {
      expect((await profile(app, cookie, url)).response.status).toBe(400);
    }
    expect(deps.lookup).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('rejects unlisted .example hosts in live mode without a network call', async () => {
    const deps = liveProfileDeps('outfit');
    const app = createApp(LIVE, undefined, { merchantProfile: deps });
    const cookie = await session(app);
    expect((await profile(app, cookie, 'https://other-store.example/')).response.status).toBe(400);
    expect(deps.lookup).not.toHaveBeenCalled();
  });

  it('invokes L1 for a public-looking host whose DNS is private, then returns 400', async () => {
    const deps = liveProfileDeps('outfit', {
      lookupAddresses: [{ address: '10.0.0.8', family: 4 }],
    });
    const app = createApp(LIVE, undefined, { merchantProfile: deps });
    const cookie = await session(app);
    const created = await profile(app, cookie, PUBLIC_URLS.outfit);
    expect(created.response.status).toBe(400);
    expect(created.body).toEqual({
      error: { code: 'INVALID_REQUEST', message: 'Check the store URL and try again.' },
    });
    expect(deps.lookup).toHaveBeenCalled();
  });

  it('returns 422 when the live catalog is empty', async () => {
    const deps = liveProfileDeps('setup', { extractOffers: [] });
    const app = createApp(LIVE, undefined, { merchantProfile: deps });
    const cookie = await session(app);
    const created = await profile(app, cookie, PUBLIC_URLS.setup);
    expect(created.response.status).toBe(422);
    expect(created.body).toEqual({
      error: {
        code: 'CATALOG_UNAVAILABLE',
        message: 'This store catalog is not available for profiling.',
      },
    });
  });

  it('returns 504 when the live profile times out', async () => {
    const hanging = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        const fail = () =>
          reject(signal.reason ?? new DOMException('The operation was aborted.', 'TimeoutError'));
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail, { once: true });
      });
    });
    const deps = liveProfileDeps('outfit', { fetch: hanging as unknown as typeof fetch });
    const app = createApp(LIVE, undefined, {
      merchantProfile: deps,
      merchantProfileTimeoutMs: 40,
    });
    const cookie = await session(app);
    const created = await profile(app, cookie, PUBLIC_URLS.outfit);
    expect(created.response.status).toBe(504);
    expect(created.body).toEqual({
      error: { code: 'MERCHANT_TIMEOUT', message: 'Store profiling took too long. Try again.' },
    });
  });

  it('returns 502 for transport failures without leaking provider text', async () => {
    const deps = liveProfileDeps('setup', {
      fetch: vi.fn(async () => {
        throw new Error('ECONNRESET from upstream shop-api.internal');
      }),
    });
    const app = createApp(LIVE, undefined, { merchantProfile: deps });
    const cookie = await session(app);
    const created = await profile(app, cookie, PUBLIC_URLS.setup);
    expect(created.response.status).toBe(502);
    expect(JSON.stringify(created.body)).not.toMatch(/ECONNRESET|shop-api\.internal/);
    expect(created.body).toEqual({
      error: {
        code: 'MERCHANT_PROVIDER_ERROR',
        message: 'The catalog provider is unreachable. Try again.',
      },
    });
  });

  it('does not call L1 for seed URLs in live mode and keeps shopper search off the profiler', async () => {
    const deps = liveProfileDeps('outfit');
    const catalog = () => ({
      search: vi.fn(async () => {
        throw new Error('shopper search is not merchant profiling');
      }),
    });
    const app = createApp(LIVE, { catalog }, { merchantProfile: deps });
    expect(catalog()).not.toHaveProperty('profileMerchant');
    const cookie = await session(app);
    const created = await profile(app, cookie, SEED_URLS.outfit);
    expect(created.response.status).toBe(201);
    expect(created.profile?.sampleOrigin).toBe('seed');
    const newcomer = await profile(app, cookie, 'https://newcomer-outfit.example/');
    expect(newcomer.response.status).toBe(201);
    expect(newcomer.profile?.sampleOrigin).toBe('seed');
    expect(deps.lookup).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});
