/** Collection run view types. Owner: L3 (S2-L3-1).
 * The web app may import only @sei/contracts, so these mirror the `CollectionRunEvent` and
 * `CollectionRunResult` shapes from @sei/pipeline. Replace them with the run/event API DTO once
 * S2-L4-1 publishes it in @sei/contracts; do not extend them independently.
 */
import type { CollectionMatch, ProductOffer } from '@sei/contracts';
import type { ReactNode } from 'react';

export type RunStage = 'plan' | 'discover' | 'match' | 'explain';
export type StageStatus = 'running' | 'completed' | 'reused' | 'partial' | 'failed' | 'skipped';
export type RunStatus = 'ready' | 'partial' | 'failed' | 'cancelled' | 'superseded';

export type ExplanationBasis =
  | 'product_fact'
  | 'computed_check'
  | 'computed_summary'
  | 'model_summary'
  | 'missing';

export interface ExplanationLine {
  text: string;
  basis: ExplanationBasis;
  evidenceIds: string[];
}

export interface SlotExplanation {
  slotId: string;
  category: string;
  required: boolean;
  state: 'selected' | 'needs_verification' | 'not_met' | 'missing';
  lines: ExplanationLine[];
}

export interface ExplainedCollection {
  match: CollectionMatch;
  explanation: { matchId: string; summary: ExplanationLine[]; slots: SlotExplanation[] };
}

export type MissingSlotReason =
  | 'no_query'
  | 'no_candidates'
  | 'provider_failed'
  | 'deadline'
  | 'budget_exhausted'
  | 'no_eligible_offer'
  | 'matcher_failed';

export type MissingItem =
  | { kind: 'slot'; slotId: string; category: string; required: boolean; reason: MissingSlotReason }
  | {
      kind: 'constraint';
      slotId: string;
      offerId: string;
      key: string;
      status: 'unknown' | 'fail';
    };

export interface CollectionRunResult {
  runId: string;
  briefId: string;
  briefRevision: number;
  status: RunStatus;
  collection: ExplainedCollection | null;
  alternatives: ExplainedCollection[];
  offers: ProductOffer[];
  candidates: { slotId: string; offerIds: string[] }[];
  missing: MissingItem[];
  warnings: string[];
}

interface RunEventBase {
  runId: string;
  briefId: string;
  briefRevision: number;
  seq: number;
}

export type CollectionRunEvent =
  | (RunEventBase & { type: 'stage'; stage: RunStage; status: StageStatus })
  | (RunEventBase & { type: 'result'; result: CollectionRunResult });

/** Renders one offer. S2-L1-2's product tile plugs in here; see `FallbackOfferTile`. */
export type OfferTileRenderer = (
  offer: ProductOffer,
  context: { slotId: string; selected: boolean },
) => ReactNode;
