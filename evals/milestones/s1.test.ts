import { crc32, deflateSync } from 'node:zlib';
import { InspirationAssetSchema, IntentBriefSchema } from '@sei/contracts';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../apps/server/src/app';

/** A structurally valid 2x2 PNG carrying a metadata chunk that intake must strip. */
const METADATA = 'camera-serial-private';
function pngWithMetadata(): Uint8Array {
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  const chunk = (type: string, data: Buffer) => {
    const name = Buffer.from(type, 'latin1');
    return Buffer.concat([u32(data.length), name, data, u32(crc32(Buffer.concat([name, data])))]);
  };
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', Buffer.concat([u32(2), u32(2), Buffer.from([8, 2, 0, 0, 0])])),
      chunk('tEXt', Buffer.from(`Comment\0${METADATA}`)),
      chunk('IDAT', deflateSync(Buffer.alloc(14))),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

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

describe('S1 private image intake gate', () => {
  const upload = (app: ReturnType<typeof createApp>, cookie: string, file: File) => {
    const form = new FormData();
    form.set('image', file);
    return app.request('/api/assets', { method: 'POST', headers: { cookie }, body: form });
  };
  const png = () => new File([pngWithMetadata()], 'look.png', { type: 'image/png' });

  it.each(['outfit', 'setup'] as const)(
    'turns a private %s image into an unconfirmed brief without a decoder being injected',
    async (domain) => {
      const app = createApp({ MILESTONES: 's1' });
      const cookie = await owner(app);
      const created = await upload(app, cookie, png());
      expect(created.status).toBe(201);
      const asset = InspirationAssetSchema.parse(await created.json());

      const stored = new Uint8Array(
        await (await app.request(`/api/assets/${asset.id}`, { headers: { cookie } })).arrayBuffer(),
      );
      expect(Buffer.from(stored).includes(METADATA)).toBe(false);

      const response = await app.request('/api/briefs', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ domain, assetId: asset.id }),
      });
      const brief = IntentBriefSchema.parse(await response.json());
      expect(brief).toMatchObject({ domain, status: 'draft', input: { kind: 'image' } });
    },
  );

  it('fails unsupported and oversized uploads safely', async () => {
    const app = createApp({ MILESTONES: 's1' });
    const cookie = await owner(app);
    expect(
      (await upload(app, cookie, new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }))).status,
    ).toBe(415);
    expect(
      (
        await upload(
          app,
          cookie,
          new File([new Uint8Array([1, 2, 3, 4])], 'not-really.png', { type: 'image/png' }),
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await app.request('/api/assets', {
          method: 'POST',
          headers: { cookie, 'content-length': String(9 * 1024 * 1024) },
        })
      ).status,
    ).toBe(413);
  });

  it('denies another owner the asset, expires it, and deletes it with the session', async () => {
    let now = new Date('2026-09-19T12:00:00Z');
    const app = createApp({ MILESTONES: 's1' }, { now: () => now });
    const first = await owner(app);
    const second = await owner(app);
    const asset = InspirationAssetSchema.parse(await (await upload(app, first, png())).json());
    const fetchAsset = (cookie: string) =>
      app.request(`/api/assets/${asset.id}`, { headers: { cookie } });

    expect((await fetchAsset(second)).status).toBe(404);
    expect((await fetchAsset(first)).status).toBe(200);
    now = new Date('2026-09-20T12:00:01Z');
    expect((await fetchAsset(first)).status).toBe(404);

    now = new Date('2026-09-19T12:00:00Z');
    const fresh = InspirationAssetSchema.parse(await (await upload(app, first, png())).json());
    await app.request('/api/session', { method: 'DELETE', headers: { cookie: first } });
    expect(
      (await app.request(`/api/assets/${fresh.id}`, { headers: { cookie: first } })).status,
    ).toBe(404);
  });

  it('rejects a stale brief edit with a revision conflict', async () => {
    const app = createApp({ MILESTONES: 's1' });
    const cookie = await owner(app);
    const headers = { cookie, 'content-type': 'application/json' };
    const brief = IntentBriefSchema.parse(
      await (
        await app.request('/api/briefs', {
          method: 'POST',
          headers,
          body: JSON.stringify({ domain: 'setup', text: 'A narrow work setup with warm light' }),
        })
      ).json(),
    );
    const edit = {
      expectedRevision: 1,
      status: 'draft',
      slots: brief.slots,
      country: brief.country,
      currency: brief.currency,
      itemBudget: null,
    };
    const patch = () =>
      app.request(`/api/briefs/${brief.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(edit),
      });
    expect((await patch()).status).toBe(200);
    const conflict = await patch();
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: { code: 'REVISION_CONFLICT', message: expect.any(String) },
    });
  });
});
