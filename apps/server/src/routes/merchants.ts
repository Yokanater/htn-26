import {
  CollaborationDraftSchema,
  PublicHttpsUrlSchema,
  ShoppingDomainSchema,
} from '@sei/contracts';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { errorBody } from '../errors';
import type { AppProviders } from '../providers';
import { MerchantError } from '../services/merchant';
import { SESSION_COOKIE } from '../services/session';

export function merchantRoutes(providers: AppProviders) {
  const routes = new Hono<{ Variables: { owner: string } }>();
  routes.use('*', async (c, next) => {
    if (
      !/^\/api\/(merchants(?:\/|$)|opportunities\/[^/]+\/drafts$|drafts(?:\/|$))/.test(c.req.path)
    )
      return next();
    const owner = getCookie(c, SESSION_COOKIE);
    if (!providers.sessions.valid(owner))
      return c.json(errorBody('UNAUTHORIZED', 'Start a private session first.'), 401);
    c.set('owner', owner);
    try {
      await next();
    } catch (error) {
      if (error instanceof MerchantError)
        return c.json(errorBody(error.code, error.message), error.status);
      throw error;
    }
  });
  routes.onError((error, c) =>
    error instanceof MerchantError
      ? c.json(errorBody(error.code, error.message), error.status)
      : c.json(
          errorBody('MERCHANT_ERROR', 'The merchant operation could not finish. Try again.'),
          500,
        ),
  );
  routes.get('/merchants/settings', (c) => c.json(providers.merchants.settings()));
  routes.get('/merchants/profiles', (c) => c.json(providers.merchants.profiles(c.get('owner'))));
  routes.post('/merchants/profile', async (c) => {
    const input = z
      .strictObject({ url: PublicHttpsUrlSchema.max(2048), domain: ShoppingDomainSchema })
      .safeParse(await c.req.json().catch(() => null));
    if (!input.success)
      return c.json(
        errorBody('INVALID_PROFILE', 'Enter an HTTPS public store URL and a domain.'),
        400,
      );
    return c.json(
      providers.merchants.start(c.get('owner'), input.data.url, input.data.domain),
      202,
    );
  });
  routes.get('/merchants/runs/:id', (c) =>
    c.json(providers.merchants.run(c.get('owner'), c.req.param('id'))),
  );
  routes.delete('/merchants/runs/:id', (c) =>
    c.json(providers.merchants.cancel(c.get('owner'), c.req.param('id'))),
  );
  routes.post('/merchants/profiles/:id/confirm', async (c) => {
    const input = z
      .strictObject({
        categories: z
          .array(
            z.strictObject({ offerId: z.string(), category: z.string().trim().min(1).max(80) }),
          )
          .min(1)
          .max(32),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!input.success)
      return c.json(errorBody('INVALID_CATALOG', 'Review the product categories.'), 400);
    return c.json(
      providers.merchants.confirm(c.get('owner'), c.req.param('id'), input.data.categories),
    );
  });
  routes.get('/merchants/:id/opportunities', async (c) =>
    c.json(await providers.merchants.opportunities(c.get('owner'), c.req.param('id'))),
  );
  routes.post('/opportunities/:id/drafts', async (c) =>
    c.json(await providers.merchants.draft(c.get('owner'), c.req.param('id')), 201),
  );
  routes.get('/drafts/:id', (c) =>
    c.json(providers.merchants.getDraft(c.get('owner'), c.req.param('id'))),
  );
  routes.get('/drafts', (c) => c.json(providers.merchants.drafts(c.get('owner'))));
  routes.patch('/drafts/:id', async (c) => {
    const input = CollaborationDraftSchema.pick({
      title: true,
      experiment: true,
      outreach: true,
      merchantNotes: true,
    })
      .extend({ expectedRevision: z.number().int().positive() })
      .safeParse(await c.req.json().catch(() => null));
    if (!input.success)
      return c.json(errorBody('INVALID_DRAFT', 'Check draft length and revision.'), 400);
    const { expectedRevision, ...edits } = input.data;
    return c.json(
      providers.merchants.saveDraft(c.get('owner'), c.req.param('id'), expectedRevision, edits),
    );
  });
  return routes;
}
