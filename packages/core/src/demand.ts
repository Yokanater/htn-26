/** Demand data ports. Owner: L2; server persistence/authorization owned by L4. Design v3 §6. */
import type {
  ConsentRecord,
  DemandAggregate,
  DemandEvent,
  IntentBrief,
  MerchantDemandSummary,
  MerchantIdentity,
  MerchantOpportunity,
  ProductOffer,
} from '@sei/contracts';

export interface DemandStore {
  getConsent(sessionId: string): Promise<ConsentRecord | null>;
  /** Atomic version change and immediate affected-snapshot invalidation. */
  setConsent(record: ConsentRecord, expectedVersion: number | null): Promise<void>;
  /** Server validates references first; store atomically deduplicates by session + key. */
  append(event: DemandEvent, idempotencyKey: string): Promise<'inserted' | 'duplicate'>;
  /** Internal only: never exposed by merchant routes. */
  readWindow(start: Date, end: Date): Promise<DemandEvent[]>;
  /** Erasure and invalidation must finish before this promise resolves. */
  deleteSession(sessionId: string): Promise<void>;
}

export interface DemandAggregationInput {
  events: readonly DemandEvent[];
  briefs: readonly IntentBrief[];
  consents: readonly ConsentRecord[];
  window: { start: Date; end: Date };
  origin: 'live' | 'seed' | 'replay';
  minimumSessions: number;
}

export interface DemandAggregator {
  /** Deterministic: no model calls. Ledger validation is an independent boundary. */
  aggregate(input: DemandAggregationInput): DemandAggregate[];
  /** Fixed snapshots, suppression/coarsening; no private counts in merchant DTOs. */
  summarize(aggregate: DemandAggregate, minimumSessions: number): MerchantDemandSummary;
}

export interface OpportunityMapper {
  map(input: {
    merchant: MerchantIdentity;
    offers: readonly ProductOffer[];
    partnerOffers: readonly ProductOffer[];
    aggregates: readonly DemandAggregate[];
    minimumSessions: number;
  }): MerchantOpportunity[];
}
