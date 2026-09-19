/** Owner-authorized collection runs: start, read, cancel. Owner: L4 (S2-L4-1). Design v3 §8. */
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { describeRunFailure, errorBody } from '../errors';
import type { AppProviders } from '../providers';
import { isSuperseded } from '../services/runs';
import { SESSION_COOKIE } from '../services/session';

const startInput = z.strictObject({});

export function matchRoutes(providers: AppProviders): Hono {
  const routes = new Hono();
  const notFound = () => errorBody('NOT_FOUND', 'Not found.');

  routes.post('/briefs/:id/matches', async (c) => {
    const ownerId = getCookie(c, SESSION_COOKIE);
    if (!providers.sessions.valid(ownerId))
      return c.json(errorBody('UNAUTHORIZED', 'Start a private session first.'), 401);
    const body = await c.req.text();
    if (!startInput.safeParse(body.trim() ? safeJson(body) : {}).success)
      return c.json(errorBody('INVALID_REQUEST', 'This request takes no fields.'), 400);
    const brief = providers.intake.getBrief(ownerId, c.req.param('id'));
    if (!brief) return c.json(notFound(), 404);
    try {
      const record = providers.runs.start(ownerId, () => providers.runner.start(brief));
      return c.json(
        { runId: record.runId, briefId: record.briefId, briefRevision: record.briefRevision },
        202,
      );
    } catch (error) {
      const failure = describeRunFailure(error);
      if (!failure) throw error;
      return c.json(failure.body, failure.status);
    }
  });

  routes.get('/runs/:id', (c) => {
    const ownerId = getCookie(c, SESSION_COOKIE);
    const record = providers.sessions.valid(ownerId)
      ? providers.runs.get(ownerId, c.req.param('id'))
      : null;
    if (!record) return c.json(notFound(), 404);
    const superseded = isSuperseded(record, providers.runner.latestRevision(record.briefId));
    return c.json({
      runId: record.runId,
      briefId: record.briefId,
      briefRevision: record.briefRevision,
      status: superseded
        ? 'superseded'
        : record.done
          ? (record.closedReason ?? record.result?.status ?? 'failed')
          : 'running',
      result: superseded ? null : record.result,
    });
  });

  routes.delete('/runs/:id', (c) => {
    const ownerId = getCookie(c, SESSION_COOKIE);
    const record = providers.sessions.valid(ownerId)
      ? providers.runs.get(ownerId, c.req.param('id'))
      : null;
    if (!record) return c.json(notFound(), 404);
    record.handle?.cancel();
    return c.json({ cancelled: true });
  });

  return routes;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
