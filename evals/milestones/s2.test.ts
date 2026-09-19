import { readFileSync } from 'node:fs';
import { CollectionMatchSchema, IntentBriefSchema, ProductOfferSchema } from '@sei/contracts';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../apps/server/src/app';
import { IntakeStore } from '../../apps/server/src/services/intake';

const fixture = (domain: string, file: string) =>
  JSON.parse(
    readFileSync(new URL(`../../fixtures/seed/${domain}/${file}.json`, import.meta.url), 'utf8'),
  );

describe('S2 confirmed-brief integration', () => {
  it.each(['outfit', 'setup'])(
    '%s matches actual fixture constraints through authorized routes',
    async (domain) => {
      const intake = new IntakeStore();
      const offers = ProductOfferSchema.array().parse(fixture(domain, 'offers'));
      const app = createApp(
        { MILESTONES: 's1,s2' },
        { intake, catalog: () => ({ search: async () => offers }) },
      );
      const cookie = (await app.request('/api/session')).headers.get('set-cookie')!.split(';')[0]!;
      const brief = IntentBriefSchema.parse({ ...fixture(domain, 'brief'), status: 'confirmed' });
      intake.saveBrief(cookie.split('=')[1]!, brief, null);
      const response = await app.request(`/api/briefs/${brief.id}/search`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ revision: brief.revision }),
      });
      expect(response.status).toBe(202);
      const { runId } = (await response.json()) as { runId: string };
      let result: { collection: { match: unknown }; offers: unknown[] } | undefined;
      await expect
        .poll(async () => {
          const state = (await (
            await app.request(`/api/search/${runId}`, { headers: { cookie } })
          ).json()) as {
            events: { type: string; result?: typeof result }[];
          };
          result = state.events.find((event) => event.type === 'result')?.result;
          return !!result;
        })
        .toBe(true);
      expect(result!.offers.length).toBeGreaterThan(0);
      const match = CollectionMatchSchema.parse(result!.collection.match);
      expect(match.briefRevision).toBe(brief.revision);
      expect(match.slots.some((slot) => slot.selectedOfferId !== null)).toBe(true);
      for (const slot of match.slots.filter((slot) => slot.selectedOfferId !== null)) {
        expect(slot.checks.every((check) => check.status === 'pass')).toBe(true);
        expect(offers.some((offer) => offer.id === slot.selectedOfferId)).toBe(true);
      }
      expect((await app.request(`/api/search/${runId}`)).status).toBe(404);
      intake.saveBrief(
        cookie.split('=')[1]!,
        { ...brief, revision: brief.revision + 1, status: 'draft' },
        brief.revision,
      );
      expect((await app.request(`/api/search/${runId}`, { headers: { cookie } })).status).toBe(409);
    },
  );
});
