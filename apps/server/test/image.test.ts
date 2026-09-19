/** Container sanitizer for private uploads: structure, limits and metadata stripping. Offline. */
import { crc32, deflateSync } from 'node:zlib';
import { IntentBriefSchema } from '@sei/contracts';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import {
  ContainerImageNormalizer,
  IMAGE_MAX_EDGE_PX,
  IMAGE_MAX_PIXELS,
} from '../src/services/image';

const SECRET = 'gps-51.5N-0.12W-private-camera-serial';

const u16be = (n: number) => Buffer.from([(n >> 8) & 0xff, n & 0xff]);
const u32be = (n: number) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(n);
  return buffer;
};

// --- PNG ---------------------------------------------------------------------------------------
function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'latin1');
  return Buffer.concat([u32be(data.length), name, data, u32be(crc32(Buffer.concat([name, data])))]);
}
function png(options: { w?: number; h?: number; extra?: Buffer[]; trailing?: Buffer } = {}) {
  const { w = 2, h = 2, extra = [], trailing = Buffer.alloc(0) } = options;
  const ihdr = Buffer.concat([u32be(w), u32be(h), Buffer.from([8, 2, 0, 0, 0])]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    ...extra,
    pngChunk('IDAT', deflateSync(Buffer.alloc(8))),
    pngChunk('IEND', Buffer.alloc(0)),
    trailing,
  ]);
}

// --- JPEG --------------------------------------------------------------------------------------
const jpegSegment = (marker: number, data: Buffer) =>
  Buffer.concat([Buffer.from([0xff, marker]), u16be(data.length + 2), data]);
function jpeg(options: { w?: number; h?: number; extra?: Buffer[]; trailing?: Buffer } = {}) {
  const { w = 2, h = 2, extra = [], trailing = Buffer.alloc(0) } = options;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    ...extra,
    jpegSegment(0xdb, Buffer.alloc(65, 1)),
    jpegSegment(
      0xc0,
      Buffer.concat([Buffer.from([8]), u16be(h), u16be(w), Buffer.from([1, 1, 0x11, 0])]),
    ),
    jpegSegment(0xc4, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(16, 0), Buffer.from([0])])),
    jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
    Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78]),
    Buffer.from([0xff, 0xd9]),
    trailing,
  ]);
}

// --- WebP --------------------------------------------------------------------------------------
function webpChunk(fourcc: string, data: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length);
  return Buffer.concat([
    Buffer.from(fourcc, 'latin1'),
    size,
    data,
    data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0),
  ]);
}
function webp(options: { w?: number; h?: number; flags?: number; extra?: Buffer[] } = {}) {
  const { w = 2, h = 2, flags = 0x08 | 0x04 | 0x20, extra = [] } = options;
  const vp8x = Buffer.alloc(10);
  vp8x[0] = flags;
  vp8x.writeUIntLE(w - 1, 4, 3);
  vp8x.writeUIntLE(h - 1, 7, 3);
  const vp8l = Buffer.alloc(9);
  vp8l[0] = 0x2f;
  vp8l.writeUInt32LE((w - 1) | ((h - 1) << 14), 1);
  const body = Buffer.concat([
    Buffer.from('WEBP', 'latin1'),
    webpChunk('VP8X', vp8x),
    webpChunk('ICCP', Buffer.from(SECRET)),
    webpChunk('VP8L', vp8l),
    webpChunk('EXIF', Buffer.from(SECRET)),
    webpChunk('XMP ', Buffer.from(SECRET)),
    ...extra,
  ]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), size, body]);
}

const normalizer = new ContainerImageNormalizer();
const run = (bytes: Buffer, mime: string) => normalizer.normalize(new Uint8Array(bytes), mime);
const has = (bytes: Uint8Array, needle: string) => Buffer.from(bytes).includes(needle);

