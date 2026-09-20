/** Explicit consent versioning. Owner: L4 (S3-L4-1). Design v3 §6.1, §8. */
import { ConsentRecordSchema, ConsentUpdateRequestSchema } from '@sei/contracts';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { errorBody, SESSION_ENDED } from '../errors';
import type { AppProviders } from '../providers';
import { ConsentConflictError, SessionDeletedError } from '../services/demand';
import { SESSION_COOKIE } from '../services/session';

const CONSENT_CONFLICT = errorBody(
  'CONSENT_CONFLICT',
  'Consent changed in another request. Reload and try again.',
);
const INVALID_REQUEST = errorBody('INVALID_REQUEST', 'Check the consent fields and try again.');

export function consentRoutes(providers: AppProviders): Hono {
  const routes = new Hono();

  routes.put('/consent', async (c) => {
    const ownerId = getCookie(c, SESSION_COOKIE);
    if (!providers.sessions.valid(ownerId))
      return c.json(errorBody('UNAUTHORIZED', 'Start a private session first.'), 401);

    const parsed = ConsentUpdateRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(INVALID_REQUEST, 400);
    if (parsed.data.state === 'withdrawn' && parsed.data.expectedVersion === null) {
      return c.json(INVALID_REQUEST, 400);
    }

    const current = await providers.demand.getConsent(ownerId);
    if ((current?.version ?? null) !== parsed.data.expectedVersion) {
      return c.json(CONSENT_CONFLICT, 409);
    }
    if (!providers.sessions.valid(ownerId)) return c.json(SESSION_ENDED, 401);

    const record = ConsentRecordSchema.parse({
      sessionId: ownerId,
      version: current ? current.version + 1 : 1,
      state: parsed.data.state,
      updatedAt: providers.now().toISOString(),
    });

    try {
      await providers.demand.setConsent(record, parsed.data.expectedVersion);
      console.info(
        '[demand]',
        JSON.stringify({ consentVersion: record.version, state: record.state }),
      );
      return c.json(record);
    } catch (error) {
      if (error instanceof ConsentConflictError) return c.json(CONSENT_CONFLICT, 409);
      if (error instanceof SessionDeletedError) return c.json(SESSION_ENDED, 401);
      throw error;
    }
  });

  return routes;
}
