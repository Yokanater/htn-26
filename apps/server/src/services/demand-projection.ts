/**
 * Turns the private demand ledger into consent-gated published snapshots.
 * Owner: L4 (S3 integration). Design v3 §§6.1–6.2.
 *
 * This is the seam between the ledger (which records what a shopper explicitly chose) and
 * `@sei/enrich`'s deterministic projection (which counts it). Only the merchant-safe summary
 * is ever published: the private aggregate, with its exact counts, stays in this process.
 */
import type {
  ConsentRecord,
  IntentBrief,
  MerchantDemandSummary,
  SampleOrigin,
} from '@sei/contracts';
import type { DemandAggregator } from '@sei/core';
import type { PrivateDemandLedger } from './demand';

export interface DemandProjectionDeps {
  ledger: PrivateDemandLedger;
  /** Resolves the briefs an event referenced. Not owner-scoped: a cohort spans sessions. */
  briefs: (briefIds: readonly string[]) => IntentBrief[];
  aggregator: DemandAggregator;
  minimumSessions: number;
  retentionDays: number;
  /** §6.2 publishes on a fixed schedule; the window end is quantised to this period. */
  snapshotMinutes: number;
  now: () => Date;
}

export class DemandProjectionService {
  readonly #deps: DemandProjectionDeps;

  constructor(deps: DemandProjectionDeps) {
    this.#deps = deps;
  }

  /**
   * The fixed retention window. The end is quantised up to the current snapshot period
   * rather than read off the wall clock: a sliding end would give every refresh a different
   * cohort ID, so a published snapshot could never be found again. Read stability between
   * refreshes comes from the snapshot store, which serves the published value until a ledger
   * mutation invalidates it.
   */
  #window(): { start: Date; end: Date } {
    const period = this.#deps.snapshotMinutes * 60 * 1000;
    const end = new Date(Math.ceil(this.#deps.now().getTime() / period) * period);
    const start = new Date(end.getTime() - this.#deps.retentionDays * 24 * 60 * 60 * 1000);
    return { start, end };
  }

  /**
   * Recomputes every cohort for one provenance and republishes its summary. Publishing
   * bumps nothing by itself; a ledger mutation invalidates snapshots, so a stale read
   * fails until this runs again.
   */
  async refresh(origin: SampleOrigin): Promise<MerchantDemandSummary[]> {
    const { ledger, briefs, aggregator, minimumSessions } = this.#deps;
    const window = this.#window();
    const events = await ledger.readWindow(window.start, window.end);

    const consents: ConsentRecord[] = [];
    for (const sessionId of new Set(events.map((event) => event.sessionId))) {
      const consent = await ledger.getConsent(sessionId);
      if (consent) consents.push(consent);
    }

    const aggregates = aggregator.aggregate({
      events,
      briefs: briefs([...new Set(events.map((event) => event.briefId))]),
      consents,
      window,
      origin,
      minimumSessions,
    });

    return aggregates.map((aggregate) => {
      const summary = aggregator.summarize(aggregate, minimumSessions);
      ledger.publishSnapshot(aggregate.id, summary);
      return summary;
    });
  }

  /** Null when never published or invalidated by a later ledger change. */
  published(aggregateId: string): MerchantDemandSummary | null {
    return (this.#deps.ledger.readSnapshot(aggregateId) as MerchantDemandSummary | null) ?? null;
  }
}
