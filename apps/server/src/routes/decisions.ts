/** Owner-authorized demand decisions. Owner: L4 (S3-L4-1). Design v3 §6, §8. */
import {
  type CollectionMatch,
  DecisionRequestSchema,
  type DemandEvent,
  DemandEventSchema,
  type IntentBrief,
  newId,
  type ProductOffer,
} from '@sei/contracts';
import type { CollectionRunResult } from '@sei/pipeline';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { errorBody, SESSION_ENDED } from '../errors';
import type { AppProviders } from '../providers';
import {
  decisionFingerprint,
  IDEMPOTENCY_KEY_PATTERN,
  IdempotencyConflictError,
  SessionDeletedError,
} from '../services/demand';
import { isSuperseded, type RunRecord } from '../services/runs';
import { SESSION_COOKIE } from '../services/session';

const NOT_FOUND = errorBody('NOT_FOUND', 'Not found.');
const INVALID_REQUEST = errorBody('INVALID_REQUEST', 'Check the decision fields and try again.');
const INVALID_SELECTION = errorBody(
  'INVALID_SELECTION',
  'That offer was not shown for this slot in the selected match.',
);
const STALE_REVISION = errorBody(
  'STALE_REVISION',
  'A newer version of this brief exists. Reload it and try again.',
);
const BRIEF_NOT_CONFIRMED = errorBody(
  'BRIEF_NOT_CONFIRMED',
  'Confirm the brief before recording a decision.',
);
const IDEMPOTENCY_REQUIRED = errorBody(
  'IDEMPOTENCY_KEY_REQUIRED',
  'Provide an Idempotency-Key header.',
);
const IDEMPOTENCY_CONFLICT = errorBody(
  'IDEMPOTENCY_CONFLICT',
  'That idempotency key was already used with a different request.',
);

export function decisionRoutes(providers: AppProviders): Hono {
  const routes = new Hono();

  routes.post('/briefs/:id/decisions', async (c) => {
    const ownerId = getCookie(c, SESSION_COOKIE);
    if (!providers.sessions.valid(ownerId))
      return c.json(errorBody('UNAUTHORIZED', 'Start a private session first.'), 401);

    const idempotencyKey = c.req.header('idempotency-key')?.trim() ?? '';
    if (!idempotencyKey) return c.json(IDEMPOTENCY_REQUIRED, 400);
    if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) return c.json(INVALID_REQUEST, 400);

    const parsed = DecisionRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(INVALID_REQUEST, 400);
    const body = parsed.data;

    const brief = providers.intake.getBrief(ownerId, c.req.param('id'));
    if (!brief) return c.json(NOT_FOUND, 404);
    if (brief.status !== 'confirmed') return c.json(BRIEF_NOT_CONFIRMED, 409);
    if (body.briefRevision !== brief.revision) return c.json(STALE_REVISION, 409);

    let event: DemandEvent;
    try {
      event = await buildEvent(providers, ownerId, brief, body);
    } catch (error) {
      const failure = describeDecisionFailure(error);
      if (!failure) throw error;
      return c.json(failure.body, failure.status);
    }

    if (!providers.sessions.valid(ownerId)) return c.json(SESSION_ENDED, 401);

    const fingerprint = decisionFingerprint({
      briefId: brief.id,
      kind: body.kind,
      runId: body.kind === 'brief_confirmed' ? null : body.runId,
      matchId: body.kind === 'brief_confirmed' ? null : body.matchId,
      selections: body.kind === 'brief_confirmed' ? [] : body.selections,
      rejectionReason: body.kind === 'item_rejected' ? body.rejectionReason : null,
      briefRevision: body.briefRevision,
    });

    try {
      const recorded = await providers.demand.record(event, idempotencyKey, fingerprint);
      console.info(
        '[demand]',
        JSON.stringify({
          eventId: recorded.event.id,
          kind: recorded.event.kind,
          duplicate: recorded.status === 'duplicate',
        }),
      );
      return c.json(recorded.event, recorded.status === 'inserted' ? 201 : 200);
    } catch (error) {
      if (error instanceof IdempotencyConflictError) return c.json(IDEMPOTENCY_CONFLICT, 409);
      if (error instanceof SessionDeletedError) return c.json(SESSION_ENDED, 401);
      throw error;
    }
  });

  return routes;
}

class DecisionFailure extends Error {
  readonly status: 400 | 404 | 409;
  readonly body: ReturnType<typeof errorBody>;
  constructor(status: 400 | 404 | 409, body: ReturnType<typeof errorBody>) {
    super(body.error.code);
    this.name = 'DecisionFailure';
    this.status = status;
    this.body = body;
  }
}

