/** Versioned demo drafts. Owner: L4 (S4-L4-1). Client edits prose only. */
import { MerchantCollaborationDraftSchema, PatchMerchantDraftRequestSchema } from '@sei/contracts';
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
const INVALID_REQUEST = errorBody('INVALID_REQUEST', 'Check the draft fields and try again.');
const CONFLICT = errorBody(
  'REVISION_CONFLICT',
  'The draft changed in another request. Reload and try again.',
);
const INVALID_SELECTION = errorBody(
  'INVALID_SELECTION',
  'That evidence is not part of this opportunity.',
);

export function draftRoutes(providers: AppProviders): Hono {
  const routes = new Hono();

  routes.get('/drafts/:id', (c) => {
    const ownerId = getCookie(c, SESSION_COOKIE);
    if (!providers.sessions.valid(ownerId))
      return c.json(errorBody('UNAUTHORIZED', 'Start a private session first.'), 401);
    try {
      const draft = providers.merchantWorkspace.getDraft(ownerId, c.req.param('id'));
      return c.json(MerchantCollaborationDraftSchema.parse(draft));
    } catch (error) {
      if (error instanceof MerchantSessionDeletedError) return c.json(SESSION_ENDED, 401);
      if (error instanceof MerchantNotFoundError) return c.json(NOT_FOUND, 404);
      throw error;
    }
  });

  routes.patch('/drafts/:id', async (c) => {
    const ownerId = getCookie(c, SESSION_COOKIE);
    if (!providers.sessions.valid(ownerId))
      return c.json(errorBody('UNAUTHORIZED', 'Start a private session first.'), 401);
    const parsed = PatchMerchantDraftRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(INVALID_REQUEST, 400);
    try {
      const draft = await providers.merchantWorkspace.updateDraft(
        ownerId,
        c.req.param('id'),
        parsed.data,
      );
      if (!providers.sessions.valid(ownerId)) return c.json(SESSION_ENDED, 401);
      console.info('[merchant]', JSON.stringify({ draftId: draft.id, action: 'update' }));
      return c.json(MerchantCollaborationDraftSchema.parse(draft));
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
