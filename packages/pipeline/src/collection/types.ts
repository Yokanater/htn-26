/** Collection run types. Owner: L3 (S2-L3-1). Design v3 §5.2–5.3, §8–9.
 * Pipeline-internal until S2-L4-1 publishes the run/event API DTO in @sei/contracts; the web
 * workspace mirrors the event and result shapes and must switch to that DTO when it lands.
 */
import type { CollectionMatch, ProductOffer, SampleOrigin, ShoppingDomain } from '@sei/contracts';
import type { CollectionExplanation } from '@sei/reason';

export type RunStage = 'plan' | 'discover' | 'match' | 'explain';
export type StageStatus = 'running' | 'completed' | 'reused' | 'partial' | 'failed' | 'skipped';

/** `superseded`: a newer brief revision replaced this run; its results must never reach the UI. */
export type RunStatus = 'ready' | 'partial' | 'failed' | 'cancelled' | 'superseded';

export type MissingSlotReason =
  | 'no_query'
  | 'no_candidates'
  | 'provider_failed'
  | 'deadline'
  | 'budget_exhausted'
  | 'no_eligible_offer'
  | 'matcher_failed';

/** Exactly what keeps the collection from being complete. */
export type MissingItem =
  | {
      kind: 'slot';
      slotId: string;
      category: string;
      required: boolean;
      reason: MissingSlotReason;
    }
  | {
      kind: 'constraint';
      slotId: string;
      offerId: string;
      key: string;
      status: 'unknown' | 'fail';
    };

export type QueryOutcomeStatus =
  | 'fetched'
  | 'reused'
  | 'provider_failed'
  | 'deadline'
  | 'budget_exhausted'
  | 'cancelled';

/** Per-query outcome. Carries no query text, provider body or error message. */
export interface QueryOutcome {
  key: string;
  slotId: string;
  status: QueryOutcomeStatus;
  offerCount: number;
}

export interface ExplainedCollection {
  match: CollectionMatch;
  explanation: CollectionExplanation;
}

export interface StageReport {
  stage: RunStage;
  status: StageStatus;
}

/** Fixed warning codes; never provider text. */
export type RunWarning =
  | 'query_failed'
  | 'invalid_offers_dropped'
  | 'foreign_sample_origin_dropped'
  | 'matcher_output_invalid'
  | 'explanation_rejected'
  | 'explanation_lines_dropped'
  | 'resource_close_failed';

export interface CollectionRunResult {
  runId: string;
  briefId: string;
  briefRevision: number;
  domain: ShoppingDomain;
  sampleOrigin: SampleOrigin;
  status: RunStatus;
  /** Best valid collection, or null when none could be assembled. */
  collection: ExplainedCollection | null;
  /** Other valid collections from the matcher, best first (at most two). */
  alternatives: ExplainedCollection[];
  /** Every deduplicated offer referenced by collections or candidates. */
  offers: ProductOffer[];
  /** Discovered offer IDs per slot, even when no collection could be assembled. */
  candidates: { slotId: string; offerIds: string[] }[];
  missing: MissingItem[];
  queries: QueryOutcome[];
  stages: StageReport[];
  warnings: RunWarning[];
  usage: Record<BudgetResource, number>;
  startedAt: string;
  finishedAt: string;
}

export type BudgetResource = 'catalog_query' | 'fetch' | 'browser_session' | 'model_call';

interface RunEventBase {
  runId: string;
  briefId: string;
  briefRevision: number;
  /** Strictly increasing per run. */
  seq: number;
}

export type CollectionRunEvent =
  | (RunEventBase & { type: 'stage'; stage: RunStage; status: StageStatus })
  | (RunEventBase & { type: 'result'; result: CollectionRunResult });
