/** Implemented shopper and merchant routes are always available. Owner: L4. */
import { CapabilitiesSchema, SCHEMA_VERSION } from '@sei/contracts';
import { type EnvLike, SHOPPING_DOMAINS } from '@sei/core';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { errorBody } from './errors';
import { type AppProviders, defaultProviders } from './providers';
import { assetRoutes } from './routes/assets';
import { briefRoutes } from './routes/briefs';
import { consentRoutes } from './routes/consent';
import { decisionRoutes } from './routes/decisions';
import { eventRoutes } from './routes/events';
import { matchRoutes } from './routes/matches';
import { merchantRoutes } from './routes/merchants';
import { sessionRoutes } from './routes/session';

/** Pure factory: no listeners, environment reads or provider calls. */
export function createApp(env: EnvLike = {}, injected?: Partial<AppProviders>): Hono {
  const providers = defaultProviders(env, { overrides: injected });
  const capabilities = CapabilitiesSchema.parse({
    planVersion: '3.0',
    schemaVersion: SCHEMA_VERSION,
    milestoneFamily: 'intent',
    milestones: ['s1', 's2', 's3', 's4'],
    sections: ['intent', 'collections', 'demand', 'opportunities'],
    domains: Object.keys(SHOPPING_DOMAINS),
    flags: {},
    implementation: 'bootstrap',
  });
  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const origin = c.req.header('origin');
      const requestHost = new URL(c.req.url).host;
      const forwardedHost = c.req.header('x-forwarded-host')?.split(',')[0]?.trim();
      if (origin && ![requestHost, forwardedHost].includes(new URL(origin).host)) {
        return c.json(
          { error: { code: 'ORIGIN_DENIED', message: 'Use this action from the same site.' } },
          403,
        );
      }
    }
    c.header('Cache-Control', 'no-store');
    await next();
  });
  app.notFound((c) => c.json(errorBody('NOT_FOUND', 'Not found.'), 404));
  app.onError((error, c) => {
    // Name only: messages can carry provider output or shopper text.
    console.error('[server] unhandled error', error instanceof Error ? error.name : typeof error);
    if (error instanceof HTTPException) {
      return c.json(errorBody('HTTP_ERROR', 'The request could not be processed.'), error.status);
    }
    return c.json(errorBody('INTERNAL_ERROR', 'Something went wrong. Try again.'), 500);
  });
  app.get('/healthz', (c) => c.json({ ok: true }));
  app.get('/api/healthz', (c) => c.json({ ok: true }));
  app.get('/api/capabilities', (c) => c.json(capabilities));
  app.route('/api', sessionRoutes(providers));
  app.route('/api', assetRoutes(providers));
  app.route('/api', briefRoutes(providers));
  app.route('/api', matchRoutes(providers));
  app.route('/api', eventRoutes(providers));
  app.route('/api', consentRoutes(providers));
  app.route('/api', decisionRoutes(providers));
  app.route('/api', merchantRoutes(providers));
  return app;
}
