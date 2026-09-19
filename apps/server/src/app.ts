/**
 * apps/server: Hono app factory. Owner: L4 (Product & Platform).
 *
 * Pure: no listening, no env loading, so tests call `createApp().request('/healthz')` and never
 * bind a port. Routes from design §11 are added by card M1-L4-1 (feature routers mount through a
 * registry so later milestones never edit this file's core routes).
 */
import { Hono } from 'hono';

export function createApp(): Hono {
  const app = new Hono();

  // `/healthz` for deploy probes; `/api/healthz` so the web dev proxy (/api → server) reaches it.
  app.get('/healthz', (c) => c.json({ ok: true }));
  app.get('/api/healthz', (c) => c.json({ ok: true }));

  return app;
}
