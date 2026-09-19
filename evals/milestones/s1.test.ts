import { IntentBriefSchema } from '@sei/contracts';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../apps/server/src/app';

async function owner(app: ReturnType<typeof createApp>): Promise<string> {
  return (await app.request('/api/session')).headers.get('set-cookie')?.split(';')[0] ?? '';
}

describe('S1 confirmation and privacy gate', () => {
  it.each([
    ['outfit', 'A layered neutral outfit with a rain-ready outer layer'],
    ['setup', 'A narrow work setup with warm light and no wall drilling'],
  ] as const)('%s reaches a draft but never auto-confirms', async (domain, text) => {
    const app = createApp({ MILESTONES: 's1' });
    const cookie = await owner(app);
    const response = await app.request('/api/briefs', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ domain, text }),
    });
    const brief = IntentBriefSchema.parse(await response.json());
    expect(brief.domain).toBe(domain);
    expect(brief.status).toBe('draft');
    expect(brief.slots.some((slot) => slot.required)).toBe(true);
  });

  it('keeps one owner from reading another owner brief', async () => {
    const app = createApp({ MILESTONES: 's1' });
    const first = await owner(app);
    const second = await owner(app);
    const brief = IntentBriefSchema.parse(
      await (
        await app.request('/api/briefs', {
          method: 'POST',
          headers: { cookie: first, 'content-type': 'application/json' },
          body: JSON.stringify({ domain: 'outfit', text: 'A complete monochrome travel outfit' }),
        })
      ).json(),
    );
    expect(
      (await app.request(`/api/briefs/${brief.id}`, { headers: { cookie: second } })).status,
    ).toBe(404);
  });
});
