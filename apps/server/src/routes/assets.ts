import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppProviders } from '../providers';
import { ASSET_MAX_BYTES } from '../services/intake';
import { SESSION_COOKIE } from '../services/session';

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function assetRoutes(providers: AppProviders): Hono {
  const routes = new Hono();
  routes.post('/assets', async (c) => {
    const ownerId = getCookie(c, SESSION_COOKIE);
    if (!providers.sessions.valid(ownerId))
      return c.json(
        { error: { code: 'UNAUTHORIZED', message: 'Start a private session first.' } },
        401,
      );
    const contentLength = Number(c.req.header('content-length') ?? 0);
    if (contentLength > ASSET_MAX_BYTES + 64_000)
      return c.json(
        { error: { code: 'ASSET_TOO_LARGE', message: 'Choose an image smaller than 8 MiB.' } },
        413,
      );
    const body = await c.req.parseBody();
    const upload = body.image;
    if (!(upload instanceof File) || !allowedTypes.has(upload.type))
      return c.json(
        { error: { code: 'UNSUPPORTED_ASSET', message: 'Use one JPEG, PNG, or WebP image.' } },
        415,
      );
    if (upload.size > ASSET_MAX_BYTES)
      return c.json(
        { error: { code: 'ASSET_TOO_LARGE', message: 'Choose an image smaller than 8 MiB.' } },
        413,
      );
    if (!providers.imageNormalizer)
      return c.json(
        {
          error: {
            code: 'IMAGE_DECODER_UNAVAILABLE',
            message:
              'Image intake is temporarily unavailable. Describe the collection in text instead.',
          },
        },
        503,
      );
    try {
      const normalized = await providers.imageNormalizer.normalize(
        new Uint8Array(await upload.arrayBuffer()),
        upload.type,
      );
      const asset = providers.intake.putAsset(ownerId, normalized, providers.now());
      return c.json(asset, 201);
    } catch {
      return c.json(
        { error: { code: 'MALFORMED_ASSET', message: 'That image could not be decoded safely.' } },
        415,
      );
    }
  });
  routes.get('/assets/:id', (c) => {
    const ownerId = getCookie(c, SESSION_COOKIE);
    if (!providers.sessions.valid(ownerId)) return c.notFound();
    const record = providers.intake.readAsset(ownerId, c.req.param('id'), providers.now());
    if (!record) return c.notFound();
    return c.body(Uint8Array.from(record.bytes).buffer, 200, {
      'Content-Type': record.asset.mimeType,
      'Cache-Control': 'private, no-store',
    });
  });
  return routes;
}
