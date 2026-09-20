/** Merchant demo profile. Owner: L4 (S4-L4-1). Design v3 §8. Not store ownership. */

import { randomUUID } from 'node:crypto';
import type { MerchantResearch } from '@sei/contracts';
import {
  MerchantDemandSummarySchema,
  MerchantOpportunityListSchema,
  MerchantProfileRequestSchema,
  MerchantResearchRequestSchema,
  MerchantResearchSchema,
  MerchantWorkspaceProfileSchema,
  ProductOfferSchema,
} from '@sei/contracts';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { errorBody, SESSION_ENDED } from '../errors';
import type { AppProviders } from '../providers';
import { MerchantProfilerError } from '../services/merchant-catalog';
import { MerchantResearchError, researchCategory } from '../services/merchant-research';
import { MerchantCatalogDisabledError, MerchantUrlError } from '../services/merchant-url';
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
  const jobs = new Map<
    string,
    {
      owner: string;
      merchant: string;
      fingerprint: string;
      request: string;
      expires: number;
      controller: AbortController;
      result?: MerchantResearch;
      progress?: { stage: string; completed: number; total: number };
      error?: { code: string; message: string };
      done: boolean;
    }
  >();
  routes.get('/merchants/:id/research/jobs/:jobId', (c) => {
    const owner = getCookie(c, SESSION_COOKIE);
    const job = jobs.get(c.req.param('jobId'));
    if (!providers.sessions.valid(owner)) return c.json(SESSION_ENDED, 401);
    if (!job || job.owner !== owner || job.merchant !== c.req.param('id'))
      return c.json(NOT_FOUND, 404);
    if (job.expires < Date.now()) {
      job.controller.abort();
      jobs.delete(c.req.param('jobId'));
      return c.json(errorBody('RESEARCH_EXPIRED', 'Search expired. Start a new search.'), 410);
    }
    try {
      if (
        JSON.stringify(providers.merchantWorkspace.catalogOffers(owner, job.merchant)) !==
        job.fingerprint
      ) {
        job.controller.abort();
        return c.json(
          errorBody('STALE_PROFILE', 'Store profile changed. Start a new search.'),
          409,
        );
      }
    } catch {
      job.controller.abort();
      return c.json(NOT_FOUND, 404);
    }
    return c.json(
      job.done
        ? job.error
          ? { status: 'failed', error: job.error }
          : { status: 'complete', result: job.result }
        : { status: 'running', progress: job.progress },
    );
  });
  routes.delete('/merchants/:id/research/jobs/:jobId', (c) => {
    const owner = getCookie(c, SESSION_COOKIE);
    const job = jobs.get(c.req.param('jobId'));
    if (!providers.sessions.valid(owner)) return c.json(SESSION_ENDED, 401);
    if (!job || job.owner !== owner || job.merchant !== c.req.param('id'))
      return c.json(NOT_FOUND, 404);
    job.controller.abort();
    jobs.delete(c.req.param('jobId'));
    return c.json({ cancelled: true });
  });

  routes.get('/merchants/:id/demand', async (c) => {
    const ownerId = getCookie(c, SESSION_COOKIE);
    if (!providers.sessions.valid(ownerId)) return c.json(SESSION_ENDED, 401);
    try {
      const offers = providers.merchantWorkspace.catalogOffers(ownerId, c.req.param('id'));
      const categories = new Set(offers.map((p) => researchCategory(p.category)));
      const summaries = await providers.demandProjection.merchantSummaries();
      if (!providers.sessions.valid(ownerId)) return c.json(SESSION_ENDED, 401);
      return c.json(
        MerchantDemandSummarySchema.array().parse(
          summaries.filter(
            (s) =>
              s.status === 'available' &&
              s.cohort.categories.some((category) => categories.has(researchCategory(category))),
          ),
        ),
      );
    } catch (error) {
      if (error instanceof MerchantNotFoundError) return c.json(NOT_FOUND, 404);
      throw error;
    }
  });

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
      if (error instanceof MerchantCatalogDisabledError)
        return c.json(errorBody('MERCHANT_CATALOG_DISABLED', error.message), 503);
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

  routes.get('/merchants/:id/catalog', (c) => {
    const ownerId = getCookie(c, SESSION_COOKIE);
    if (!providers.sessions.valid(ownerId))
      return c.json(errorBody('UNAUTHORIZED', 'Start a private session first.'), 401);
    try {
      return c.json(
        ProductOfferSchema.array().parse(
          providers.merchantWorkspace.catalogOffers(ownerId, c.req.param('id')),
        ),
      );
    } catch (error) {
      if (error instanceof MerchantSessionDeletedError) return c.json(SESSION_ENDED, 401);
      if (error instanceof MerchantNotFoundError) return c.json(NOT_FOUND, 404);
      throw error;
    }
  });
  routes.post('/merchants/:id/research', async (c) => {
    const ownerId = getCookie(c, SESSION_COOKIE);
    if (!providers.sessions.valid(ownerId))
      return c.json(errorBody('UNAUTHORIZED', 'Start a private session first.'), 401);
    const request = MerchantResearchRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!request.success)
      return c.json(
        errorBody('INVALID_REQUEST', 'Choose a country, currency and catalog category.'),
        400,
      );
    try {
      const offers = providers.merchantWorkspace.catalogOffers(ownerId, c.req.param('id'));
      const fingerprint = JSON.stringify(offers);
      if (c.req.header('Prefer') === 'respond-async') {
        for (const [id, job] of jobs)
          if (job.expires < Date.now()) {
            job.controller.abort();
            jobs.delete(id);
          }
        const requestKey = JSON.stringify(request.data);
        for (const [jobId, job] of jobs)
          if (
            job.owner === ownerId &&
            job.merchant === c.req.param('id') &&
            job.fingerprint === fingerprint &&
            job.request === requestKey &&
            !job.done
          )
            return c.json({ jobId }, 202);
        if (jobs.size >= 100)
          return c.json(errorBody('BUSY', 'Search service is busy. Try again shortly.'), 503);
        const jobId = randomUUID();
        const job: typeof jobs extends Map<string, infer V> ? V : never = {
          owner: ownerId,
          merchant: c.req.param('id'),
          fingerprint,
          request: requestKey,
          expires: Date.now() + 15 * 60_000,
          controller: new AbortController(),
          done: false,
        };
        jobs.set(jobId, job);
        const watch = setInterval(() => {
          if (!providers.sessions.valid(ownerId) || job.expires < Date.now()) {
            job.controller.abort();
            jobs.delete(jobId);
          }
        }, 2000);
        watch.unref();
        void providers.merchantResearch
          .research(offers, request.data, job.controller.signal, (progress) => {
            job.progress = progress;
          })
          .then((result) => {
            if (!job.controller.signal.aborted)
              job.result = MerchantResearchSchema.parse({ ...result, merchantId: job.merchant });
          })
          .catch((error) => {
            console.warn(
              '[merchant-research]',
              JSON.stringify({
                event: 'job_failed',
                errorName: error instanceof Error ? error.name : typeof error,
                code: error instanceof MerchantResearchError ? error.code : 'RESEARCH_FAILED',
              }),
            );
            job.error =
              error instanceof MerchantResearchError
                ? { code: error.code, message: error.message }
                : { code: 'RESEARCH_FAILED', message: 'Search could not finish. Please retry.' };
          })
          .finally(() => {
            job.done = true;
            clearInterval(watch);
          });
        return c.json({ jobId }, 202);
      }
      const result = await providers.merchantResearch.research(
        offers,
        request.data,
        c.req.raw.signal,
      );
      if (!providers.sessions.valid(ownerId)) return c.json(SESSION_ENDED, 401);
      const current = providers.merchantWorkspace.catalogOffers(ownerId, c.req.param('id'));
      if (JSON.stringify(current) !== fingerprint)
        return c.json(
          errorBody('STALE_PROFILE', 'The store profile changed. Run the search again.'),
          409,
        );
      return c.json(MerchantResearchSchema.parse({ ...result, merchantId: c.req.param('id') }));
    } catch (error) {
      if (error instanceof MerchantResearchError)
        return c.json(errorBody(error.code, error.message), error.status);
      if (error instanceof MerchantSessionDeletedError) return c.json(SESSION_ENDED, 401);
      if (error instanceof MerchantNotFoundError) return c.json(NOT_FOUND, 404);
      if (isAbortError(error))
        return c.json(errorBody('CANCELLED', 'Brand search cancelled.'), 409);
      throw error;
    }
  });
  return routes;
}
