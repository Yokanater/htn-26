/** Public bootstrap API DTOs. Owner: L4. Feature route DTOs land with their S1–S5 cards. */
import { z } from 'zod';
import { ShoppingDomainSchema } from './intent';

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
