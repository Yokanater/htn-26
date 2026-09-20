/** Opportunity drafts. Owner: L4 (S4-L4-1). Server-generated prose; no S5 approve/execute. */
import { CreateMerchantDraftRequestSchema, MerchantCollaborationDraftSchema } from '@sei/contracts';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { errorBody, SESSION_ENDED } from '../errors';
import type { AppProviders } from '../providers';
import {
  MerchantConflictError,
  MerchantNotFoundError,
  MerchantSelectionError,
  MerchantSessionDeletedError,
} from '../services/merchant-workspace';
import { SESSION_COOKIE } from '../services/session';

const NOT_FOUND = errorBody('NOT_FOUND', 'Not found.');
const INVALID_REQUEST = errorBody('INVALID_REQUEST', 'This request takes no fields.');
const CONFLICT = errorBody('STALE_REVISION', 'Reload the opportunity and try again.');
const INVALID_SELECTION = errorBody(
  'INVALID_SELECTION',
  'That evidence is not part of this opportunity.',
);

export function opportunityRoutes(providers: AppProviders): Hono {
  const routes = new Hono();

  routes.post('/merchants/:merchantId/opportunities/:id/drafts', async (c) => {
    const ownerId = getCookie(c, SESSION_COOKIE);
    if (!providers.sessions.valid(ownerId))
      return c.json(errorBody('UNAUTHORIZED', 'Start a private session first.'), 401);
    const body = await c.req.text();
    if (!CreateMerchantDraftRequestSchema.safeParse(body.trim() ? safeJson(body) : {}).success) {
      return c.json(INVALID_REQUEST, 400);
    }
    try {
      const draft = await providers.merchantWorkspace.createDraft(
        ownerId,
        c.req.param('merchantId'),
        c.req.param('id'),
      );
      if (!providers.sessions.valid(ownerId)) return c.json(SESSION_ENDED, 401);
      console.info('[merchant]', JSON.stringify({ draftId: draft.id, action: 'create' }));
      return c.json(MerchantCollaborationDraftSchema.parse(draft), 201);
    } catch (error) {
      if (error instanceof MerchantSessionDeletedError) return c.json(SESSION_ENDED, 401);
      if (error instanceof MerchantConflictError) return c.json(CONFLICT, 409);
      if (error instanceof MerchantSelectionError) return c.json(INVALID_SELECTION, 400);
      if (error instanceof MerchantNotFoundError) return c.json(NOT_FOUND, 404);
      throw error;
    }
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