describe('ContainerImageNormalizer', () => {
  it('strips PNG metadata chunks and anything after IEND, keeping the image', async () => {
    const input = png({
      extra: [
        pngChunk('tEXt', Buffer.from(`Comment\0${SECRET}`)),
        pngChunk('eXIf', Buffer.from(SECRET)),
        pngChunk('iTXt', Buffer.from(`k\0\0\0\0\0${SECRET}`)),
      ],
      trailing: Buffer.from(SECRET),
    });
    const out = await run(input, 'image/png');
    expect(out.mimeType).toBe('image/png');
    expect(has(out.bytes, SECRET)).toBe(false);
    expect(has(out.bytes, 'IDAT')).toBe(true);
    expect(Buffer.from(out.bytes).subarray(-8, -4).toString('latin1')).toBe('IEND');
    expect(out.bytes.byteLength).toBeLessThan(input.byteLength);
  });

  it('strips JPEG EXIF/comment segments and trailing bytes but keeps entropy data intact', async () => {
    const input = jpeg({
      extra: [
        jpegSegment(0xe1, Buffer.from(`Exif\0\0${SECRET}`)),
        jpegSegment(0xfe, Buffer.from(SECRET)),
      ],
      trailing: Buffer.from(SECRET),
    });
    const out = await run(input, 'image/jpeg');
    expect(out.mimeType).toBe('image/jpeg');
    expect(has(out.bytes, SECRET)).toBe(false);
    expect(
      Buffer.from(out.bytes)
        .subarray(0, 2)
        .equals(Buffer.from([0xff, 0xd8])),
    ).toBe(true);
    expect(
      Buffer.from(out.bytes)
        .subarray(-2)
        .equals(Buffer.from([0xff, 0xd9])),
    ).toBe(true);
    const entropy = Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78]);
    expect(Buffer.from(out.bytes).includes(entropy)).toBe(true);
  });

  it('strips WebP EXIF/XMP/ICC chunks, clears their VP8X flags and fixes the RIFF size', async () => {
    const out = await run(webp(), 'image/webp');
    const bytes = Buffer.from(out.bytes);
    expect(out.mimeType).toBe('image/webp');
    expect(has(out.bytes, SECRET)).toBe(false);
    expect(bytes.toString('latin1', 0, 4)).toBe('RIFF');
    expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8);
    const vp8x = bytes.indexOf('VP8X');
    expect(bytes[vp8x + 8]! & (0x08 | 0x04 | 0x20)).toBe(0);
  });

  it.each([
    ['png', png({ w: IMAGE_MAX_EDGE_PX + 1, h: 1 }), 'image/png'],
    ['jpeg', jpeg({ w: 1, h: IMAGE_MAX_EDGE_PX + 1 }), 'image/jpeg'],
    ['webp', webp({ w: IMAGE_MAX_EDGE_PX + 1, h: 1 }), 'image/webp'],
  ])('rejects a %s wider than the edge limit', async (_name, input, mime) => {
    await expect(run(input, mime)).rejects.toThrow();
  });

  it('rejects an image over the pixel budget even when each edge is allowed', async () => {
    const edge = Math.floor(Math.sqrt(IMAGE_MAX_PIXELS)) + 1;
    expect(edge).toBeLessThanOrEqual(IMAGE_MAX_EDGE_PX);
    await expect(run(png({ w: edge, h: edge }), 'image/png')).rejects.toThrow();
  });

  it.each([
    ['declared type does not match the bytes', png(), 'image/jpeg'],
    ['zero width', png({ w: 0 }), 'image/png'],
    ['a PNG without IEND', png().subarray(0, -12), 'image/png'],
    [
      'a PNG with a corrupted chunk CRC',
      (() => {
        const bad = Buffer.from(png());
        bad[bad.length - 1] = bad[bad.length - 1]! ^ 0xff;
        return bad;
      })(),
      'image/png',
    ],
    ['a JPEG without EOI', jpeg().subarray(0, -2), 'image/jpeg'],
    [
      'a JPEG with a segment past the end',
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0xff, 0xff])]),
      'image/jpeg',
    ],
    ['an animated WebP', webp({ flags: 0x02 }), 'image/webp'],
    [
      'an animated WebP frame chunk',
      webp({ extra: [webpChunk('ANMF', Buffer.alloc(16))] }),
      'image/webp',
    ],
    ['a truncated WebP', webp().subarray(0, 20), 'image/webp'],
    ['an SVG payload', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/png'],
    ['an empty file', Buffer.alloc(0), 'image/png'],
  ])('rejects %s', async (_name, input, mime) => {
    await expect(run(input, mime)).rejects.toThrow();
  });
});

describe('default server image intake', () => {
  const upload = (app: ReturnType<typeof createApp>, cookie: string, file: File) => {
    const form = new FormData();
    form.set('image', file);
    return app.request('/api/assets', { method: 'POST', headers: { cookie }, body: form });
  };
  const owner = async (app: ReturnType<typeof createApp>) =>
    (await app.request('/api/session')).headers.get('set-cookie')?.split(';')[0] ?? '';

  it.each([
    ['outfit', 'image/png', png()],
    ['setup', 'image/jpeg', jpeg()],
    ['outfit', 'image/webp', webp()],
  ] as const)(
    'accepts a %s %s upload with no injected decoder and drafts a brief from it',
    async (domain, mime, bytes) => {
      const app = createApp({ MILESTONES: 's1' });
      const cookie = await owner(app);
      const response = await upload(
        app,
        cookie,
        new File([new Uint8Array(bytes)], 'x', { type: mime }),
      );
      expect(response.status).toBe(201);
      const asset = (await response.json()) as { id: string };
      const stored = await app.request(`/api/assets/${asset.id}`, { headers: { cookie } });
      expect(has(new Uint8Array(await stored.arrayBuffer()), SECRET)).toBe(false);
      const brief = await app.request('/api/briefs', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, assetId: asset.id }),
      });
      expect(brief.status).toBe(201);
      expect(IntentBriefSchema.parse(await brief.json()).input).toEqual({
        kind: 'image',
        assetId: asset.id,
      });
    },
  );

  it('answers a structurally invalid image with a typed 415 rather than 503 or 500', async () => {
    const app = createApp({ MILESTONES: 's1' });
    const response = await upload(
      app,
      await owner(app),
      new File([new Uint8Array([1, 2, 3, 4])], 'x.png', { type: 'image/png' }),
    );
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({
      error: { code: 'MALFORMED_ASSET', message: expect.any(String) },
    });
  });
});
