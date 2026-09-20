import { readFileSync } from 'node:fs';
import {
  IntentBriefSchema,
  MerchantDemandSummarySchema,
  MerchantResearchSchema,
  MerchantWorkspaceProfileSchema,
} from '@sei/contracts';
import { VisionDraftSchema } from '@sei/reason';
import { expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { createDemoProviders, DEMO_ENV } from '../src/demo/providers';

it('runs recorded Shopify products through image intake, approval, pair publication and withdrawal without live calls', async () => {
  const draft = VisionDraftSchema.parse(
    JSON.parse(
      readFileSync(new URL('../../../demo/vision-recording.json', import.meta.url), 'utf8'),
    ).draft,
  );
  const model = { draft: vi.fn(async () => draft) };
  const { providers } = await createDemoProviders('unused', 'offline', {
    intentModel: model,
    inMemory: true,
  });
  providers.imageNormalizer = { normalize: async (bytes) => ({ bytes, mimeType: 'image/png' }) };
  const app = createApp(DEMO_ENV, providers);
  const cookie = (await app.request('/api/session')).headers.get('set-cookie')!.split(';')[0]!;
  const owner = cookie.split('=')[1]!;
  const call = (path: string, method = 'GET', body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: { cookie, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const form = new FormData();
  form.set('image', new File(['offline image fixture'], 'demo.png', { type: 'image/png' }));
  const upload = await app.request('/api/assets', {
    method: 'POST',
    headers: { cookie },
    body: form,
  });
  expect(upload.status).toBe(201);
  const asset = (await upload.json()) as { id: string };
  let brief = IntentBriefSchema.parse(
    await (
      await call('/briefs', 'POST', {
        domain: 'outfit',
        assetId: asset.id,
        country: 'US',
        currency: 'USD',
      })
    ).json(),
  );
  expect(model.draft).toHaveBeenCalledOnce();
  expect(brief.sampleOrigin).toBe('replay');
  const profile = MerchantWorkspaceProfileSchema.parse(
    await (await call('/merchants/profile', 'POST', { url: 'https://www.allbirds.com/' })).json(),
  );
  expect(profile.sampleOrigin).toBe('replay');
  const demandPath = `/merchants/${profile.merchant.id}/demand`;
  expect(await (await call(demandPath)).json()).toEqual([]);
  brief = IntentBriefSchema.parse(
    await (
      await call(`/briefs/${brief.id}`, 'PATCH', {
        expectedRevision: brief.revision,
        status: 'confirmed',
        slots: brief.slots,
        country: brief.country,
        currency: brief.currency,
        itemBudget: null,
      })
    ).json(),
  );
  expect((await call('/consent', 'PUT', { state: 'granted', expectedVersion: null })).status).toBe(
    200,
  );
  const { runId } = (await (await call(`/briefs/${brief.id}/matches`, 'POST', {})).json()) as {
    runId: string;
  };
  await vi.waitFor(() => expect(providers.runs.get(owner, runId)?.done).toBe(true));
  const result = providers.runs.get(owner, runId)!.result!;
  const match = result.collection!.match;
  const selections = match.slots.map((slot) => ({
    slotId: slot.slotId,
    offerId: slot.selectedOfferId!,
  }));
  expect(selections.every((s) => s.offerId)).toBe(true);
  const decision = {
    idempotencyKey: 'demo-test-saved',
    briefRevision: brief.revision,
    runId,
    matchId: match.id,
    kind: 'collection_saved',
    selections,
    rejectionReason: null,
  };
  expect((await call(`/briefs/${brief.id}/decisions`, 'POST', decision)).status).toBe(201);
  const summaries = MerchantDemandSummarySchema.array().parse(
    await (await call(demandPath)).json(),
  );
  expect(summaries[0]?.sampleOrigin).toBe('replay');
  expect(summaries[0]?.pairSupport?.some((p) => p.merchantIds.includes(profile.merchant.id))).toBe(
    true,
  );
  expect(JSON.stringify(summaries)).not.toMatch(/sess_|asset_|brief_|evt_/);
  expect(await providers.demandProjection.refresh('live')).toEqual([]);
  const report = MerchantResearchSchema.parse(
    await (
      await call(`/merchants/${profile.merchant.id}/research`, 'POST', {
        country: 'US',
        currency: 'USD',
      })
    ).json(),
  );
  expect(report.bundles.length).toBeGreaterThanOrEqual(3);
  expect(report.partners.length).toBeGreaterThanOrEqual(3);
  expect(report.competitors.length).toBeGreaterThanOrEqual(3);
  expect(report.sampleOrigin).toBe('replay');
  expect((await call('/consent', 'PUT', { state: 'withdrawn', expectedVersion: 1 })).status).toBe(
    200,
  );
  expect(await (await call(demandPath)).json()).toEqual([]);
});
