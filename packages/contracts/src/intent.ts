/** Shopper intent contracts. Owner: L3. Design v3 §§4–5. Browser-safe domain DTOs. */
import { z } from 'zod';
import { idSchema, MoneySchema } from './common';

export const ShoppingDomainSchema = z.enum(['outfit', 'setup']);
export type ShoppingDomain = z.infer<typeof ShoppingDomainSchema>;
export const SampleOriginSchema = z.enum(['live', 'seed', 'replay']);
export type SampleOrigin = z.infer<typeof SampleOriginSchema>;
export const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/);
export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);
export const PriceSchema = MoneySchema.refine(
  (money) => money.amount >= 0,
  'Price cannot be negative',
);

export const InspirationAssetSchema = z.strictObject({
  id: idSchema('asset_'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  byteLength: z
    .number()
    .int()
    .positive()
    .max(8 * 1024 * 1024),
  expiresAt: z.iso.datetime(),
});
export type InspirationAsset = z.infer<typeof InspirationAssetSchema>;

export const ItemConstraintSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('size'),
    value: z.string().min(1).max(80),
  }),
  z.strictObject({
    kind: z.literal('dimension'),
    axis: z.enum(['width', 'depth', 'height']),
    maxCm: z.number().positive(),
  }),
  z.strictObject({ kind: z.literal('mounting'), value: z.enum(['no_drilling', 'freestanding']) }),
  z.strictObject({ kind: z.literal('exclude_material'), value: z.string().min(1).max(80) }),
]);
export type ItemConstraint = z.infer<typeof ItemConstraintSchema>;

export const IntentSlotSchema = z.strictObject({
  id: idSchema('slot_'),
  category: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  required: z.boolean(),
  visualAttributes: z.array(z.string().min(1).max(80)).max(12),
  constraints: z.array(ItemConstraintSchema).max(12),
});
export type IntentSlot = z.infer<typeof IntentSlotSchema>;

export const IntentBriefSchema = z
  .strictObject({
    id: idSchema('brief_'),
    domain: ShoppingDomainSchema,
    revision: z.number().int().positive(),
    status: z.enum(['draft', 'confirmed']),
    input: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('image'), assetId: idSchema('asset_') }),
      z.strictObject({ kind: z.literal('text'), text: z.string().min(1).max(2000) }),
    ]),
    slots: z.array(IntentSlotSchema).min(2).max(6),
    country: CountryCodeSchema,
    currency: CurrencyCodeSchema,
    itemBudget: PriceSchema.nullable(),
    sampleOrigin: SampleOriginSchema,
    createdAt: z.iso.datetime(),
  })
  .superRefine((brief, ctx) => {
    if (new Set(brief.slots.map((slot) => slot.id)).size !== brief.slots.length) {
      ctx.addIssue({ code: 'custom', path: ['slots'], message: 'Slot IDs must be unique' });
    }
    if (!brief.slots.some((slot) => slot.required)) {
      ctx.addIssue({
        code: 'custom',
        path: ['slots'],
        message: 'At least one slot must be required',
      });
    }
    if (brief.itemBudget && brief.itemBudget.currency !== brief.currency) {
      ctx.addIssue({
        code: 'custom',
        path: ['itemBudget'],
        message: 'Budget currency must match brief',
      });
    }
    for (const [index, slot] of brief.slots.entries()) {
      if (
        slot.constraints.some((c) =>
          brief.domain === 'outfit'
            ? c.kind === 'dimension' || c.kind === 'mounting'
            : c.kind === 'size',
        )
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['slots', index, 'constraints'],
          message: 'Constraint belongs to the other domain',
        });
      }
    }
  });
export type IntentBrief = z.infer<typeof IntentBriefSchema>;
