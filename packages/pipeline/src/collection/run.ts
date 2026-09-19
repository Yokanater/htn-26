/** One checkpointed collection run: confirmed brief -> queries -> offers -> match -> explanation.
 * Owner: L3 (S2-L3-1). Design v3 §5.2–5.3, §9.
 * One hard deadline covers every stage; a soft discovery deadline stops searching and matches
 * what was found. The catalog session opens lazily and is always closed, including on cancel.
 * Provider errors become fixed status codes; their messages never reach results or events.
 */
import type { CollectionMatch, IntentBrief, ProductOffer } from '@sei/contracts';
import { ProductOfferSchema } from '@sei/contracts';
import type { CollectionMatcher, ShoppingCatalog, ShoppingContext } from '@sei/core';
import {
  boundExplanation,
  type CollectionExplainer,
  type CollectionExplanation,
  checkExplanation,
  explainCollection,
  type PlannedQuery,
  planSlotQueries,
} from '@sei/reason';
import pLimit from 'p-limit';
import { BudgetExhaustedError, createRunBudget } from './budget';
import {
  type CheckpointStore,
  DiscoveryCheckpointSchema,
  fingerprint,
  MatchCheckpointSchema,
  readCheckpoint,
} from './checkpoints';
import { missingItems, runStatus } from './partial';
import type {
  BudgetResource,
  CollectionRunResult,
  ExplainedCollection,
  QueryOutcome,
  QueryOutcomeStatus,
  RunStage,
  RunWarning,
  StageReport,
  StageStatus,
} from './types';
import { matchIssues } from './validate';

/** A catalog that may hold resources (e.g. browser sessions) for the life of one run. */
export type CatalogSession = Pick<ShoppingCatalog, 'search'> & { close(): Promise<void> };
export type OpenCatalog = (signal: AbortSignal, brief: IntentBrief) => Promise<CatalogSession>;

/** Wraps a stateless catalog; `close` is a no-op. */
export function staticCatalog(catalog: Pick<ShoppingCatalog, 'search'>): OpenCatalog {
  return async () => ({
    search: (query, context) => catalog.search(query, context),
    close: async () => {},
  });
}

export interface CollectionRunSettings {
  openCatalog: OpenCatalog;
  /** Injected collection engine (L2); the pipeline never imports its implementation. */
  matcher: CollectionMatcher;
  explainer?: CollectionExplainer;
  checkpoints: CheckpointStore;
  clock: () => Date;
  caps?: Partial<Record<BudgetResource, number>>;
  /** Hard deadline shared by every stage. */
  timeoutMs: number;
  /** Soft deadline for discovery; later stages still run on what was found. */
  discoveryTimeoutMs: number;
  concurrency: number;
  /** Discovery checkpoints older than this are refetched (design §9: 15 minutes). */
  factTtlMs: number;
  catalogVersion: string;
  matcherVersion: string;
  maxAlternatives: number;
}

export const RUN_DEFAULTS = {
  timeoutMs: 180_000,
  discoveryTimeoutMs: 90_000,
  concurrency: 4,
  factTtlMs: 15 * 60_000,
  catalogVersion: 'catalog.v1',
  matcherVersion: 'matcher.v1',
  maxAlternatives: 2,
} as const;

/** Abort reason used by the runner so a run can tell cancellation from supersession. */
export class RunStopped extends Error {
  readonly kind: 'cancelled' | 'superseded';
  constructor(kind: 'cancelled' | 'superseded') {
    super(kind === 'cancelled' ? 'Run cancelled' : 'Run superseded by a newer brief revision');
    this.name = 'RunStopped';
    this.kind = kind;
  }
}

export interface RunControl {
  runId: string;
  signal: AbortSignal;
  emitStage(stage: RunStage, status: StageStatus): void;
}

/** Reject as soon as `signal` aborts, even if the provider ignores it. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/**
 * The runner charges one `catalog_query` per search it issues, before the provider is called.
 * Adapters such as L1's injected catalog also charge `catalog_query` inside `search` (the port
 * says the runtime rejects an over-budget call before the provider runs), so without this every
 * query would cost two units. The runner's payment absorbs the adapter's first unit for that
 * search; an adapter that really makes several upstream calls is still charged for the rest.
 */
function withPrepaidCatalogQuery(context: ShoppingContext): ShoppingContext {
  let credit = 1;
  return {
    ...context,
    consume(resource, amount) {
      let charge = amount;
      if (resource === 'catalog_query' && credit > 0) {
        const absorbed = Math.min(credit, charge);
        credit -= absorbed;
        charge -= absorbed;
      }
      if (charge > 0) context.consume(resource, charge);
    },
  };
}

interface DiscoveryOutcome {
  query: PlannedQuery;
  status: QueryOutcomeStatus;
  offers: ProductOffer[];
}

