import { type IntentBrief, IntentBriefSchema, ShoppingDomainSchema } from '@sei/contracts';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { describeIntentFailure, SESSION_ENDED } from '../errors';
import type { AppProviders } from '../providers';
import { RevisionConflictError } from '../services/intake';
import { SESSION_COOKIE } from '../services/session';

const createInput = z
  .strictObject({
    domain: ShoppingDomainSchema,
    text: z.string().trim().min(8).max(2000).optional(),
    assetId: z.string().min(1).optional(),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .default('CA'),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('CAD'),
  })
  .refine((value) => Boolean(value.text) !== Boolean(value.assetId), {
    message: 'Provide one text description or one private asset.',
  });

const updateInput = z.strictObject({
  expectedRevision: z.number().int().positive(),
  status: z.enum(['draft', 'confirmed']),
  slots: IntentBriefSchema.shape.slots,
  country: IntentBriefSchema.shape.country,
  currency: IntentBriefSchema.shape.currency,
  itemBudget: IntentBriefSchema.shape.itemBudget,
});

export function briefRoutes(providers: AppProviders): Hono {
  const routes = new Hono();
  routes.post('/briefs', async (c) => {
    const ownerId = getCookie(c, SESSION_COOKIE);
    if (!providers.sessions.valid(ownerId))
      return c.json(
        { error: { code: 'UNAUTHORIZED', message: 'Start a private session first.' } },
        401,
      );
    const input = createInput.safeParse(await c.req.json().catch(() => null));
    if (!input.success)
      return c.json(
        {
          error: {
            code: 'INVALID_BRIEF',
            message: 'Choose a domain and describe the collection in at least eight characters.',
          },
        },
        400,
      );
    const source = input.data.text
      ? { kind: 'text' as const, text: input.data.text }
      : (() => {
          const record = providers.intake.readAsset(
            ownerId,
            input.data.assetId ?? '',
            providers.now(),
          );
          return record
            ? { kind: 'image' as const, asset: record.asset, bytes: record.bytes }
            : null;
        })();
    if (!source)
      return c.json(
        {
          error: {
            code: 'ASSET_NOT_FOUND',
            message: 'That private image is unavailable or expired.',
          },
        },
        404,
      );
    let brief: IntentBrief;
    try {
      brief = await providers.intent.createDraft(
        {
          domain: input.data.domain,
          source,
          country: input.data.country,
          currency: input.data.currency,
        },
        c.req.raw.signal,
      );
    } catch (error) {
      const failure = describeIntentFailure(error);
      if (!failure) throw error;
      return c.json(failure.body, failure.status);
    }
    // The session may have been deleted while the model ran: never store a draft for it.
    if (!providers.sessions.valid(ownerId)) return c.json(SESSION_ENDED, 401);
    providers.intake.saveBrief(ownerId, brief, null);
    return c.json(brief, 201);
  });
  routes.get('/briefs/:id', (c) => {
    const ownerId = getCookie(c, SESSION_COOKIE);
    if (!providers.sessions.valid(ownerId)) return c.notFound();
    const brief = providers.intake.getBrief(ownerId, c.req.param('id'));
    return brief ? c.json(brief) : c.notFound();
  });
  routes.patch('/briefs/:id', async (c) => {
    const ownerId = getCookie(c, SESSION_COOKIE);
    if (!providers.sessions.valid(ownerId)) return c.notFound();
    const current = providers.intake.getBrief(ownerId, c.req.param('id'));
    if (!current) return c.notFound();
    const input = updateInput.safeParse(await c.req.json().catch(() => null));
    if (!input.success)
      return c.json(
        { error: { code: 'INVALID_BRIEF', message: 'Review the brief fields and constraints.' } },
        400,
      );
    const { expectedRevision, ...changes } = input.data;
    const next = IntentBriefSchema.safeParse({
      ...current,
      ...changes,
      revision: expectedRevision + 1,
    });
    if (!next.success)
      return c.json(
        {
          error: {
            code: 'INVALID_BRIEF',
            message: next.error.issues[0]?.message ?? 'Invalid brief.',
          },
        },
        400,
      );
    try {
      providers.intake.saveBrief(ownerId, next.data, expectedRevision);
      // A new revision supersedes any search still running for the old one.
      providers.runner.invalidate(next.data.id, next.data.revision);
      // It also changes what any cohort built on the old revision meant. The ledger cannot
      // observe a brief edit, so published evidence is dropped until it is recomputed.
      providers.demandProjection.invalidate();
      return c.json(next.data);
    } catch (error) {
      if (error instanceof RevisionConflictError)
        return c.json({ error: { code: 'REVISION_CONFLICT', message: error.message } }, 409);
      throw error;
    }
  });
  return routes;
}
