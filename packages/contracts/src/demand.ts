/** Private demand ledger and privacy-safe published summaries. Owner: L2; consent/API review L4. */
import { z } from 'zod';
import { idSchema } from './common';
import {
  CountryCodeSchema,
  CurrencyCodeSchema,
  SampleOriginSchema,
  ShoppingDomainSchema,
} from './intent';

export const ConsentRecordSchema = z.strictObject({
  sessionId: idSchema('sess_'),
  version: z.number().int().positive(),
  state: z.enum(['granted', 'declined', 'withdrawn']),
  updatedAt: z.iso.datetime(),
});
export type ConsentRecord = z.infer<typeof ConsentRecordSchema>;

export const DemandSelectionSchema = z.strictObject({
  slotId: idSchema('slot_'),
  offerId: idSchema('offer_'),
  merchantId: idSchema('mer_'),
});
export const DemandEventSchema = z
  .strictObject({
    id: idSchema('evt_'),
    sessionId: idSchema('sess_'),
    briefId: idSchema('brief_'),
    briefRevision: z.number().int().positive(),
    consentVersion: z.number().int().positive().nullable(),
    occurredAt: z.iso.datetime(),
    sampleOrigin: SampleOriginSchema,
    kind: z.enum([
      'brief_confirmed',
      'item_accepted',
      'item_rejected',
      'collection_saved',
      'offer_requested',
    ]),
    matchId: idSchema('match_').nullable(),
    selections: z.array(DemandSelectionSchema).max(6),
    rejectionReason: z
      .enum([
        'price',
        'style',
        'size',
        'dimensions',
        'material',
        'shipping',
        'availability',
        'other',
      ])
      .nullable(),
  })
  .superRefine((event, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (event.kind === 'brief_confirmed') {
      if (event.matchId !== null || event.selections.length !== 0)
        fail('Brief confirmation cannot imply product selection');
    } else if (event.matchId === null || event.selections.length === 0) {
      fail('Product decisions require the displayed match and explicit selections');
    }
    if (event.kind.startsWith('item_') && event.selections.length !== 1)
      fail('Item decision requires exactly one selection');
    if ((event.kind === 'item_rejected') !== (event.rejectionReason !== null))
      fail('Only rejection events require a rejection reason');
    if (new Set(event.selections.map((s) => s.slotId)).size !== event.selections.length)
      fail('Cannot select a slot twice');
  });
export type DemandEvent = z.infer<typeof DemandEventSchema>;

export const DemandCohortSchema = z
  .strictObject({
    domain: ShoppingDomainSchema,
    country: CountryCodeSchema,
    currency: CurrencyCodeSchema,
    categories: z.array(z.string().min(1)).min(1).max(6),
  })
  .refine(
    (cohort) => new Set(cohort.categories).size === cohort.categories.length,
    'Categories must be unique',
  );
export type DemandCohort = z.infer<typeof DemandCohortSchema>;

/** Design v3 §6.2 keeps the denominator, merchant support, pair support and gaps separate. */
export const DemandGapSchema = z.strictObject({
  kind: z.enum(['unmet_requirement', 'rejection']),
  /** A rejection reason code, or the confirmed category that nothing satisfied. */
  reason: z.string().min(1),
  sessions: z.number().int().nonnegative(),
});

