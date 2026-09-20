/** Offline full-loop gate: live provenance is simulated only inside injected test adapters. */
import { readFileSync } from 'node:fs';
import { createInjectedShoppingCatalog } from '@sei/collect';
import {
  CollaborationDraftSchema,
  IntentBriefSchema,
  MerchantProfileSchema,
  MerchantRunSchema,
  newId,
  ProductOfferSchema,
} from '@sei/contracts';
import { createOpportunityMapper } from '@sei/enrich';
import { createCollaborationComposer } from '@sei/reason';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../apps/server/src/app';
import { defaultProviders } from '../../apps/server/src/providers';
import { MerchantWorkspaceService } from '../../apps/server/src/services/merchant';

const env = { MILESTONES: 's1,s2,s3,s4' };
const headers = (cookie: string) => ({ cookie, 'content-type': 'application/json' });
describe.each(['outfit', 'setup'] as const)('S4 %s shopper-to-merchant loop', (domain) => {
  it('uses actual validated choices, denies unowned access, and invalidates a draft on withdrawal', async () => {
    const read = (name: string) =>
      JSON.parse(
        readFileSync(
          new URL(`../../fixtures/seed/${domain}/${name}.json`, import.meta.url),
          'utf8',
        ),
      );
    const template = IntentBriefSchema.parse(read('brief'));
    const offers = z
      .array(ProductOfferSchema)
      .parse(read('offers'))
      .map((offer) => ({ ...offer, sampleOrigin: 'live' as const }));
    const now = () => new Date('2026-09-19T12:01:00Z');
    const base = defaultProviders(env, {
      overrides: {
        now,
        catalog: createInjectedShoppingCatalog({ offers, sampleOrigin: 'live' }),
        intent: {
          createDraft: async () => ({
            ...template,
            id: newId('brief_'),
            status: 'draft',
            sampleOrigin: 'live',
            createdAt: now().toISOString(),
          }),
        },
      },
    });
    const merchants = new MerchantWorkspaceService({
      profiler: {
        origin: 'live',
        profile: async ({ url }) => {
          const host = new URL(url).hostname;
          const items =
            host === 'newcomer.example'
              ? [
                  {
                    ...offers[0],
                    id: 'offer_newcomer',
                    merchant: { id: 'mer_newcomer', name: 'Newcomer', domain: host },
                  },
                ]
              : offers.filter((offer) => offer.merchant.domain === host);
          return MerchantProfileSchema.parse({
            id: newId('prof_'),
            merchant: items[0].merchant,
            domain,
            offers: items,
            confirmed: false,
            capturedAt: now().toISOString(),
            sampleOrigin: 'live',
            warnings: [],
          });
        },
      },
      composer: createCollaborationComposer(),
      mapper: createOpportunityMapper(),
      projection: base.demandProjection,
      ledger: base.demand,
      sessions: base.sessions,
      now,
    });
    const app = createApp(env, { ...base, merchants });
    const session = async () =>
      (await app.request('/api/session')).headers.get('set-cookie')!.split(';')[0];
    const shoppers: string[] = [];
    for (let i = 0; i < 5; i++) {
      const cookie = await session();
      shoppers.push(cookie);
      const draft = IntentBriefSchema.parse(
        await (
          await app.request('/api/briefs', {
            method: 'POST',
            headers: headers(cookie),
            body: JSON.stringify({
              domain,
              text: 'Private shopper text never visible to merchants',
              country: 'CA',
              currency: 'CAD',
            }),
          })
        ).json(),
      );
      const confirmed = IntentBriefSchema.parse(
        await (
          await app.request(`/api/briefs/${draft.id}`, {
            method: 'PATCH',
            headers: headers(cookie),
            body: JSON.stringify({
              expectedRevision: draft.revision,
              status: 'confirmed',
              slots: draft.slots,
              country: draft.country,
              currency: draft.currency,
              itemBudget: null,
            }),
          })
        ).json(),
      );
      await app.request('/api/consent', {
        method: 'PUT',
        headers: headers(cookie),
        body: JSON.stringify({ state: 'granted', expectedVersion: null }),
      });
      const started = (await (
        await app.request(`/api/briefs/${confirmed.id}/matches`, {
          method: 'POST',
          headers: headers(cookie),
          body: '{}',
        })
      ).json()) as { runId: string };
      let match: {
        id: string;
        slots: { slotId: string; selectedOfferId: string | null }[];
      } | null = null;
      await expect
        .poll(async () => {
          const run = (await (
            await app.request(`/api/runs/${started.runId}`, { headers: { cookie } })
          ).json()) as { result?: { collection: { match: typeof match } } };
          match = run.result?.collection.match ?? null;
          return match?.id;
        })
        .toMatch(/^match_/);
      const selections = match!.slots.flatMap((slot) =>
        slot.selectedOfferId ? [{ slotId: slot.slotId, offerId: slot.selectedOfferId }] : [],
      );
      expect(selections).toHaveLength(2);
      const response = await app.request(`/api/briefs/${confirmed.id}/decisions`, {
        method: 'POST',
        headers: headers(cookie),
        body: JSON.stringify({
          idempotencyKey: `merchant-loop-save-${i}`,
          briefRevision: confirmed.revision,
          runId: started.runId,
          matchId: match!.id,
          kind: 'collection_saved',
          selections,
          rejectionReason: null,
        }),
      });
      expect(response.status).toBe(201);
    }
    const merchantCookie = await session();
    const profileStore = async (store: string) => {
      const started = MerchantRunSchema.parse(
        await (
          await app.request('/api/merchants/profile', {
            method: 'POST',
            headers: headers(merchantCookie),
            body: JSON.stringify({ url: `https://${store}`, domain }),
          })
        ).json(),
      );
      let profile: ReturnType<typeof MerchantProfileSchema.parse> | null = null;
      await expect
        .poll(async () => {
          const run = MerchantRunSchema.parse(
            await (
              await app.request(`/api/merchants/runs/${started.id}`, {
                headers: { cookie: merchantCookie },
              })
            ).json(),
          );
          profile = run.profile;
          return run.status;
        })
        .toBe('ready');
      const response = await app.request(`/api/merchants/profiles/${profile!.id}/confirm`, {
        method: 'POST',
        headers: headers(merchantCookie),
        body: JSON.stringify({
          categories: profile!.offers.map((offer) => ({
            offerId: offer.id,
            category: offer.category,
          })),
        }),
      });
      expect(response.status).toBe(200);
      return profile!;
    };
    const primary = await profileStore(offers[0].merchant.domain);
    const partner = await profileStore(offers[1].merchant.domain);
    const newcomer = await profileStore('newcomer.example');
    const newcomerComparison = (await (
      await app.request(`/api/merchants/${newcomer.id}/opportunities`, {
        headers: { cookie: merchantCookie },
      })
    ).json()) as { opportunities: { basis: string; observedPairSupport: unknown }[] };
    expect(newcomerComparison.opportunities.length).toBeGreaterThan(0);
    expect(
      newcomerComparison.opportunities.every(
        (item) => item.basis === 'inferred_supply_fit' && item.observedPairSupport === null,
      ),
    ).toBe(true);
    expect(
      (
        await app.request(`/api/merchants/${partner.id}/opportunities`, {
          headers: { cookie: merchantCookie },
        })
      ).status,
    ).toBe(200);
    const response = await app.request(`/api/merchants/${primary.id}/opportunities`, {
      headers: { cookie: merchantCookie },
    });
    const comparison = (await response.json()) as {
      opportunities: { id: string; basis: string }[];
    };
    expect(comparison.opportunities[0].basis).toBe('observed_pair');
    expect(JSON.stringify(comparison)).not.toMatch(/sessionId|briefId|eventId|Private shopper/);
    const draft = CollaborationDraftSchema.parse(
      await (
        await app.request(`/api/opportunities/${comparison.opportunities[0].id}/drafts`, {
          method: 'POST',
          headers: { cookie: merchantCookie },
        })
      ).json(),
    );
    expect(draft.opportunity.observedPairSupport).toEqual({ min: 5, max: 10 });
    await app.request('/api/consent', {
      method: 'PUT',
      headers: headers(shoppers[0]),
      body: JSON.stringify({ state: 'withdrawn', expectedVersion: 1 }),
    });
    expect(
      (await app.request(`/api/drafts/${draft.id}`, { headers: { cookie: merchantCookie } }))
        .status,
    ).toBe(409);
    const refreshed = (await (
      await app.request(`/api/merchants/${primary.id}/opportunities`, {
        headers: { cookie: merchantCookie },
      })
    ).json()) as { opportunities: unknown[] };
    expect(refreshed.opportunities).toEqual([]);
  });
});
