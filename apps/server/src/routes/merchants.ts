/** Merchant demo profile. Owner: L4 (S4-L4-1). Design v3 §8. Not store ownership. */
import {
  MerchantOpportunityListSchema,
  MerchantProfileRequestSchema,
  MerchantWorkspaceProfileSchema,
} from '@sei/contracts';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { errorBody, SESSION_ENDED } from '../errors';
import type { AppProviders } from '../providers';
import { MerchantProfilerError } from '../services/merchant-catalog';
import { MerchantUrlError } from '../services/merchant-url';
import { MerchantNotFoundError, MerchantSessionDeletedError } from '../services/merchant-workspace';
import { SESSION_COOKIE } from '../services/session';

const NOT_FOUND = errorBody('NOT_FOUND', 'Not found.');
const INVALID_REQUEST = errorBody('INVALID_REQUEST', 'Check the store URL and try again.');

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: string }).name === 'AbortError'
  );
}

export function merchantRoutes(providers: AppProviders): Hono {
  const routes = new Hono();

  routes.post('/merchants/profile', async (c) => {
    const ownerId = getCookie(c, SESSION_COOKIE);
    if (!providers.sessions.valid(ownerId))
      return c.json(errorBody('UNAUTHORIZED', 'Start a private session first.'), 401);
    const parsed = MerchantProfileRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(INVALID_REQUEST, 400);
    try {
      const profile = await providers.merchantWorkspace.profile(
        ownerId,
        parsed.data.url,
        providers.merchantCatalog,
        c.req.raw.signal,
      );
      if (!providers.sessions.valid(ownerId)) return c.json(SESSION_ENDED, 401);
      console.info(
        '[merchant]',
        JSON.stringify({ merchantId: profile.merchant.id, action: 'profile' }),
      );
      return c.json(MerchantWorkspaceProfileSchema.parse(profile), 201);
    } catch (error) {
      if (error instanceof MerchantUrlError) return c.json(INVALID_REQUEST, 400);
      if (error instanceof MerchantProfilerError) {
        return c.json(errorBody(error.code, error.message), error.status);
      }
      if (error instanceof MerchantSessionDeletedError) return c.json(SESSION_ENDED, 401);
      if (isAbortError(error)) return c.json(SESSION_ENDED, 401);
      throw error;
    }
  });

  routes.get('/merchants/:id/opportunities', (c) => {
    const ownerId = getCookie(c, SESSION_COOKIE);
    if (!providers.sessions.valid(ownerId))
      return c.json(errorBody('UNAUTHORIZED', 'Start a private session first.'), 401);
    try {
      const opportunities = providers.merchantWorkspace.listOpportunities(
        ownerId,
        c.req.param('id'),
      );
      return c.json(MerchantOpportunityListSchema.parse({ opportunities }));
    } catch (error) {
      if (error instanceof MerchantSessionDeletedError) return c.json(SESSION_ENDED, 401);
      if (error instanceof MerchantNotFoundError) return c.json(NOT_FOUND, 404);
      throw error;
    }
  });

  return routes;
}
