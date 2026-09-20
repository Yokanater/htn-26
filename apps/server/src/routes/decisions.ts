/** Validated explicit shopper decisions. Owner: L4 (S3-L4-1). */
import { DemandEventSchema, newId } from '@sei/contracts';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { errorBody } from '../errors';
import type { AppProviders } from '../providers';
import { IdempotencyConflictError, SessionDeletedError } from '../services/demand';
import { SESSION_COOKIE } from '../services/session';

const selectionInput = z.strictObject({
  slotId: z.string().regex(/^slot_[A-Za-z0-9_-]+$/),
  offerId: z.string().regex(/^offer_[A-Za-z0-9_-]+$/),
});
const decisionInput = z.strictObject({
  idempotencyKey: z.string().trim().min(8).max(128),
  briefRevision: z.number().int().positive(),
  runId: z
    .string()
    .regex(/^run_[A-Za-z0-9_-]+$/)
    .nullable(),
  matchId: z
    .string()
    .regex(/^match_[A-Za-z0-9_-]+$/)
    .nullable(),
  kind: z.enum([
    'brief_confirmed',
    'item_accepted',
    'item_rejected',
    'collection_saved',
    'offer_requested',
  ]),
  selections: z.array(selectionInput).max(6),
  rejectionReason: z
    .enum(['price', 'style', 'size', 'dimensions', 'material', 'shipping', 'availability', 'other'])
    .nullable(),
});

export function decisionRoutes(providers: AppProviders): Hono {
  const routes = new Hono();

  routes.post('/briefs/:id/decisions', async (c) => {
    const ownerId = getCookie(c, SESSION_COOKIE);
    if (!providers.sessions.valid(ownerId))
      return c.json(errorBody('UNAUTHORIZED', 'Start a private session first.'), 401);
    const input = decisionInput.safeParse(await c.req.json().catch(() => null));
    if (!input.success)
      return c.json(
        errorBody('INVALID_DECISION', 'The decision shape or idempotency key is invalid.'),
        400,
      );
    const brief = providers.intake.getBrief(ownerId, c.req.param('id'));
    if (!brief) return c.json(errorBody('NOT_FOUND', 'Not found.'), 404);
    if (brief.status !== 'confirmed' || brief.revision !== input.data.briefRevision)
      return c.json(
        errorBody('STALE_BRIEF', 'Use the current confirmed brief before recording a choice.'),
        409,
      );

    const previous = providers.demand.eventForKey(ownerId, input.data.idempotencyKey);
    if (previous) {
      const sameRequest =
        previous.briefId === brief.id &&
        previous.briefRevision === input.data.briefRevision &&
        previous.kind === input.data.kind &&
        previous.matchId === input.data.matchId &&
        previous.rejectionReason === input.data.rejectionReason &&
        JSON.stringify(previous.selections.map(({ slotId, offerId }) => ({ slotId, offerId }))) ===
          JSON.stringify(input.data.selections);
      if (!sameRequest)
        return c.json(
          errorBody(
            'IDEMPOTENCY_CONFLICT',
            'That idempotency key already identifies another choice.',
          ),
          409,
        );
      return c.json({ event: previous, duplicate: true });
    }

    let sampleOrigin = brief.sampleOrigin;
    let selections: { slotId: string; offerId: string; merchantId: string }[] = [];
    if (input.data.kind === 'brief_confirmed') {
      if (
        input.data.runId !== null ||
        input.data.matchId !== null ||
        input.data.selections.length !== 0 ||
        input.data.rejectionReason !== null
      )
        return c.json(
          errorBody('INVALID_DECISION', 'Brief confirmation selects no products.'),
          400,
        );
    } else {
      const run = input.data.runId ? providers.runs.get(ownerId, input.data.runId) : null;
      if (
        !run?.done ||
        !run.result ||
        run.briefId !== brief.id ||
        run.briefRevision !== brief.revision
      )
        return c.json(errorBody('MATCH_NOT_FOUND', 'Use a completed current collection.'), 409);
      const collections = [run.result.collection, ...run.result.alternatives].filter(
        (value) => value !== null,
      );
      const collection = collections.find((value) => value.match.id === input.data.matchId);
      if (!collection)
        return c.json(errorBody('MATCH_NOT_FOUND', 'That collection was not displayed.'), 409);
      const offers = new Map(run.result.offers.map((offer) => [offer.id, offer]));
      selections = [];
      for (const selection of input.data.selections) {
        const slot = collection.match.slots.find((value) => value.slotId === selection.slotId);
        const allowed = new Set(
          [slot?.selectedOfferId, ...(slot?.alternativeOfferIds ?? [])].filter(Boolean),
        );
        for (const candidate of run.result.candidates.find(
          (value) => value.slotId === selection.slotId,
        )?.offerIds ?? [])
          allowed.add(candidate);
        const offer = offers.get(selection.offerId);
        if (!slot || !allowed.has(selection.offerId) || !offer)
          return c.json(
            errorBody('FORGED_SELECTION', 'A selected product was not shown for that item.'),
            422,
          );
        selections.push({
          slotId: selection.slotId,
          offerId: selection.offerId,
          merchantId: offer.merchant.id,
        });
      }
      sampleOrigin = run.result.sampleOrigin;
    }

    const consent = await providers.demand.getConsent(ownerId);
    const event = DemandEventSchema.safeParse({
      id: newId('evt_'),
      sessionId: ownerId,
      briefId: brief.id,
      briefRevision: brief.revision,
      consentVersion: consent?.state === 'granted' ? consent.version : null,
      occurredAt: providers.now().toISOString(),
      sampleOrigin,
      kind: input.data.kind,
      matchId: input.data.matchId,
      selections,
      rejectionReason: input.data.rejectionReason,
    });
    if (!event.success)
      return c.json(
        errorBody('INVALID_DECISION', 'This choice is incomplete for the selected action.'),
        400,
      );
    let status: 'inserted' | 'duplicate';
    try {
      status = await providers.demand.append(event.data, input.data.idempotencyKey);
    } catch (error) {
      if (error instanceof IdempotencyConflictError)
        return c.json(errorBody('IDEMPOTENCY_CONFLICT', error.message), 409);
      if (error instanceof SessionDeletedError)
        return c.json(errorBody('SESSION_DELETED', error.message), 409);
      throw error;
    }
    const stored =
      status === 'duplicate'
        ? providers.demand.eventForKey(ownerId, input.data.idempotencyKey)
        : event.data;
    return c.json(
      { event: stored, duplicate: status === 'duplicate' },
      status === 'duplicate' ? 200 : 201,
    );
  });

  return routes;
}
