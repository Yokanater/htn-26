/** S4 shared merchant workflow DTOs. No shopper records or provider credentials. */
import { z } from 'zod';
import { idSchema } from './common';
import { SampleOriginSchema, ShoppingDomainSchema } from './intent';
import { MerchantOpportunitySchema } from './opportunity';
import { MerchantIdentitySchema, ProductOfferSchema, PublicHttpsUrlSchema } from './shopping';

export const MerchantProfileSchema = z.strictObject({
  id: idSchema('prof_'),
  merchant: MerchantIdentitySchema,
  domain: ShoppingDomainSchema,
  sampleOrigin: SampleOriginSchema,
  offers: z.array(ProductOfferSchema).max(32),
  confirmed: z.boolean(),
  capturedAt: z.iso.datetime(),
  warnings: z.array(z.string()),
  discoveredFor: idSchema('prof_').optional(),
});
export type MerchantProfile = z.infer<typeof MerchantProfileSchema>;

export const MerchantProgressSchema = z.strictObject({
  sequence: z.number().int().nonnegative(),
  at: z.iso.datetime(),
  stage: z.enum([
    'queued',
    'browser',
    'extract',
    'verify',
    'discover',
    'ready',
    'failed',
    'cancelled',
  ]),
  message: z.string(),
  productCount: z.number().int().nonnegative(),
});
export type MerchantProgress = z.infer<typeof MerchantProgressSchema>;
export const MerchantRunSchema = z.strictObject({
  id: idSchema('run_'),
  status: z.enum(['running', 'ready', 'failed', 'cancelled']),
  sampleOrigin: SampleOriginSchema,
  events: z.array(MerchantProgressSchema),
  liveViewUrl: PublicHttpsUrlSchema.nullable(),
  profile: MerchantProfileSchema.nullable(),
});
export type MerchantRun = z.infer<typeof MerchantRunSchema>;

export const CollaborationDraftSchema = z.strictObject({
  id: idSchema('act_'),
  revision: z.number().int().positive(),
  opportunity: MerchantOpportunitySchema,
  title: z.string().min(1).max(160),
  hypothesis: z.string().min(1).max(2000),
  experiment: z.string().min(1).max(2000),
  outreach: z.string().min(1).max(5000),
  merchantNotes: z.string().max(5000),
  generatedBy: z.enum(['template', 'baseten']),
  warnings: z.array(z.string()),
  updatedAt: z.iso.datetime(),
});
export type CollaborationDraft = z.infer<typeof CollaborationDraftSchema>;
