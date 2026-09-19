import { InspirationAssetSchema, IntentBriefSchema } from '@sei/contracts';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { type ImageNormalizer, IntakeStore } from '../src/services/intake';

async function session(app: ReturnType<typeof createApp>): Promise<string> {
  const response = await app.request('/api/session');
  return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}

const headers = (cookie: string) => ({ cookie, 'Content-Type': 'application/json' });

describe('S1 private intake API', () => {
  it.each([
    ['outfit', 'A relaxed olive overshirt outfit with practical layers'],
    ['setup', 'A warm compact writing desk setup with focused lighting'],
  ] as const)(
    'creates an editable %s draft and confirms only after review',
    async (domain, text) => {
      const app = createApp({ MILESTONES: 's1' });
      const cookie = await session(app);
      const createdResponse = await app.request('/api/briefs', {
        method: 'POST',
        headers: headers(cookie),
        body: JSON.stringify({ domain, text, country: 'CA', currency: 'CAD' }),
      });
      expect(createdResponse.status).toBe(201);
      const created = IntentBriefSchema.parse(await createdResponse.json());
      expect(created.status).toBe('draft');
      expect(created.domain).toBe(domain);
      expect(created.slots).toHaveLength(3);
      const confirmedResponse = await app.request(`/api/briefs/${created.id}`, {
        method: 'PATCH',
        headers: headers(cookie),
        body: JSON.stringify({
          expectedRevision: 1,
          status: 'confirmed',
          slots: created.slots,
          country: created.country,
          currency: created.currency,
          itemBudget: null,
        }),
      });
      expect(confirmedResponse.status).toBe(200);
      expect(IntentBriefSchema.parse(await confirmedResponse.json())).toMatchObject({
        status: 'confirmed',
        revision: 2,
      });
    },
  );

  it('enforces owner boundaries, same-origin writes, and compare-and-set revisions', async () => {
    const app = createApp({ MILESTONES: 's1' });
    const owner = await session(app);
    const stranger = await session(app);
    const created = IntentBriefSchema.parse(
      await (
        await app.request('/api/briefs', {
          method: 'POST',
          headers: headers(owner),
          body: JSON.stringify({
            domain: 'outfit',
            text: 'A tonal travel outfit with a structured jacket',
          }),
        })
      ).json(),
    );
    expect(
      (
        await app.request(`/api/briefs/${created.id}`, {
          headers: { cookie: stranger },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request('/api/briefs', {
          method: 'POST',
          headers: { ...headers(owner), origin: 'https://wrong.example' },
          body: JSON.stringify({ domain: 'outfit', text: 'Another complete outfit description' }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request('/api/briefs', {
          method: 'POST',
          headers: {
            ...headers(owner),
            origin: 'http://localhost:5173',
            'x-forwarded-host': 'localhost:5173',
          },
          body: JSON.stringify({
            domain: 'outfit',
            text: 'A proxy safe complete outfit description',
          }),
        })
      ).status,
    ).toBe(201);
    const update = {
      expectedRevision: 1,
      status: 'draft',
      slots: created.slots,
      country: created.country,
      currency: created.currency,
      itemBudget: null,
    };
    expect(
      (
        await app.request(`/api/briefs/${created.id}`, {
          method: 'PATCH',
          headers: headers(owner),
          body: JSON.stringify(update),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/briefs/${created.id}`, {
          method: 'PATCH',
          headers: headers(owner),
          body: JSON.stringify(update),
        })
      ).status,
    ).toBe(409);
  });

  it('fails closed for unsupported, oversized, malformed, expired, and cross-owner assets', async () => {
    let now = new Date('2026-09-19T12:00:00Z');
    const normalizer: ImageNormalizer = {
      async normalize(bytes, mimeType) {
        if (bytes[0] === 0) throw new Error('malformed');
        return { bytes: new Uint8Array([1, 2, 3]), mimeType: mimeType as 'image/png' };
      },
    };
    const intake = new IntakeStore();
    const app = createApp(
      { MILESTONES: 's1' },
      { imageNormalizer: normalizer, intake, now: () => now },
    );
    const owner = await session(app);
    const stranger = await session(app);
    const upload = async (file: File) => {
      const form = new FormData();
      form.set('image', file);
      return app.request('/api/assets', { method: 'POST', headers: { cookie: owner }, body: form });
    };
    expect((await upload(new File(['x'], 'bad.svg', { type: 'image/svg+xml' }))).status).toBe(415);
    expect(
      (
        await app.request('/api/assets', {
          method: 'POST',
          headers: { cookie: owner, 'content-length': String(9 * 1024 * 1024) },
        })
      ).status,
    ).toBe(413);
    expect(
      (await upload(new File([new Uint8Array([0])], 'bad.png', { type: 'image/png' }))).status,
    ).toBe(415);
    const createdResponse = await upload(
      new File([new Uint8Array([137, 80, 78, 71])], 'safe.png', { type: 'image/png' }),
    );
    expect(createdResponse.status).toBe(201);
    const asset = InspirationAssetSchema.parse(await createdResponse.json());
    expect(
      (await app.request(`/api/assets/${asset.id}`, { headers: { cookie: stranger } })).status,
    ).toBe(404);
    expect(
      (await app.request(`/api/assets/${asset.id}`, { headers: { cookie: owner } })).status,
    ).toBe(200);
    now = new Date('2026-09-20T12:00:01Z');
    expect(
      (await app.request(`/api/assets/${asset.id}`, { headers: { cookie: owner } })).status,
    ).toBe(404);
  });

  it('deletes all owner intake data and revokes the session', async () => {
    const app = createApp({ MILESTONES: 's1' });
    const cookie = await session(app);
    const brief = IntentBriefSchema.parse(
      await (
        await app.request('/api/briefs', {
          method: 'POST',
          headers: headers(cookie),
          body: JSON.stringify({
            domain: 'setup',
            text: 'A compact reading setup with warm task light',
          }),
        })
      ).json(),
    );
    expect(
      (await app.request('/api/session', { method: 'DELETE', headers: { cookie } })).status,
    ).toBe(200);
    expect((await app.request(`/api/briefs/${brief.id}`, { headers: { cookie } })).status).toBe(
      404,
    );
  });
});
