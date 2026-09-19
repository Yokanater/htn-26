/** Stage checkpoints. Owner: L3 (S2-L3-1). Design v3 §5.3, §9.
 * Keys are scoped by sample origin, brief ID and provider version. Discovery is keyed by the
 * query itself, so a budget-only revision reuses fetched offers (within the fact TTL) and reruns
 * only match and explain. Match results are keyed by brief revision and the exact offer set.
 * Only successful stage outputs are stored; a failed query is retried on the next run.
 */
import { createHash } from 'node:crypto';
import { CollectionMatchSchema, ProductOfferSchema } from '@sei/contracts';
import { z } from 'zod';

export interface CheckpointStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
}

/** In-process store; values are cloned on write and read. A server store must be session-private. */
export function createMemoryCheckpointStore(): CheckpointStore & { keys(): string[] } {
  const entries = new Map<string, unknown>();
  return {
    async get(key) {
      return entries.has(key) ? structuredClone(entries.get(key)) : undefined;
    },
    async put(key, value) {
      entries.set(key, structuredClone(value));
    },
    keys: () => [...entries.keys()],
  };
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

export const DiscoveryCheckpointSchema = z.strictObject({
  offers: z.array(ProductOfferSchema),
  capturedAt: z.iso.datetime(),
});
export type DiscoveryCheckpoint = z.infer<typeof DiscoveryCheckpointSchema>;

export const MatchCheckpointSchema = z.strictObject({
  matches: z.array(CollectionMatchSchema),
});
export type MatchCheckpoint = z.infer<typeof MatchCheckpointSchema>;

/** Reads a checkpoint, treating a malformed value as a miss. */
export async function readCheckpoint<T>(
  store: CheckpointStore,
  key: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const parsed = schema.safeParse(await store.get(key));
  return parsed.success ? parsed.data : null;
}
