import { MerchantResearchSchema, MerchantWorkspaceProfileSchema } from '@sei/contracts';
import { expect, it, vi } from 'vitest';
import { createApp } from '../src/app';

const S4 = { MILESTONES: 's1,s2,s3,s4' };
it.each(['outfit', 'setup'])('research is owner-scoped and S4-gated: %s', async (domain) => {
  const app = createApp(S4);
  const cookie = (await app.request('/api/session')).headers.get('set-cookie')!.split(';')[0]!;
  const headers = { cookie, 'Content-Type': 'application/json' };
  const profile = MerchantWorkspaceProfileSchema.parse(
    await (
      await app.request('/api/merchants/profile', {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: `https://${domain}-brand-1.example/` }),
      })
    ).json(),
  );
  const path = `/api/merchants/${profile.merchant.id}/research`;
  const post = {
    method: 'POST',
    headers,
    body: JSON.stringify({ country: 'CA', currency: 'CAD' }),
  };
  const response = await app.request(path, post);
  expect(response.status).toBe(200);
  const report = MerchantResearchSchema.parse(await response.json());
  expect(report.merchantId).toBe(profile.merchant.id);
  expect(report.partners.length).toBeGreaterThan(0);
  expect(JSON.stringify(report)).not.toMatch(/sessionId|brief_|asset_|evt_/);
  const stranger = (await app.request('/api/session')).headers.get('set-cookie')!.split(';')[0]!;
  expect(
    (await app.request(path, { ...post, headers: { ...headers, cookie: stranger } })).status,
  ).toBe(404);
  expect(
    (await app.request(path, { ...post, headers: { 'Content-Type': 'application/json' } })).status,
  ).toBe(401);
  const research = vi.fn();
  const disabled = createApp({ MILESTONES: 's1,s2,s3' }, { merchantResearch: { research } });
  expect((await disabled.request(path, post)).status).toBe(404);
  expect(research).not.toHaveBeenCalled();
});
