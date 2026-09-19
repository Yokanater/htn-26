/** Partial results. Owner: L3 (S2-L3-1).
 * Ported from `runAnalysis` in workers/analysis/src/pipeline.ts at 4623337 (origin/eval-release-gates):
 * independent units settle separately, each failure becomes a typed missing entry, later stages
 * still run on what succeeded, and the status is complete / partial / failed by what survived.
 * Changed: units are slot discovery queries and the match stage instead of report sections;
 * reasons are fixed codes, never `err.message` (provider text); a partial result names the exact
 * missing slots and unmet or unverified constraints of the selected offers.
 */
import type { CollectionMatch, IntentBrief } from '@sei/contracts';
import type { MissingItem, MissingSlotReason, QueryOutcome, RunStatus } from './types';

const FAILURE_PRECEDENCE: readonly MissingSlotReason[] = [
  'provider_failed',
  'budget_exhausted',
  'deadline',
];

/** Why discovery produced nothing usable for a slot, or null when at least one query succeeded. */
export function slotDiscoveryReason(
  slotId: string,
  queries: readonly QueryOutcome[],
): MissingSlotReason | null {
  const own = queries.filter((query) => query.slotId === slotId);
  if (own.length === 0) return 'no_query';
  if (own.some((query) => query.status === 'fetched' || query.status === 'reused')) return null;
  const statuses = new Set<string>(own.map((query) => query.status));
  return FAILURE_PRECEDENCE.find((reason) => statuses.has(reason)) ?? 'deadline';
}

export interface MissingInput {
  brief: IntentBrief;
  queries: readonly QueryOutcome[];
  candidates: ReadonlyMap<string, readonly string[]>;
  collection: CollectionMatch | null;
  /** Why the match stage produced no collection (null when it ran and returned nothing valid). */
  matchFailure: 'matcher_failed' | 'deadline' | 'budget_exhausted' | null;
}

export function missingItems({
  brief,
  queries,
  candidates,
  collection,
  matchFailure,
}: MissingInput): MissingItem[] {
  const missing: MissingItem[] = [];
  const bySlot = new Map(collection?.slots.map((slot) => [slot.slotId, slot]));
  for (const slot of brief.slots) {
    const matched = bySlot.get(slot.id);
    if (matched?.selectedOfferId) {
      for (const check of matched.checks) {
        if (check.status === 'pass') continue;
        missing.push({
          kind: 'constraint',
          slotId: slot.id,
          offerId: matched.selectedOfferId,
          key: check.key,
          status: check.status,
        });
      }
      continue;
    }
    const discovered = candidates.get(slot.id)?.length ?? 0;
    const reason: MissingSlotReason =
      slotDiscoveryReason(slot.id, queries) ??
      (discovered === 0 ? 'no_candidates' : (matchFailure ?? 'no_eligible_offer'));
    missing.push({
      kind: 'slot',
      slotId: slot.id,
      category: slot.category,
      required: slot.required,
      reason,
    });
  }
  return missing;
}

const FAILED_UNIT: ReadonlySet<MissingSlotReason> = new Set([
  'provider_failed',
  'budget_exhausted',
  'deadline',
  'matcher_failed',
]);

/** Ready only when the collection is ready and nothing required is missing or unverified.
 * Failed only when nothing usable survived and every slot failed for an operational reason. */
export function runStatus(
  collection: CollectionMatch | null,
  missing: readonly MissingItem[],
  offerCount: number,
): Exclude<RunStatus, 'cancelled' | 'superseded'> {
  if (collection) {
    const blocking = missing.some((item) => item.kind === 'constraint' || item.required);
    return collection.status === 'ready' && !blocking ? 'ready' : 'partial';
  }
  const allFailed = missing.every((item) => item.kind === 'slot' && FAILED_UNIT.has(item.reason));
  return offerCount === 0 && allFailed ? 'failed' : 'partial';
}
