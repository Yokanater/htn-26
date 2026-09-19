/** Slot query planning. Owner: L3 (S2-L3-1). Design v3 §5.2, §9.
 * Deterministic: two bounded text queries per slot from category + key visual/function terms.
 * Queries are built only from confirmed slot fields, never from the shopper's raw input text,
 * image or constraints, so nothing private leaves in a catalog request.
 */
import type { IntentBrief, IntentSlot } from '@sei/contracts';
import type { ProductQuery } from '@sei/core';

export const QUERY_LIMITS = {
  queriesPerSlot: 2,
  /** Candidate offers requested per query (design §5.2: up to eight per slot). */
  candidatesPerQuery: 8,
  maxQueryChars: 120,
  maxTerms: 6,
} as const;

export interface PlannedQuery extends ProductQuery {
  /** Stable within a plan: `<slotId>#<n>`. */
  key: string;
  slotRequired: boolean;
  /** 1 = category + visual attributes, 2 = category + description terms. */
  variant: 1 | 2;
}

export interface QueryPlan {
  queries: PlannedQuery[];
  /** Queries dropped by the catalog-query cap, in priority order. */
  deferred: PlannedQuery[];
}

const STOP_WORDS = new Set(
  'a an and the of for with in on to from my our your this that matching confirmed inspiration item'.split(
    ' ',
  ),
);

function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

function queryText(parts: readonly string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of parts.flatMap(terms)) {
    if (seen.has(term)) continue;
    seen.add(term);
    out.push(term);
  }
  return out.join(' ').slice(0, QUERY_LIMITS.maxQueryChars).trim();
}

function slotQueries(brief: IntentBrief, slot: IntentSlot): PlannedQuery[] {
  const category = queryText([slot.category]);
  const attributeTerms = queryText(slot.visualAttributes).split(' ').filter(Boolean);
  const descriptionTerms = queryText([slot.description])
    .split(' ')
    .filter((term) => term && !category.split(' ').includes(term));
  const texts = [
    queryText([category, ...attributeTerms.slice(0, QUERY_LIMITS.maxTerms)]),
    queryText([category, ...descriptionTerms.slice(0, QUERY_LIMITS.maxTerms)]),
  ];
  const planned: PlannedQuery[] = [];
  texts.forEach((text, index) => {
    if (!text || planned.some((query) => query.text === text)) return;
    planned.push({
      key: `${slot.id}#${index + 1}`,
      slotId: slot.id,
      slotRequired: slot.required,
      variant: (index + 1) as 1 | 2,
      text,
      country: brief.country,
      currency: brief.currency,
      limit: QUERY_LIMITS.candidatesPerQuery,
    });
  });
  return planned;
}

/** Plans up to two queries per slot. When `maxQueries` is lower than the full plan, every slot's
 * first query comes before any second query, and required slots come before optional ones. */
export function planSlotQueries(
  brief: IntentBrief,
  maxQueries = Number.POSITIVE_INFINITY,
): QueryPlan {
  const perSlot = brief.slots.map((slot) => slotQueries(brief, slot));
  const ordered = [0, 1].flatMap((round) =>
    [true, false].flatMap((required) =>
      perSlot.flatMap((queries) =>
        queries[round] && queries[round].slotRequired === required ? [queries[round]] : [],
      ),
    ),
  );
  const cap = Math.max(0, Math.floor(maxQueries));
  return { queries: ordered.slice(0, cap), deferred: ordered.slice(cap) };
}