/** Private exact counts: NEVER serialize this schema to a merchant. */
export const DemandAggregateSchema = z
  .strictObject({
    id: idSchema('agg_'),
    version: z.number().int().positive(),
    cohort: DemandCohortSchema,
    windowStart: z.iso.datetime(),
    windowEnd: z.iso.datetime(),
    sampleOrigin: SampleOriginSchema,
    eligibleSessions: z.number().int().nonnegative(),
    pairs: z.array(
      z.strictObject({
        merchantIds: z.tuple([idSchema('mer_'), idSchema('mer_')]),
        supportingSessions: z.number().int().nonnegative(),
      }),
    ),
    /** Distinct sessions that explicitly selected at least one offer from the merchant. */
    merchantSupport: z
      .array(
        z.strictObject({
          merchantId: idSchema('mer_'),
          supportingSessions: z.number().int().nonnegative(),
        }),
      )
      .optional(),
    gaps: z.array(DemandGapSchema).optional(),
  })
  .superRefine((aggregate, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (aggregate.windowStart >= aggregate.windowEnd) fail('Window must be increasing');

    const support = new Map<string, number>();
    for (const entry of aggregate.merchantSupport ?? []) {
      if (support.has(entry.merchantId)) fail('A merchant can only be counted once');
      if (entry.supportingSessions > aggregate.eligibleSessions)
        fail('Merchant support cannot exceed the denominator');
      support.set(entry.merchantId, entry.supportingSessions);
    }

    const seen = new Set<string>();
    for (const pair of aggregate.pairs) {
      const key = [...pair.merchantIds].sort().join('|');
      if (pair.merchantIds[0] === pair.merchantIds[1] || seen.has(key))
        fail('Pair must contain two distinct merchants and occur once');
      if (pair.supportingSessions > aggregate.eligibleSessions)
        fail('Pair support cannot exceed the denominator');
      // A pairing cannot have more supporting sessions than either merchant in it.
      for (const merchantId of pair.merchantIds) {
        const merchantSupport = support.get(merchantId);
        if (merchantSupport !== undefined && pair.supportingSessions > merchantSupport)
          fail('Pair support cannot exceed either merchant support');
      }
      seen.add(key);
    }

    const gapKeys = new Set<string>();
    for (const gap of aggregate.gaps ?? []) {
      const key = `${gap.kind}|${gap.reason}`;
      if (gapKeys.has(key)) fail('A gap reason can only be counted once');
      if (gap.sessions > aggregate.eligibleSessions)
        fail('Gap sessions cannot exceed the denominator');
      gapKeys.add(key);
    }
  });
export type DemandAggregate = z.infer<typeof DemandAggregateSchema>;

/** Bands are published instead of live exact counts; suppression also applies to every subcell. */
export const SupportBandSchema = z
  .strictObject({
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
  })
  .refine((band) => band.max > band.min, 'Published support must be a range, not an exact count');
export const MerchantDemandSummarySchema = z
  .strictObject({
    aggregateId: idSchema('agg_'),
    aggregateVersion: z.number().int().positive(),
    cohort: DemandCohortSchema,
    windowStart: z.iso.datetime(),
    windowEnd: z.iso.datetime(),
    sampleOrigin: SampleOriginSchema,
    status: z.enum(['insufficient_evidence', 'available']),
    minimumSessions: z.number().int().min(5),
    eligibleSessions: SupportBandSchema.nullable(),
    pairSupport: z
      .array(
        z.strictObject({
          merchantIds: z.tuple([idSchema('mer_'), idSchema('mer_')]),
          support: SupportBandSchema,
        }),
      )
      .optional(),
    /** Published as bands; every cell is suppressed below `minimumSessions`. */
    merchantSupport: z
      .array(z.strictObject({ merchantId: idSchema('mer_'), support: SupportBandSchema }))
      .optional(),
    gaps: z
      .array(
        z.strictObject({
          kind: DemandGapSchema.shape.kind,
          reason: DemandGapSchema.shape.reason,
          support: SupportBandSchema,
        }),
      )
      .optional(),
  })
  .superRefine((summary, ctx) => {
    if (summary.windowStart >= summary.windowEnd)
      ctx.addIssue({ code: 'custom', message: 'Window must be increasing' });
    if (summary.status === 'insufficient_evidence' && summary.eligibleSessions !== null)
      ctx.addIssue({ code: 'custom', message: 'Suppressed cohorts must not disclose counts' });
    if (
      summary.status === 'insufficient_evidence' &&
      (summary.merchantSupport?.length || summary.pairSupport?.length || summary.gaps?.length)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Suppressed cohorts must not disclose a breakdown',
      });
    for (const band of [
      ...(summary.merchantSupport ?? []).map((entry) => entry.support),
      ...(summary.pairSupport ?? []).map((entry) => entry.support),
      ...(summary.gaps ?? []).map((gap) => gap.support),
    ]) {
      if (band.min < summary.minimumSessions)
        ctx.addIssue({
          code: 'custom',
          message: 'Every published cell must meet the publication threshold',
        });
    }
    if (
      summary.status === 'available' &&
      (!summary.eligibleSessions || summary.eligibleSessions.min < summary.minimumSessions)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Available cohorts must meet the publication threshold',
      });
  });
export type MerchantDemandSummary = z.infer<typeof MerchantDemandSummarySchema>;
