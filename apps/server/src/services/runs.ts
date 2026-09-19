/**
 * Owner-scoped registry of collection runs and their event history. Owner: L4 (S2-L4-1).
 *
 * The pipeline runner reports events through one callback and emits its first events
 * synchronously inside `start`, before it returns a handle, so the registry claims the owner for
 * the duration of that call. Events are kept so a reconnecting SSE client can resume after a
 * `Last-Event-ID`. A superseded run emits no result (the runner suppresses it) and is closed with
 * a reason instead, so an old revision can never reach the shopper.
 */
import type {
  CheckpointStore,
  CollectionRunEvent,
  CollectionRunHandle,
  CollectionRunResult,
} from '@sei/pipeline';

export const MAX_RUNS_PER_OWNER = 20;

export type RunClosedReason = 'superseded' | 'deleted';

export interface RunRecord {
  runId: string;
  ownerId: string;
  briefId: string;
  briefRevision: number;
  events: CollectionRunEvent[];
  result: CollectionRunResult | null;
  /** No further events will arrive. */
  done: boolean;
  closedReason: RunClosedReason | null;
  handle: CollectionRunHandle | null;
  waiters: Set<() => void>;
}

/**
 * A run belongs to one brief revision. Once the brief has a newer revision the run is superseded
 * even if it already finished: its collection was built for requirements the shopper changed.
 */
export function isSuperseded(record: RunRecord, latestRevision: number | null): boolean {
  return record.closedReason === 'superseded' || (latestRevision ?? 0) > record.briefRevision;
}

export class RunRegistry {
  readonly #records = new Map<string, RunRecord>();
  #starting: string | null = null;

  /** Starts (or rejoins) a run for `ownerId`; `begin` calls the runner. */
  start(ownerId: string, begin: () => CollectionRunHandle): RunRecord {
    this.#starting = ownerId;
    let handle: CollectionRunHandle;
    try {
      handle = begin();
    } finally {
      this.#starting = null;
    }
    const record =
      this.#records.get(handle.runId) ??
      this.#create(handle.runId, ownerId, handle.briefId, handle.briefRevision);
    if (!record.handle) {
      record.handle = handle;
      void handle.result.then((result) => {
        if (record.done) return;
        record.done = true;
        if (result.status === 'superseded') record.closedReason = 'superseded';
        else record.result = result;
        this.#notify(record);
      });
    }
    this.#evict(ownerId);
    return record;
  }

  /** Runner `onEvent` callback. */
  publish(event: CollectionRunEvent): void {
    let record = this.#records.get(event.runId);
    if (!record) {
      if (this.#starting === null) return;
      record = this.#create(event.runId, this.#starting, event.briefId, event.briefRevision);
    }
    record.events.push(event);
    this.#notify(record);
  }

  get(ownerId: string, runId: string): RunRecord | null {
    const record = this.#records.get(runId);
    return record && record.ownerId === ownerId ? record : null;
  }

  /** Resolves on the record's next change (new event or close). */
  changed(record: RunRecord, signal: { onAbort(handler: () => void): void }): Promise<void> {
    return new Promise<void>((resolve) => {
      record.waiters.add(resolve);
      signal.onAbort(resolve);
    });
  }

  /** Cancels and forgets every run of an owner; returns the brief IDs they covered. */
  deleteOwner(ownerId: string): string[] {
    const briefIds = new Set<string>();
    for (const [runId, record] of this.#records) {
      if (record.ownerId !== ownerId) continue;
      briefIds.add(record.briefId);
      record.handle?.cancel();
      record.done = true;
      record.closedReason ??= 'deleted';
      this.#records.delete(runId);
      this.#notify(record);
    }
    return [...briefIds];
  }

  #create(runId: string, ownerId: string, briefId: string, briefRevision: number): RunRecord {
    const record: RunRecord = {
      runId,
      ownerId,
      briefId,
      briefRevision,
      events: [],
      result: null,
      done: false,
      closedReason: null,
      handle: null,
      waiters: new Set(),
    };
    this.#records.set(runId, record);
    return record;
  }

  #notify(record: RunRecord): void {
    const waiters = [...record.waiters];
    record.waiters.clear();
    for (const wake of waiters) wake();
  }

  /** Bounds memory: beyond the cap, the oldest finished runs go first. */
  #evict(ownerId: string): void {
    const owned = [...this.#records.values()].filter((record) => record.ownerId === ownerId);
    for (const record of owned) {
      if (owned.length <= MAX_RUNS_PER_OWNER) return;
      if (!record.done) continue;
      this.#records.delete(record.runId);
      owned.splice(owned.indexOf(record), 1);
    }
  }
}

/**
 * Stage checkpoints for the runner, held in memory and purgeable per brief so deleting a session
 * also deletes what was derived from it. Keys embed the brief ID as one `:`-separated segment.
 */
export class PrivateCheckpointStore implements CheckpointStore {
  readonly #entries = new Map<string, unknown>();
  readonly #dropped = new Set<string>();

  async get(key: string): Promise<unknown> {
    return this.#entries.has(key) ? structuredClone(this.#entries.get(key)) : undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    if (key.split(':').some((part) => this.#dropped.has(part))) return;
    this.#entries.set(key, structuredClone(value));
  }

  keys(): string[] {
    return [...this.#entries.keys()];
  }

  /** Removes a brief's checkpoints and refuses late writes from a run that outlived deletion. */
  dropBrief(briefId: string): void {
    this.#dropped.add(briefId);
    for (const key of this.#entries.keys()) {
      if (key.split(':').includes(briefId)) this.#entries.delete(key);
    }
  }
}
