/** Public catalog research. Owner: L4, user-directed merchant expansion. No shopper data. */
import { z } from 'zod';
import { idSchema, MoneySchema } from './common';
import { CountryCodeSchema, CurrencyCodeSchema, SampleOriginSchema } from './intent';
import { MerchantIdentitySchema, ProductOfferSchema } from './shopping';

export const MerchantResearchRequestSchema = z.strictObject({
  country: CountryCodeSchema,
  currency: CurrencyCodeSchema,
  category: z.string().trim().min(1).max(80).optional(),
});
export type MerchantResearchRequest = z.infer<typeof MerchantResearchRequestSchema>;

export const ResearchedBrandSchema = z.strictObject({
  merchant: MerchantIdentitySchema,
  products: z.array(ProductOfferSchema).min(1).max(8),
  reason: z.string().min(1),
});
export type ResearchedBrand = z.infer<typeof ResearchedBrandSchema>;

export const MerchantResearchSchema = z.strictObject({
  merchantId: idSchema('mer_'),
  sampleOrigin: SampleOriginSchema,
  country: CountryCodeSchema,
  currency: CurrencyCodeSchema,
  createdAt: z.iso.datetime(),
  status: z.enum(['ready', 'partial', 'empty']),
  category: z.string().min(1),
  complementaryCategories: z.array(z.string().min(1)).max(5),
  comparisonProducts: z.array(ProductOfferSchema).max(150),
  bundles: z
    .array(
      z.strictObject({
        ownProduct: ProductOfferSchema,
        complementaryProduct: ProductOfferSchema,
        reason: z.string().min(1),
        itemSubtotal: MoneySchema.nullable(),
      }),
    )
    .max(6),
  partners: z.array(ResearchedBrandSchema).max(6),
  competitors: z.array(ResearchedBrandSchema).max(6),
  gaps: z.array(z.string().min(1)).max(12),
});
export type MerchantResearch = z.infer<typeof MerchantResearchSchema>;
