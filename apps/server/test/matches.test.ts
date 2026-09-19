import { readFileSync } from 'node:fs';
import { IntentBriefSchema, ProductOfferSchema } from '@sei/contracts';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { IntakeStore } from '../src/services/intake';

const fixture = (domain: string, name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../fixtures/seed/${domain}/${name}.json`, import.meta.url), 'utf8'),
  );
async function owner(app: ReturnType<typeof createApp>) {
  return (await app.request('/api/session')).headers.get('set-cookie')!.split(';')[0]!;
}
describe('collection API', () => {
  it.each(['outfit', 'setup'])(
    'runs confirmed %s and protects ownership and revisions',
    async (domain) => {
      const intake = new IntakeStore();
      const offers = fixture(domain, 'offers').map((o: unknown) => ProductOfferSchema.parse(o));
      const app = createApp(
        { MILESTONES: 's1,s2' },
        { intake, catalog: () => ({ search: async () => offers }) },
      );
      const cookie = await owner(app);
      const ownerId = cookie.split('=')[1]!;
      const brief = IntentBriefSchema.parse({ ...fixture(domain, 'brief'), status: 'draft' });
      intake.saveBrief(ownerId, brief, null);
      const start = () =>
        app.request(`/api/briefs/${brief.id}/search`, {
          method: 'POST',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: brief.revision }),
        });
      expect((await start()).status).toBe(409);
      intake.saveBrief(ownerId, { ...brief, status: 'confirmed' }, brief.revision);
      const response = await start();
      expect(response.status).toBe(202);
      const { runId } = (await response.json()) as { runId: string };
      const stranger = await owner(app);
      expect(
        (await app.request(`/api/search/${runId}`, { headers: { cookie: stranger } })).status,
      ).toBe(404);
      await expect
        .poll(async () => {
          const state = (await (
            await app.request(`/api/search/${runId}`, { headers: { cookie } })
          ).json()) as { events: { type: string }[] };
          return state.events.some((e) => e.type === 'result');
        })
        .toBe(true);
      const state = (await (
        await app.request(`/api/search/${runId}`, { headers: { cookie } })
      ).json()) as { events: { type: string; result?: { offers: unknown[] } }[] };
      expect(state.events.find((e) => e.type === 'result')?.result?.offers.length).toBeGreaterThan(
        0,
      );
      intake.saveBrief(ownerId, { ...brief, revision: brief.revision + 1 }, brief.revision);
      expect((await app.request(`/api/search/${runId}`, { headers: { cookie } })).status).toBe(409);
    },
  );
  it('does not mount matching when disabled', async () => {
    expect(
      (
        await createApp({ MILESTONES: 's1' }).request('/api/briefs/unknown/search', {
          method: 'POST',
        })
      ).status,
    ).toBe(404);
  });
});