export async function executeCollectionRun(
  brief: IntentBrief,
  settings: CollectionRunSettings,
  control: RunControl,
): Promise<CollectionRunResult> {
  const { clock, checkpoints: store } = settings;
  const startedAt = clock().toISOString();
  const hard = new AbortController();
  const soft = new AbortController();
  const hardTimer = setTimeout(() => hard.abort(), settings.timeoutMs);
  const softTimer = setTimeout(() => soft.abort(), settings.discoveryTimeoutMs);
  const runSignal = AbortSignal.any([control.signal, hard.signal]);
  const discoverySignal = AbortSignal.any([runSignal, soft.signal]);
  const budget = createRunBudget(settings.caps);
  const context: ShoppingContext = {
    signal: runSignal,
    sampleOrigin: brief.sampleOrigin,
    consume: (resource, amount) => budget.consume(resource, amount),
  };
  const warnings = new Set<RunWarning>();
  const stages = new Map<RunStage, StageStatus>();
  const setStage = (stage: RunStage, status: StageStatus) => {
    stages.set(stage, status);
    control.emitStage(stage, status);
  };
  const stopped = (): 'cancelled' | 'superseded' | null => {
    if (!control.signal.aborted) return null;
    const reason: unknown = control.signal.reason;
    return reason instanceof RunStopped ? reason.kind : 'cancelled';
  };

  // Catalog session: opened on the first uncached query, closed after discovery and in `finally`.
  let session: Promise<CatalogSession> | null = null;
  let opened: CatalogSession | null = null;
  let closed = false;
  const openSession = (): Promise<CatalogSession> => {
    if (closed) return Promise.reject(new Error('Catalog session closed'));
    session ??= settings.openCatalog(discoverySignal, brief).then((value) => {
      opened = value;
      return value;
    });
    return session;
  };
  const closeSession = async () => {
    if (closed) return;
    closed = true;
    if (opened) {
      try {
        await opened.close();
      } catch {
        warnings.add('resource_close_failed');
      }
    } else if (session) {
      // Still opening: close it as soon as it resolves.
      session.then((late) => late.close()).catch(() => {});
    }
  };

  const queries: QueryOutcome[] = [];
  const offerIndex = new Map<string, ProductOffer>();
  const candidates = new Map<string, string[]>();
  const explained: ExplainedCollection[] = [];
  let matchFailure: 'matcher_failed' | 'deadline' | 'budget_exhausted' | null = null;

  /** `stop` is set when the run was cancelled or superseded; otherwise status is derived. */
  const result = (stop: 'cancelled' | 'superseded' | null): CollectionRunResult => {
    const collection = explained[0]?.match ?? null;
    const missing = stop
      ? []
      : missingItems({ brief, queries, candidates, collection, matchFailure });
    return {
      runId: control.runId,
      briefId: brief.id,
      briefRevision: brief.revision,
      domain: brief.domain,
      sampleOrigin: brief.sampleOrigin,
      status: stop ?? runStatus(collection, missing, offerIndex.size),
      collection: explained[0] ?? null,
      alternatives: explained.slice(1),
      offers: [...offerIndex.values()],
      candidates: brief.slots.map((slot) => ({
        slotId: slot.id,
        offerIds: candidates.get(slot.id) ?? [],
      })),
      missing,
      queries,
      stages: [...stages].map(
        ([stage, stageStatus]): StageReport => ({ stage, status: stageStatus }),
      ),
      warnings: [...warnings],
      usage: budget.usage(),
      startedAt,
      finishedAt: clock().toISOString(),
    };
  };

  try {
    // Plan.
    const plan = planSlotQueries(brief);
    setStage('plan', 'completed');

    // Discover: every query settles on its own (salvaged partial-results behavior).
    setStage('discover', 'running');
    const failureStatus = (error: unknown): QueryOutcomeStatus => {
      if (control.signal.aborted) return 'cancelled';
      if (hard.signal.aborted || soft.signal.aborted) return 'deadline';
      if (error instanceof BudgetExhaustedError) return 'budget_exhausted';
      return 'provider_failed';
    };
    const discover = async (query: PlannedQuery): Promise<DiscoveryOutcome> => {
      const done = (status: QueryOutcomeStatus, offers: ProductOffer[] = []) => ({
        query,
        status,
        offers,
      });
      if (discoverySignal.aborted) return done(failureStatus(null));
      const key = `discover:${brief.sampleOrigin}:${brief.id}:${settings.catalogVersion}:${fingerprint(
        [query.slotId, query.text, query.country, query.currency, query.limit],
      )}`;
      const cached = await readCheckpoint(store, key, DiscoveryCheckpointSchema);
      if (cached && clock().getTime() - Date.parse(cached.capturedAt) <= settings.factTtlMs) {
        return done('reused', cached.offers);
      }
      try {
        budget.consume('catalog_query', 1);
      } catch {
        return done('budget_exhausted');
      }
      try {
        const catalog = await untilAborted(openSession(), discoverySignal);
        const raw: unknown = await untilAborted(
          catalog.search(query, withPrepaidCatalogQuery({ ...context, signal: discoverySignal })),
          discoverySignal,
        );
        const offers: ProductOffer[] = [];
        for (const item of Array.isArray(raw) ? raw : []) {
          const parsed = ProductOfferSchema.safeParse(item);
          if (!parsed.success) warnings.add('invalid_offers_dropped');
          else if (parsed.data.sampleOrigin !== brief.sampleOrigin) {
            warnings.add('foreign_sample_origin_dropped');
          } else if (offers.length < query.limit) offers.push(parsed.data);
        }
        await store.put(key, { offers, capturedAt: clock().toISOString() });
        return done('fetched', offers);
      } catch (error) {
        return done(failureStatus(error));
      }
    };
    const limit = pLimit(settings.concurrency);
    const outcomes = await Promise.all(plan.queries.map((query) => limit(() => discover(query))));
    clearTimeout(softTimer);
    await closeSession();

    for (const { query, status, offers } of outcomes) {
      queries.push({ key: query.key, slotId: query.slotId, status, offerCount: offers.length });
    }
    const succeeded = queries.filter((q) => q.status === 'fetched' || q.status === 'reused');
    if (succeeded.length && succeeded.length < queries.length) warnings.add('query_failed');
    setStage(
      'discover',
      succeeded.length === queries.length
        ? queries.every((q) => q.status === 'reused')
          ? 'reused'
          : 'completed'
        : succeeded.length
          ? 'partial'
          : 'failed',
    );
    const stop = stopped();
    if (stop) return result(stop);

    // Deduplicate by merchant + product + variant; the first occurrence in plan order wins.
    const identities = new Map<string, string>();
    for (const { query, offers } of outcomes) {
      for (const offer of offers) {
        const identity = JSON.stringify([offer.merchant.domain, offer.productId, offer.variantId]);
        let id = identities.get(identity);
        if (!id) {
          if (offerIndex.has(offer.id)) continue; // same ID, different identity: not trusted
          identities.set(identity, offer.id);
          offerIndex.set(offer.id, offer);
          id = offer.id;
        }
        const slotOffers = candidates.get(query.slotId) ?? [];
        if (!slotOffers.includes(id)) candidates.set(query.slotId, [...slotOffers, id]);
      }
    }

    // Match (injected engine), checkpointed by revision and exact offer set.
    let matches: CollectionMatch[] = [];
    if (offerIndex.size === 0 || runSignal.aborted) {
      if (runSignal.aborted) matchFailure = 'deadline';
      setStage('match', 'skipped');
    } else {
      setStage('match', 'running');
      const offers = [...offerIndex.values()];
      // Content, not IDs: a refreshed listing keeps its offer ID but can change size, price or
      // availability, and a match built on the old facts must not be served for the new ones.
      const key = `match:${brief.sampleOrigin}:${brief.id}:r${brief.revision}:${settings.matcherVersion}:${fingerprint(
        [...offers].sort((a, b) => a.id.localeCompare(b.id)),
      )}`;
      const cached = await readCheckpoint(store, key, MatchCheckpointSchema);
      const valid = (list: readonly unknown[]) =>
        list.filter(
          (item): item is CollectionMatch => matchIssues(item, brief, offerIndex).length === 0,
        );
      if (cached) {
        matches = valid(cached.matches);
        setStage('match', 'reused');
      } else {
        try {
          const raw: unknown = await untilAborted(
            settings.matcher.match(brief, offers, context),
            runSignal,
          );
          const list: unknown[] = Array.isArray(raw) ? raw : [];
          matches = valid(list);
          if (list.length > matches.length) warnings.add('matcher_output_invalid');
          await store.put(key, { matches });
          setStage('match', 'completed');
        } catch (error) {
          const stop = stopped();
          if (stop) return result(stop);
          matchFailure = hard.signal.aborted
            ? 'deadline'
            : error instanceof BudgetExhaustedError
              ? 'budget_exhausted'
              : 'matcher_failed';
          setStage('match', 'failed');
        }
      }
    }

    // Explain: evidence-bounded; a model explanation is used only if it validates in full.
    const selected = matches.slice(0, 1 + settings.maxAlternatives);
    if (selected.length === 0) setStage('explain', 'skipped');
    else {
      setStage('explain', 'running');
      const offers = [...offerIndex.values()];
      for (const match of selected) {
        const input = { brief, match, offers };
        let explanation: CollectionExplanation | null = null;
        if (settings.explainer && !runSignal.aborted) {
          try {
            const proposed = await untilAborted(
              settings.explainer.explain(input, context),
              runSignal,
            );
            if (checkExplanation(proposed, input).length === 0) explanation = proposed;
            else warnings.add('explanation_rejected');
          } catch {
            const stop = stopped();
            if (stop) return result(stop);
            warnings.add('explanation_rejected');
          }
        }
        if (!explanation) {
          const bounded = boundExplanation(explainCollection(input), input);
          if (bounded.dropped) warnings.add('explanation_lines_dropped');
          explanation = bounded.explanation;
        }
        explained.push({ match, explanation });
      }
      setStage('explain', 'completed');
    }
    return result(stopped());
  } finally {
    clearTimeout(hardTimer);
    clearTimeout(softTimer);
    await closeSession();
  }
}
