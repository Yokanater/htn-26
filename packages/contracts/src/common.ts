/**
 * @sei/contracts: common primitives. Owner: L4 (Product & Platform).
 *
 * Shared by every lane and by the web app (keep it browser-safe: no node:* imports).
 * Design v3 §4: IDs, money, provenance and additive versioning.
 * Changes after bootstrap are additive only (split §11.3).
 */
import { ulid } from 'ulid';
import { z } from 'zod';

/** Contract version. Additive change → bump minor; breaking change → all-hands, bump major. */
export const SCHEMA_VERSION = '1.1.0';

/** ID prefixes (design §4 rules). Generated IDs are `<prefix><ULID>`, e.g. `ev_01J9ZK...`. */
export const ID_PREFIXES = {
  profile: 'prof_',
  run: 'run_',
  task: 'task_',
  candidate: 'cand_',
  source: 'src_',
  evidence: 'ev_',
  entity: 'ent_',
  cluster: 'clu_',
  item: 'item_',
  action: 'act_',
  asset: 'asset_',
  brief: 'brief_',
  slot: 'slot_',
  offer: 'offer_',
  match: 'match_',
  session: 'sess_',
  demandEvent: 'evt_',
  aggregate: 'agg_',
  merchant: 'mer_',
  opportunity: 'opp_',
  draft: 'draft_',
} as const;

export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

/** New prefixed ID with a ULID body: `newId('ev_')` → `ev_01J9ZK3Q6W8F0T5M2V4X7Y9B1C`. */
export function newId<P extends IdPrefix>(prefix: P): `${P}${string}` {
  return `${prefix}${ulid()}`;
}

/**
 * Zod schema for an ID with a given prefix. Accepts any body after the prefix,
 * so hand-written seed IDs like `ev_seed_01` validate too.
 */
export function idSchema<P extends IdPrefix>(prefix: P) {
  return z
    .string()
    .startsWith(prefix)
    .refine((value) => value.length > prefix.length, {
      message: `ID needs a body after "${prefix}"`,
    });
}

/** Money in minor units (integer cents) plus a 3-letter ISO 4217 currency code. */
export const MoneySchema = z.object({
  amount: z.number().int(),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Expected a 3-letter uppercase ISO 4217 code'),
});
export type Money = z.infer<typeof MoneySchema>;

/** Legacy source types retained for compatibility; product captures use ProductEvidence. */
export const SourceTypeSchema = z.enum([
  'storefront',
  'shopify_catalog',
  'product_reviews',
  'editorial',
  'forum',
  'video',
  'social',
  'marketplace',
  'search_snippet',
]);
export type SourceType = z.infer<typeof SourceTypeSchema>;
