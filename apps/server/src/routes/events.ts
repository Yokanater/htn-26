/**
 * Resumable run events over SSE. Owner: L4 (S2-L4-1). Design v3 §8.
 * Every event carries its per-run `seq` as the SSE id, so a reconnecting EventSource resumes with
 * `Last-Event-ID` and receives only what it missed. The stream ends after the result event. A run
 * superseded by a newer brief revision (or deleted with its session) never sends a result; it is
 * closed with a `closed` event naming the reason.
 */
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { errorBody } from '../errors';
import type { AppProviders } from '../providers';
import { isSuperseded } from '../services/runs';
import { SESSION_COOKIE } from '../services/session';

function resumePoint(header: string | undefined, query: string | undefined): number {
  const value = Number(header ?? query ?? 0);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export function eventRoutes(providers: AppProviders): Hono {
  const routes = new Hono();

  routes.get('/runs/:id/events', (c) => {
    const ownerId = getCookie(c, SESSION_COOKIE);
    const record = providers.sessions.valid(ownerId)
      ? providers.runs.get(ownerId, c.req.param('id'))
      : null;
    if (!record) return c.json(errorBody('NOT_FOUND', 'Not found.'), 404);
    let cursor = resumePoint(c.req.header('last-event-id'), c.req.query('after'));

    return streamSSE(c, async (stream) => {
      let aborted = false;
      stream.onAbort(() => {
        aborted = true;
      });
      const superseded = () =>
        isSuperseded(record, providers.runner.latestRevision(record.briefId));
      for (;;) {
        for (const event of record.events) {
          // Nothing from an old revision is sent, not even a replay of a finished result.
          if (event.seq <= cursor || superseded()) continue;
          await stream.writeSSE({
            id: String(event.seq),
            event: event.type,
            data: JSON.stringify(event),
          });
          cursor = event.seq;
        }
        if (record.done || aborted) break;
        // No await between the check above and registering the waiter: nothing can slip past.
        await providers.runs.changed(record, stream);
      }
      const reason = superseded() ? 'superseded' : record.closedReason;
      if (reason) {
        await stream.writeSSE({ event: 'closed', data: JSON.stringify({ reason }) });
      }
    });
  });

  return routes;
}
