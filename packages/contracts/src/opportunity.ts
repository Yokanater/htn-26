/** Merchant-safe opportunity DTO. Owner: L3. Design v3 §§6–7. No private shopper references. */
import { z } from 'zod';
import { idSchema } from './common';
import { MerchantDemandSummarySchema, SupportBandSchema } from './demand';
import { MerchantIdentitySchema } from './shopping';

export const MerchantOpportunitySchema = z
  .strictObject({
    id: idSchema('opp_'),
    merchants: z.tuple([MerchantIdentitySchema, MerchantIdentitySchema]),
    basis: z.enum(['observed_pair', 'inferred_supply_fit']),
    demand: MerchantDemandSummarySchema,
    observedPairSupport: SupportBandSchema.nullable(),
    productEvidenceIds: z.array(idSchema('ev_')).min(1),
    proposedExperiment: z.string().min(1),
    uncertainties: z.array(z.string().min(1)).min(1),
  })
  .superRefine((opportunity, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (
      opportunity.merchants[0].id === opportunity.merchants[1].id ||
      opportunity.merchants[0].domain === opportunity.merchants[1].domain
    )
      fail('A collaboration needs distinct merchants');
    if (opportunity.demand.status !== 'available') fail('An opportunity needs an eligible cohort');
    if (opportunity.basis === 'inferred_supply_fit' && opportunity.observedPairSupport !== null)
      fail('Inferred supply fit cannot claim observed pair support');
    if (opportunity.basis === 'observed_pair') {
      const support = opportunity.observedPairSupport;
      if (!support || support.min < opportunity.demand.minimumSessions)
        fail('Observed pairs must meet the publication threshold');
      if (
        support &&
        opportunity.demand.eligibleSessions &&
        support.max > opportunity.demand.eligibleSessions.max
      )
        fail('Pair support cannot exceed cohort support');
    }
  });
export type MerchantOpportunity = z.infer<typeof MerchantOpportunitySchema>;
