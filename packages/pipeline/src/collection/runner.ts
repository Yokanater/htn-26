/** Collection runner: confirmation barrier, revision invalidation and gated events.
 * Owner: L3 (S2-L3-1). Design v3 §5.3, §8 (confirmed revision -> matching -> ready/partial/failed).
 * A run starts only for a confirmed, current brief revision. A newer revision (or `invalidate`
 * after a brief edit) aborts older runs as `superseded`; from then on they emit nothing, so an
 * old revision can never update the UI. Revisions are tracked in memory per runner; the
 * composition root calls `invalidate` whenever it saves a new brief revision.
 */
import { type IntentBrief, IntentBriefSchema, newId } from '@sei/contracts';
import type { CollectionMatcher } from '@sei/core';
import type { CollectionExplainer } from '@sei/reason';
import { type CheckpointStore, createMemoryCheckpointStore } from './checkpoints';
import {
  type CollectionRunSettings,
  executeCollectionRun,
  type OpenCatalog,
  RUN_DEFAULTS,
  RunStopped,
} from './run';
import type { BudgetResource, CollectionRunEvent, CollectionRunResult } from './types';

export type CollectionRunErrorKind =
  | 'feature_disabled'
  | 'invalid_brief'
  | 'not_confirmed'
  | 'stale_revision';

const RUN_ERROR_MESSAGES: Record<CollectionRunErrorKind, string> = {
  feature_disabled: 'Collection matching is disabled',
  invalid_brief: 'Brief is invalid',
  not_confirmed: 'Brief must be confirmed before matching',
  stale_revision: 'Brief revision is older than the current revision',
};

/** Thrown synchronously by `start`, before any provider call or budget use. */
export class CollectionRunError extends Error {
  readonly kind: CollectionRunErrorKind;
  constructor(kind: CollectionRunErrorKind) {
    super(RUN_ERROR_MESSAGES[kind]);
    this.name = 'CollectionRunError';
    this.kind = kind;
  }
}

export interface CollectionRunnerOptions {
  queriesPerSlot?: 1 | 2;
  /** Effective FEATURE_COLLECTION_MATCHING; when false, `start` rejects and nothing runs. */
  enabled: boolean;
  openCatalog: OpenCatalog;
  matcher: CollectionMatcher;
  explainer?: CollectionExplainer;
  checkpoints?: CheckpointStore;
  clock?: () => Date;
  runId?: () => string;
  caps?: Partial<Record<BudgetResource, number>>;
  timeoutMs?: number;
  discoveryTimeoutMs?: number;
  concurrency?: number;
  factTtlMs?: number;
  catalogVersion?: string;
  matcherVersion?: string;
  onEvent?: (event: CollectionRunEvent) => void;
}

export interface CollectionRunHandle {
  runId: string;
  briefId: string;
  briefRevision: number;
  /** Always resolves; operational failures are reported in the result, never thrown. */
  result: Promise<CollectionRunResult>;
  cancel(): void;
}

export interface CollectionRunner {
  start(brief: IntentBrief, options?: { signal?: AbortSignal }): CollectionRunHandle;
  /** Record a newer brief revision (e.g. after an edit); older runs are superseded. */
  invalidate(briefId: string, revision: number): void;
  latestRevision(briefId: string): number | null;
}

interface ActiveRun {
  handle: CollectionRunHandle;
  controller: AbortController;
}

export function createCollectionRunner(options: CollectionRunnerOptions): CollectionRunner {
  const settings: CollectionRunSettings = {
    queriesPerSlot: options.queriesPerSlot,
    openCatalog: options.openCatalog,
    matcher: options.matcher,
    explainer: options.explainer,
    checkpoints: options.checkpoints ?? createMemoryCheckpointStore(),
    clock: options.clock ?? (() => new Date()),
    caps: options.caps,
    timeoutMs: options.timeoutMs ?? RUN_DEFAULTS.timeoutMs,
    discoveryTimeoutMs: options.discoveryTimeoutMs ?? RUN_DEFAULTS.discoveryTimeoutMs,
    concurrency: options.concurrency ?? RUN_DEFAULTS.concurrency,
    factTtlMs: options.factTtlMs ?? RUN_DEFAULTS.factTtlMs,
    catalogVersion: options.catalogVersion ?? RUN_DEFAULTS.catalogVersion,
    matcherVersion: options.matcherVersion ?? RUN_DEFAULTS.matcherVersion,
    maxAlternatives: RUN_DEFAULTS.maxAlternatives,
  };
  const latest = new Map<string, number>();
  const active = new Map<string, ActiveRun>();

  const supersede = (briefId: string, revision: number) => {
    const run = active.get(briefId);
    if (!run || run.handle.briefRevision >= revision) return;
    active.delete(briefId);
    run.controller.abort(new RunStopped('superseded'));
  };

  return {
    start(brief, startOptions = {}) {
      if (!options.enabled) throw new CollectionRunError('feature_disabled');
      const parsed = IntentBriefSchema.safeParse(brief);
      if (!parsed.success) throw new CollectionRunError('invalid_brief');
      const current = parsed.data;
      if (current.status !== 'confirmed') throw new CollectionRunError('not_confirmed');
      if (current.revision < (latest.get(current.id) ?? 0)) {
        throw new CollectionRunError('stale_revision');
      }
      const existing = active.get(current.id);
      if (existing && existing.handle.briefRevision === current.revision) return existing.handle;

      latest.set(current.id, current.revision);
      supersede(current.id, current.revision);

      const controller = new AbortController();
      const signal = startOptions.signal
        ? AbortSignal.any([startOptions.signal, controller.signal])
        : controller.signal;
      const runId = options.runId?.() ?? newId('run_');
      let seq = 0;
      const isCurrent = () =>
        !controller.signal.aborted ||
        !(controller.signal.reason instanceof RunStopped) ||
        controller.signal.reason.kind !== 'superseded';
      const deliver = (event: CollectionRunEvent) => {
        if (isCurrent() && latest.get(current.id) === current.revision) options.onEvent?.(event);
      };
      const base = () => ({
        runId,
        briefId: current.id,
        briefRevision: current.revision,
        seq: ++seq,
      });

      const result = executeCollectionRun(current, settings, {
        runId,
        signal,
        emitStage: (stage, status) => deliver({ ...base(), type: 'stage', stage, status }),
      }).then((outcome) => {
        if (active.get(current.id)?.handle.runId === runId) active.delete(current.id);
        const final: CollectionRunResult = isCurrent()
          ? outcome
          : { ...outcome, status: 'superseded', collection: null, alternatives: [], missing: [] };
        deliver({ ...base(), type: 'result', result: final });
        return final;
      });

      const handle: CollectionRunHandle = {
        runId,
        briefId: current.id,
        briefRevision: current.revision,
        result,
        cancel: () => controller.abort(new RunStopped('cancelled')),
      };
      active.set(current.id, { handle, controller });
      return handle;
    },
    invalidate(briefId, revision) {
      if (revision > (latest.get(briefId) ?? 0)) latest.set(briefId, revision);
      supersede(briefId, revision);
    },
    latestRevision: (briefId) => latest.get(briefId) ?? null,
  };
}
