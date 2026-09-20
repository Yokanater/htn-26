/** Public bootstrap API DTOs. Owner: L4. Feature route DTOs land with their S1–S5 cards. */
import { z } from 'zod';
import { idSchema } from './common';
import { SampleOriginSchema, ShoppingDomainSchema } from './intent';
import { MerchantOpportunitySchema } from './opportunity';
import { MerchantIdentitySchema } from './shopping';

export const CapabilitiesSchema = z.strictObject({
  planVersion: z.literal('3.0'),
  schemaVersion: z.string(),
  milestoneFamily: z.enum(['legacy', 'intent']),
  milestones: z.array(z.string()),
  sections: z.array(z.string()),
  domains: z.array(ShoppingDomainSchema).length(2),
  flags: z.record(z.string(), z.boolean()),
  implementation: z.literal('bootstrap'),
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

const RejectionReasonSchema = z.enum([
  'price',
  'style',
  'size',
  'dimensions',
  'material',
  'shipping',
  'availability',
  'other',
]);

/** Client selection: merchantId is derived on the server from the completed run. */
export const DecisionSelectionInputSchema = z.strictObject({
  slotId: idSchema('slot_'),
  offerId: idSchema('offer_'),
});
export type DecisionSelectionInput = z.infer<typeof DecisionSelectionInputSchema>;

const uniqueSlots = (selections: ReadonlyArray<{ slotId: string }>, ctx: z.RefinementCtx): void => {
  if (new Set(selections.map((item) => item.slotId)).size !== selections.length) {
    ctx.addIssue({ code: 'custom', path: ['selections'], message: 'Cannot select a slot twice' });
  }
};

/** Shopper decision body. Never a DemandEvent: server owns id/session/origin/consent/merchant. */
export const DecisionRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('brief_confirmed'),
    briefRevision: z.number().int().positive(),
  }),
  z.strictObject({
    kind: z.literal('item_accepted'),
    runId: idSchema('run_'),
    matchId: idSchema('match_'),
    selections: z.array(DecisionSelectionInputSchema).length(1),
    rejectionReason: z.null().optional(),
    briefRevision: z.number().int().positive(),
  }),
  z.strictObject({
    kind: z.literal('item_rejected'),
    runId: idSchema('run_'),
    matchId: idSchema('match_'),
    selections: z.array(DecisionSelectionInputSchema).length(1),
    rejectionReason: RejectionReasonSchema,
    briefRevision: z.number().int().positive(),
  }),
  z
    .strictObject({
      kind: z.literal('collection_saved'),
      runId: idSchema('run_'),
      matchId: idSchema('match_'),
      selections: z.array(DecisionSelectionInputSchema).min(1).max(6),
      rejectionReason: z.null().optional(),
      briefRevision: z.number().int().positive(),
    })
    .superRefine((value, ctx) => uniqueSlots(value.selections, ctx)),
  z
    .strictObject({
      kind: z.literal('offer_requested'),
      runId: idSchema('run_'),
      matchId: idSchema('match_'),
      selections: z.array(DecisionSelectionInputSchema).min(1).max(6),
      rejectionReason: z.null().optional(),
      briefRevision: z.number().int().positive(),
    })
    .superRefine((value, ctx) => uniqueSlots(value.selections, ctx)),
]);
export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;

export const ConsentUpdateRequestSchema = z.strictObject({
  state: z.enum(['granted', 'declined', 'withdrawn']),
  expectedVersion: z.number().int().positive().nullable(),
});
export type ConsentUpdateRequest = z.infer<typeof ConsentUpdateRequestSchema>;

export const MerchantProfileRequestSchema = z.strictObject({
  url: z.string().min(1).max(500),
});
export type MerchantProfileRequest = z.infer<typeof MerchantProfileRequestSchema>;

export const MerchantWorkspaceProfileSchema = z.strictObject({
  merchant: MerchantIdentitySchema,
  sampleOrigin: SampleOriginSchema,
  categories: z.array(z.string().min(1)).min(1),
  evidenceIds: z.array(idSchema('ev_')).min(1),
  workspace: z.literal('synthetic_demo'),
});
export type MerchantWorkspaceProfile = z.infer<typeof MerchantWorkspaceProfileSchema>;

export const MerchantOpportunityListSchema = z.strictObject({
  opportunities: z.array(MerchantOpportunitySchema),
});
export type MerchantOpportunityList = z.infer<typeof MerchantOpportunityListSchema>;

export const CreateMerchantDraftRequestSchema = z.strictObject({});
export type CreateMerchantDraftRequest = z.infer<typeof CreateMerchantDraftRequestSchema>;

export const PatchMerchantDraftRequestSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  proposalText: z.string().trim().min(1).max(4000),
  uncertainties: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
});
export type PatchMerchantDraftRequest = z.infer<typeof PatchMerchantDraftRequestSchema>;

export const MerchantCollaborationDraftSchema = z.strictObject({
  id: idSchema('draft_'),
  version: z.number().int().positive(),
  merchantId: idSchema('mer_'),
  opportunityId: idSchema('opp_'),
  aggregateId: idSchema('agg_'),
  aggregateVersion: z.number().int().positive(),
  sampleOrigin: SampleOriginSchema,
  proposalText: z.string().min(1),
  uncertainties: z.array(z.string().min(1)).min(1),
  evidenceIds: z.array(idSchema('ev_')).min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type MerchantCollaborationDraft = z.infer<typeof MerchantCollaborationDraftSchema>;
