import { createCollectionMatcher } from '@sei/enrich';
import {
  type CollectionRunEvent,
  type CollectionRunHandle,
  createCollectionRunner,
  staticCatalog,
} from '@sei/pipeline';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppProviders } from '../providers';
import { SESSION_COOKIE } from '../services/session';

export function matchRoutes(providers: AppProviders): Hono {
  const routes = new Hono();
  const runs = new Map<
    string,
    {
      owner: string;
      events: CollectionRunEvent[];
      handle: CollectionRunHandle;
      expires: number;
      attempt: number;
    }
  >();
  routes.post('/briefs/:id/search', async (c) => {
    const owner = getCookie(c, SESSION_COOKIE);
    if (!providers.sessions.valid(owner)) return c.notFound();
    const brief = providers.intake.getBrief(owner, c.req.param('id'));
    if (!brief) return c.notFound();
    const body = await c.req.json().catch(() => null);
    if (brief.status !== 'confirmed' || body?.revision !== brief.revision)
      return c.json({ error: { message: 'Confirm the current revision before searching.' } }, 409);
    for (const [id, run] of runs)
      if (run.expires < Date.now()) {
        run.handle.cancel();
        runs.delete(id);
      }
    const attempt = Number.isSafeInteger(body?.attempt) ? body.attempt : 0;
    const existing = [...runs.values()].find(
      (r) =>
        r.owner === owner &&
        r.handle.briefId === brief.id &&
        r.handle.briefRevision === brief.revision,
    );
    if (existing && existing.attempt === attempt) return c.json({ runId: existing.handle.runId });
    if (existing) {
      existing.handle.cancel();
      runs.delete(existing.handle.runId);
    }
    if (!providers.catalog)
      return c.json({ error: { message: 'Product search is not configured.' } }, 503);
    const events: CollectionRunEvent[] = [];
    const runner = createCollectionRunner({
      enabled: true,
      openCatalog: staticCatalog(providers.catalog(brief)),
      matcher: createCollectionMatcher(),
      timeoutMs: 180000,
      discoveryTimeoutMs: 160000,
      concurrency: 2,
      caps: { fetch: 24, model_call: 6 },
      onEvent: (event) => events.push(event),
    });
    const handle = runner.start(brief);
    runs.set(handle.runId, {
      owner,
      events,
      handle,
      attempt,
      expires: Date.now() + 30 * 60 * 1000,
    });
    return c.json({ runId: handle.runId }, 202);
  });
  routes.get('/search/:id', (c) => {
    const owner = getCookie(c, SESSION_COOKIE);
    const run = runs.get(c.req.param('id'));
    if (!providers.sessions.valid(owner) || !run || run.owner !== owner) return c.notFound();
    const brief = providers.intake.getBrief(owner, run.handle.briefId);
    if (!brief || brief.revision !== run.handle.briefRevision) {
      run.handle.cancel();
      runs.delete(run.handle.runId);
      return c.json(
        { error: { message: 'This search is out of date. Confirm your edited brief.' } },
        409,
      );
    }
    return c.json({ events: run.events });
  });
  routes.delete('/search/:id', (c) => {
    const owner = getCookie(c, SESSION_COOKIE);
    const run = runs.get(c.req.param('id'));
    if (!providers.sessions.valid(owner) || !run || run.owner !== owner) return c.notFound();
    run.handle.cancel();
    runs.delete(run.handle.runId);
    return c.json({ cancelled: true });
  });
  return routes;
}
