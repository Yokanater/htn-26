/** Explicit consent controls. Consent is independent from matching and browsing. */
import { type ConsentRecord, ConsentRecordSchema, DemandEventSchema, newId } from '@sei/contracts';
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

/**
 * §6.2 counts every consented session with a confirmed brief, not only those that chose a
 * product. Opting in is the moment such a brief becomes an eligible contribution (§6.1), so
 * the observation is recorded here rather than at confirmation time, where there is no
 * consent yet and a null consent version could never enter an aggregate.
 */
async function recordConfirmedBriefs(
  providers: AppProviders,
  ownerId: string,
  consent: ConsentRecord,
): Promise<void> {
  for (const brief of providers.intake.confirmedBriefs(ownerId)) {
    const event = DemandEventSchema.parse({
      id: newId('evt_'),
      sessionId: ownerId,
      briefId: brief.id,
      briefRevision: brief.revision,
      consentVersion: consent.version,
      occurredAt: consent.updatedAt,
      sampleOrigin: brief.sampleOrigin,
      kind: 'brief_confirmed',
      matchId: null,
      selections: [],
      rejectionReason: null,
    });
    // One observation per brief revision per consent version; a re-grant is a new contribution.
    await providers.demand.append(
      event,
      `brief_confirmed:${brief.id}:${brief.revision}:${consent.version}`,
    );
  }
}

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
      if (record.state === 'granted') await recordConfirmedBriefs(providers, ownerId, record);
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