function describeDecisionFailure(
  error: unknown,
): { status: 400 | 404 | 409; body: ReturnType<typeof errorBody> } | null {
  return error instanceof DecisionFailure ? error : null;
}

async function buildEvent(
  providers: AppProviders,
  ownerId: string,
  brief: IntentBrief,
  body: ReturnType<typeof DecisionRequestSchema.parse>,
): Promise<DemandEvent> {
  const consent = await providers.demand.getConsent(ownerId);
  const consentVersion = consent?.state === 'granted' ? consent.version : null;
  const occurredAt = providers.now().toISOString();

  if (body.kind === 'brief_confirmed') {
    return DemandEventSchema.parse({
      id: newId('evt_'),
      sessionId: ownerId,
      briefId: brief.id,
      briefRevision: brief.revision,
      consentVersion,
      occurredAt,
      sampleOrigin: brief.sampleOrigin,
      kind: 'brief_confirmed',
      matchId: null,
      selections: [],
      rejectionReason: null,
    });
  }

  const record = providers.runs.get(ownerId, body.runId);
  const result = requireFinishedRun(providers, brief, record);
  const match = locateMatch(result, body.matchId);
  if (!match) throw new DecisionFailure(404, NOT_FOUND);
  if (match.briefId !== brief.id || match.briefRevision !== brief.revision) {
    throw new DecisionFailure(409, STALE_REVISION);
  }
  if (match.sampleOrigin !== result.sampleOrigin) throw new DecisionFailure(404, NOT_FOUND);

  const offers = new Map(result.offers.map((offer) => [offer.id, offer]));
  const selections = body.selections.map((selection) =>
    resolveSelection(body.kind, match, offers, result.sampleOrigin, selection),
  );

  return DemandEventSchema.parse({
    id: newId('evt_'),
    sessionId: ownerId,
    briefId: brief.id,
    briefRevision: brief.revision,
    consentVersion,
    occurredAt,
    sampleOrigin: result.sampleOrigin,
    kind: body.kind,
    matchId: match.id,
    selections,
    rejectionReason: body.kind === 'item_rejected' ? body.rejectionReason : null,
  });
}

function requireFinishedRun(
  providers: AppProviders,
  brief: IntentBrief,
  record: RunRecord | null,
): CollectionRunResult {
  if (!record) throw new DecisionFailure(404, NOT_FOUND);
  if (record.briefId !== brief.id) throw new DecisionFailure(404, NOT_FOUND);
  if (record.closedReason === 'deleted') throw new DecisionFailure(404, NOT_FOUND);
  const latest = providers.runner.latestRevision(brief.id) ?? brief.revision;
  if (isSuperseded(record, latest) || record.briefRevision !== brief.revision) {
    throw new DecisionFailure(409, STALE_REVISION);
  }
  if (!record.done || !record.result) throw new DecisionFailure(404, NOT_FOUND);
  const status = record.result.status;
  if (status === 'cancelled' || status === 'failed' || status === 'superseded') {
    if (status === 'superseded') throw new DecisionFailure(409, STALE_REVISION);
    throw new DecisionFailure(404, NOT_FOUND);
  }
  return record.result;
}

function locateMatch(result: CollectionRunResult, matchId: string): CollectionMatch | null {
  if (result.collection?.match.id === matchId) return result.collection.match;
  return result.alternatives.find((item) => item.match.id === matchId)?.match ?? null;
}

function resolveSelection(
  kind: 'item_accepted' | 'item_rejected' | 'collection_saved' | 'offer_requested',
  match: CollectionMatch,
  offers: Map<string, ProductOffer>,
  runOrigin: ProductOffer['sampleOrigin'],
  selection: { slotId: string; offerId: string },
): DemandEvent['selections'][number] {
  const slot = match.slots.find((item) => item.slotId === selection.slotId);
  if (!slot) throw new DecisionFailure(400, INVALID_SELECTION);
  const allowed =
    kind === 'item_rejected'
      ? [slot.selectedOfferId, ...slot.alternativeOfferIds]
      : [slot.selectedOfferId];
  if (!allowed.includes(selection.offerId)) throw new DecisionFailure(400, INVALID_SELECTION);
  const offer = offers.get(selection.offerId);
  if (!offer) throw new DecisionFailure(400, INVALID_SELECTION);
  if (offer.sampleOrigin !== runOrigin) throw new DecisionFailure(400, INVALID_SELECTION);
  return { slotId: slot.slotId, offerId: offer.id, merchantId: offer.merchant.id };
}
