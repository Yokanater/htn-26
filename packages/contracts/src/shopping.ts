/** Offers/evidence: L1. Collection results: L2. Design v3 §§4–5. */
import { z } from 'zod';
import { idSchema } from './common';
import { CountryCodeSchema, PriceSchema, SampleOriginSchema } from './intent';

/** Syntax only: network adapters must also validate DNS, IPs and every redirect. */
export const PublicHttpsUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
}, 'Expected HTTPS URL without credentials');

export const MerchantIdentitySchema = z.strictObject({
  id: idSchema('mer_'),
  name: z.string().min(1),
  domain: z.string().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
});
export type MerchantIdentity = z.infer<typeof MerchantIdentitySchema>;

export const ProductEvidenceSchema = z.strictObject({
  id: idSchema('ev_'),
  field: z.string().min(1),
  value: z.string().min(1),
  url: PublicHttpsUrlSchema,
  capturedAt: z.iso.datetime(),
  method: z.enum(['catalog', 'fetch', 'browser']),
});
export type ProductEvidence = z.infer<typeof ProductEvidenceSchema>;

export const ProductOfferSchema = z.strictObject({
  id: idSchema('offer_'),
  merchant: MerchantIdentitySchema,
  productId: z.string().min(1),
  variantId: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  productUrl: PublicHttpsUrlSchema,
  imageUrl: PublicHttpsUrlSchema.nullable(),
  price: PriceSchema.nullable(),
  availability: z.enum(['available', 'unavailable', 'unknown']),
  shipsTo: z.array(CountryCodeSchema).nullable(),
  attributes: z.record(z.string(), z.union([z.string(), z.number()])),
  evidence: z.array(ProductEvidenceSchema).min(1),
  sampleOrigin: SampleOriginSchema,
});
export type ProductOffer = z.infer<typeof ProductOfferSchema>;

export const ConstraintCheckSchema = z.strictObject({
  key: z.string().min(1),
  status: z.enum(['pass', 'fail', 'unknown']),
  evidenceIds: z.array(idSchema('ev_')),
  explanation: z.string().min(1),
});
export type ConstraintCheck = z.infer<typeof ConstraintCheckSchema>;

export const SlotMatchSchema = z.strictObject({
  slotId: idSchema('slot_'),
  selectedOfferId: idSchema('offer_').nullable(),
  alternativeOfferIds: z.array(idSchema('offer_')).max(8),
  required: z.boolean(),
  checks: z.array(ConstraintCheckSchema),
});
export type SlotMatch = z.infer<typeof SlotMatchSchema>;

export const CollectionMatchSchema = z
  .strictObject({
    id: idSchema('match_'),
    briefId: idSchema('brief_'),
    briefRevision: z.number().int().positive(),
    status: z.enum(['ready', 'partial', 'no_match']),
    slots: z.array(SlotMatchSchema).min(2).max(6),
    itemSubtotal: PriceSchema.nullable(),
    excludesShippingAndTax: z.literal(true),
    warnings: z.array(z.string()),
    sampleOrigin: SampleOriginSchema,
  })
  .superRefine((match, ctx) => {
    if (new Set(match.slots.map((slot) => slot.slotId)).size !== match.slots.length) {
      ctx.addIssue({ code: 'custom', path: ['slots'], message: 'Slot IDs must be unique' });
    }
    if (
      match.status === 'ready' &&
      (match.itemSubtotal === null ||
        match.slots.some(
          (slot) =>
            (slot.required && slot.selectedOfferId === null) ||
            (slot.selectedOfferId !== null && slot.checks.some((check) => check.status !== 'pass')),
        ))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Ready requires priced coverage and no unresolved selected-offer checks',
      });
    }
    if (match.status === 'no_match' && match.slots.some((slot) => slot.selectedOfferId !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'No-match cannot include a selected offer',
      });
    }
  });
export type CollectionMatch = z.infer<typeof CollectionMatchSchema>;
