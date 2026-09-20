/**
 * S4 gate: fixture-backed merchant workspace in both domains, plus newcomer inferred fit.
 * Seed opportunities stay synthetic; S3 snapshots never become merchant evidence.
 */
import {
  CapabilitiesSchema,
  type IntentBrief,
  IntentBriefSchema,
  MerchantCollaborationDraftSchema,
  MerchantOpportunityListSchema,
  MerchantOpportunitySchema,
  MerchantWorkspaceProfileSchema,
  type ShoppingDomain,
} from '@sei/contracts';
import type { CollectionRunResult } from '@sei/pipeline';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../apps/server/src/app';
import { PrivateDemandLedger } from '../../apps/server/src/services/demand';

type App = ReturnType<typeof createApp>;
const S4 = { MILESTONES: 's1,s2,s3,s4' };

const CASES = [
  {
    domain: 'outfit' as const satisfies ShoppingDomain,
    text: 'A relaxed neutral outfit with a structured bag',
    slot: 'top',
    constraint: { kind: 'size', value: 'M' },
    storeUrl: 'https://outfit-brand-1.example/',
    opportunityId: 'opp_outfit_1',
  },
  {
    domain: 'setup' as const satisfies ShoppingDomain,
    text: 'A compact desk setup with warm lighting',
    slot: 'desk',
    constraint: { kind: 'dimension', axis: 'width', maxCm: 120 },
    storeUrl: 'https://setup-brand-1.example/',
    opportunityId: 'opp_setup_1',
  },
];

const json = (cookie: string, extra: Record<string, string> = {}) => ({
  cookie,
  'Content-Type': 'application/json',
  ...extra,
});
const session = async (app: App) =>
  (await app.request('/api/session')).headers.get('set-cookie')?.split(';')[0] ?? '';

function assertNoPrivateIds(value: unknown): void {
  const text = JSON.stringify(value);
  expect(text).not.toMatch(/sess_|evt_|asset_|run_|brief_/);
  expect(text).not.toMatch(/"eligibleSessions":\s*\d/);
}

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

describe.each(CASES)('S4 $domain shopper-to-merchant loop', (c) => {
  it('keeps the shopper path intact and serves seed merchant evidence, not live snapshots', async () => {
    const demand = new PrivateDemandLedger();
    const readSnapshot = vi.spyOn(demand, 'readSnapshot');
    const app = createApp(S4, { demand });
    const cookie = await session(app);
    const brief = await confirm(app, cookie, c);
    const { runId, result } = await search(app, cookie, brief.id);
    const match = result.collection!.match;
    const selections = match.slots
      .filter((slot) => slot.selectedOfferId)
      .map((slot) => ({ slotId: slot.slotId, offerId: slot.selectedOfferId as string }));
    expect(
      (
        await app.request(`/api/briefs/${brief.id}/decisions`, {
          method: 'POST',
          headers: json(cookie, { 'Idempotency-Key': `save-${c.domain}` }),
          body: JSON.stringify({
            idempotencyKey: `save-${c.domain}`,
            kind: 'collection_saved',
            runId,
            matchId: match.id,
            selections,
            briefRevision: brief.revision,
            rejectionReason: null,
          }),
        })
      ).status,
    ).toBe(201);

    readSnapshot.mockClear();
    const profiled = MerchantWorkspaceProfileSchema.parse(
      await (
        await app.request('/api/merchants/profile', {
          method: 'POST',
          headers: json(cookie),
          body: JSON.stringify({ url: c.storeUrl }),
        })
      ).json(),
    );
    expect(profiled.workspace).toBe('synthetic_demo');
    const listed = MerchantOpportunityListSchema.parse(
      await (
        await app.request(`/api/merchants/${profiled.merchant.id}/opportunities`, {
          headers: { cookie },
        })
      ).json(),
    );
    const opportunity = MerchantOpportunitySchema.parse(listed.opportunities[0]);
    expect(opportunity.id).toBe(c.opportunityId);
    expect(opportunity.basis).toBe('observed_pair');
    expect(opportunity.demand.sampleOrigin).toBe('seed');
    expect(opportunity.demand.eligibleSessions).toEqual({ min: 5, max: 9 });
    assertNoPrivateIds(opportunity);

    const draft = MerchantCollaborationDraftSchema.parse(
      await (
        await app.request(
          `/api/merchants/${profiled.merchant.id}/opportunities/${opportunity.id}/drafts`,
          { method: 'POST', headers: json(cookie), body: '{}' },
        )
      ).json(),
    );
    const patched = MerchantCollaborationDraftSchema.parse(
      await (
        await app.request(`/api/drafts/${draft.id}`, {
          method: 'PATCH',
          headers: json(cookie),
          body: JSON.stringify({
            expectedVersion: 1,
            proposalText: 'Labeled synthetic collaboration draft',
            uncertainties: ['Willingness and economics remain unknown'],
          }),
        })
      ).json(),
    );
    expect(patched.version).toBe(2);
    expect(readSnapshot).not.toHaveBeenCalled();
  });
});

