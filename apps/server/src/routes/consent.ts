/** Explicit consent controls. Consent is independent from matching and browsing. */
import { ConsentRecordSchema } from '@sei/contracts';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { errorBody } from '../errors';
import type { AppProviders } from '../providers';
import { ConsentConflictError, SessionDeletedError } from '../services/demand';
import { SESSION_COOKIE } from '../services/session';

const consentInput = z.strictObject({
  state: z.enum(['granted', 'declined', 'withdrawn']),
  expectedVersion: z.number().int().positive().nullable(),
});

export function consentRoutes(providers: AppProviders): Hono {
  const routes = new Hono();

  routes.get('/consent', async (c) => {
    const ownerId = getCookie(c, SESSION_COOKIE);
    if (!providers.sessions.valid(ownerId))
      return c.json(errorBody('UNAUTHORIZED', 'Start a private session first.'), 401);
    return c.json({ consent: await providers.demand.getConsent(ownerId) });
  });

  routes.put('/consent', async (c) => {
    const ownerId = getCookie(c, SESSION_COOKIE);
    if (!providers.sessions.valid(ownerId))
      return c.json(errorBody('UNAUTHORIZED', 'Start a private session first.'), 401);
    const input = consentInput.safeParse(await c.req.json().catch(() => null));
    if (!input.success)
      return c.json(
        errorBody('INVALID_CONSENT', 'Choose a consent state and provide its current version.'),
        400,
      );
    const current = await providers.demand.getConsent(ownerId);
    if (input.data.state === 'withdrawn' && !current)
      return c.json(errorBody('INVALID_CONSENT', 'There is no consent to withdraw.'), 409);
    const record = ConsentRecordSchema.parse({
      sessionId: ownerId,
      version: (current?.version ?? 0) + 1,
      state: input.data.state,
      updatedAt: providers.now().toISOString(),
    });
    try {
      await providers.demand.setConsent(record, input.data.expectedVersion);
      return c.json(record);
    } catch (error) {
      if (error instanceof ConsentConflictError)
        return c.json(errorBody('CONSENT_CONFLICT', error.message), 409);
      if (error instanceof SessionDeletedError)
        return c.json(errorBody('SESSION_DELETED', error.message), 409);
      throw error;
    }
  });

  return routes;
}
