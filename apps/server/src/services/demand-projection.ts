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

/** Bounded retries when the ledger changes under a read; publishing nothing beats publishing stale. */
const MAX_ATTEMPTS = 3;

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
  readonly #publishedWindows = new Map<SampleOrigin, { end: string; ids: string[] }>();

  constructor(deps: DemandProjectionDeps) {
    this.#deps = deps;
  }

  async merchantSummaries(): Promise<MerchantDemandSummary[]> {
    const end = this.#window().end.toISOString();
    const previous = this.#publishedWindows.get('live');
    if (previous?.end === end) return previous.ids.flatMap((id) => this.published(id) ?? []);
    const summaries = await this.refresh('live');
    this.#publishedWindows.set('live', { end, ids: summaries.map((s) => s.aggregateId) });
    return summaries.filter((s) => s.status === 'available');
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

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      // Reading the ledger is asynchronous, so a withdrawal can land between the first read
      // and publication. Capturing the generation first and re-checking it before publishing
      // means a contribution withdrawn mid-read is never published as though it still counted.
      const generation = ledger.generation;
      const window = this.#window();
      const events = await ledger.readWindow(window.start, window.end);

      const consents: ConsentRecord[] = [];
      for (const sessionId of new Set(events.map((event) => event.sessionId))) {
        const consent = await ledger.getConsent(sessionId);
        if (consent) consents.push(consent);
      }
      if (ledger.generation !== generation) continue;

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
    // The ledger kept moving. Publishing nothing is correct: the next refresh recomputes,
    // and a reader sees no snapshot rather than one that may already be wrong.
    return [];
  }

  /** Drops every published snapshot, for a change the ledger cannot observe itself. */
  invalidate(): void {
    this.#deps.ledger.invalidateSnapshots();
  }

  /**
   * Null when never published, invalidated by a later ledger change, or left over from an
   * earlier window: a snapshot describes one fixed period and must not outlive it.
   */
  published(aggregateId: string): MerchantDemandSummary | null {
    const snapshot = this.#deps.ledger.readSnapshot(aggregateId) as MerchantDemandSummary | null;
    if (!snapshot) return null;
    return snapshot.windowEnd === this.#window().end.toISOString() ? snapshot : null;
  }
}