describe.each([
  {
    domain: 'outfit' as const,
    host: 'newcomer-outfit.example',
    partner: 'mer_outfit_2',
  },
  {
    domain: 'setup' as const,
    host: 'newcomer-setup.example',
    partner: 'mer_setup_2',
  },
])('S4 $domain newcomer attribution', (c) => {
  it('labels inferred supply fit and does not copy observed pair support', async () => {
    const app = createApp(S4);
    const cookie = await session(app);
    const profiled = MerchantWorkspaceProfileSchema.parse(
      await (
        await app.request('/api/merchants/profile', {
          method: 'POST',
          headers: json(cookie),
          body: JSON.stringify({ url: `https://${c.host}/` }),
        })
      ).json(),
    );
    const listed = MerchantOpportunityListSchema.parse(
      await (
        await app.request(`/api/merchants/${profiled.merchant.id}/opportunities`, {
          headers: { cookie },
        })
      ).json(),
    );
    const opportunity = MerchantOpportunitySchema.parse(listed.opportunities[0]);
    expect(opportunity.basis).toBe('inferred_supply_fit');
    expect(opportunity.observedPairSupport).toBeNull();
    expect(opportunity.merchants[1]?.id).toBe(c.partner);
    expect(opportunity.productEvidenceIds.length).toBeGreaterThan(1);
    assertNoPrivateIds(opportunity);
  });
});

describe.each([
  {
    domain: 'outfit' as const,
    url: 'https://public-outfit.shop/collections/all',
    category: 'top',
    host: 'public-outfit.shop',
    partner: 'mer_outfit_2',
  },
  {
    domain: 'setup' as const,
    url: 'https://public-setup.shop/collections/all',
    category: 'desk',
    host: 'public-setup.shop',
    partner: 'mer_setup_2',
  },
])('S4 $domain live public catalog is not live demand', (c) => {
  it('keeps inferred seed demand when the catalog profile is live', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    const fetch = vi.fn(
      async () =>
        new Response('<html><body>public catalog</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    );
    const extractOffers = vi.fn(() => [
      {
        merchant: { name: `Live ${c.domain} shop`, domain: c.host },
        productId: `product-${c.category}`,
        variantId: `variant-${c.category}-1`,
        title: `Live ${c.category}`,
        category: c.category,
        productUrl: `https://${c.host}/products/${c.category}`,
        imageUrl: null,
        price: { amount: 4500, currency: 'CAD' },
        availability: 'available' as const,
        shipsTo: ['CA'],
        attributes: {},
        evidenceMethod: 'fetch' as const,
      },
    ]);
    const app = createApp({ ...S4, MERCHANT_CATALOG_PROVIDER: 'live' }, undefined, {
      merchantProfile: { lookup, fetch, extractOffers },
    });
    const cookie = await session(app);
    const profiled = MerchantWorkspaceProfileSchema.parse(
      await (
        await app.request('/api/merchants/profile', {
          method: 'POST',
          headers: json(cookie),
          body: JSON.stringify({ url: c.url }),
        })
      ).json(),
    );
    expect(profiled.sampleOrigin).toBe('live');
    expect(profiled.workspace).toBe('synthetic_demo');
    const listed = MerchantOpportunityListSchema.parse(
      await (
        await app.request(`/api/merchants/${profiled.merchant.id}/opportunities`, {
          headers: { cookie },
        })
      ).json(),
    );
    const opportunity = MerchantOpportunitySchema.parse(listed.opportunities[0]);
    expect(opportunity.basis).toBe('inferred_supply_fit');
    expect(opportunity.observedPairSupport).toBeNull();
    expect(opportunity.demand.sampleOrigin).toBe('seed');
    expect(opportunity.merchants[1]?.id).toBe(c.partner);
    const draft = MerchantCollaborationDraftSchema.parse(
      await (
        await app.request(
          `/api/merchants/${profiled.merchant.id}/opportunities/${opportunity.id}/drafts`,
          { method: 'POST', headers: json(cookie), body: '{}' },
        )
      ).json(),
    );
    expect(draft.sampleOrigin).toBe('seed');
    expect(lookup).toHaveBeenCalled();
    assertNoPrivateIds(opportunity);
  });
});

describe('S4 flag surface', () => {
  it('advertises opportunities only when S4 is enabled', async () => {
    const enabled = CapabilitiesSchema.parse(
      await (await createApp(S4).request('/api/capabilities')).json(),
    );
    expect(enabled).toMatchObject({
      sections: expect.arrayContaining(['opportunities']),
      flags: expect.objectContaining({ FEATURE_MERCHANT_OPPORTUNITIES: true }),
    });
    const disabled = CapabilitiesSchema.parse(
      await (await createApp({ MILESTONES: 's1,s2,s3' }).request('/api/capabilities')).json(),
    );
    expect(disabled.flags.FEATURE_MERCHANT_OPPORTUNITIES).toBe(false);
    expect(disabled.sections).not.toContain('opportunities');
  });
});
