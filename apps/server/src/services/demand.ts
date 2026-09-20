/** Private, owner-scoped demand ledger. Owner: L4 (S3-L4-1). Design v3 §§6, 8–9. */
import {
  type ConsentRecord,
  ConsentRecordSchema,
  type DemandEvent,
  DemandEventSchema,
} from '@sei/contracts';
import type { DemandStore } from '@sei/core';
import type { PrivateDatabase } from './persistence';

export class ConsentConflictError extends Error {
  constructor() {
    super('Consent changed in another tab. Reload before trying again.');
  }
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super('That idempotency key already identifies another choice.');
  }
}

export class SessionDeletedError extends Error {
  constructor() {
    super('This private session has been deleted.');
  }
}

function sameChoice(a: DemandEvent, b: DemandEvent): boolean {
  return (
    a.briefId === b.briefId &&
    a.briefRevision === b.briefRevision &&
    a.kind === b.kind &&
    a.matchId === b.matchId &&
    a.rejectionReason === b.rejectionReason &&
    JSON.stringify(a.selections) === JSON.stringify(b.selections)
  );
}

/**
 * Single-process storage keeps each write atomic because mutation happens without an await.
 * A production multi-instance deployment must replace this with a transactional adapter.
 */
export class PrivateDemandLedger implements DemandStore {
  readonly #consents: Map<string, ConsentRecord>;
  readonly #events: Map<string, DemandEvent[]>;
  readonly #idempotency: Map<string, Map<string, DemandEvent>>;
  readonly #snapshots = new Map<string, { generation: number; value: unknown }>();
  readonly #deletedSessions = new Set<string>();
  #generation = 1;

  constructor(database?: PrivateDatabase) {
    this.#consents = database?.map<ConsentRecord>('consents') ?? new Map();
    this.#events = new Map();
    this.#idempotency = database?.map<Map<string, DemandEvent>>('idempotency') ?? new Map();
    for (const [sessionId, events] of this.#idempotency)
      this.#events.set(sessionId, [...events.values()]);
  }

  async getConsent(sessionId: string): Promise<ConsentRecord | null> {
    const record = this.#consents.get(sessionId);
    return record ? structuredClone(record) : null;
  }

  async setConsent(record: ConsentRecord, expectedVersion: number | null): Promise<void> {
    const parsed = ConsentRecordSchema.parse(record);
    if (this.#deletedSessions.has(parsed.sessionId)) throw new SessionDeletedError();
    const current = this.#consents.get(parsed.sessionId);
    if (
      (expectedVersion === null && current) ||
      (expectedVersion !== null && current?.version !== expectedVersion)
    ) {
      throw new ConsentConflictError();
    }
    this.#consents.set(parsed.sessionId, structuredClone(parsed));
    this.#invalidateSnapshots();
  }

  async append(event: DemandEvent, idempotencyKey: string): Promise<'inserted' | 'duplicate'> {
    const parsed = DemandEventSchema.parse(event);
    if (this.#deletedSessions.has(parsed.sessionId)) throw new SessionDeletedError();
    const keys = new Map(this.#idempotency.get(parsed.sessionId));
    const existing = keys.get(idempotencyKey);
    if (existing) {
      if (!sameChoice(existing, parsed)) throw new IdempotencyConflictError();
      return 'duplicate';
    }
    const events = [...(this.#events.get(parsed.sessionId) ?? []), structuredClone(parsed)];
    keys.set(idempotencyKey, structuredClone(parsed));
    this.#idempotency.set(parsed.sessionId, keys);
    this.#events.set(parsed.sessionId, events);
    this.#invalidateSnapshots();
    return 'inserted';
  }

  async readWindow(start: Date, end: Date): Promise<DemandEvent[]> {
    return [...this.#events.values()]
      .flat()
      .filter((event) => {
        const occurredAt = Date.parse(event.occurredAt);
        return occurredAt >= start.getTime() && occurredAt < end.getTime();
      })
      .map((event) => structuredClone(event));
  }

  eventForKey(sessionId: string, idempotencyKey: string): DemandEvent | null {
    const event = this.#idempotency.get(sessionId)?.get(idempotencyKey);
    return event ? structuredClone(event) : null;
  }

  /**
   * Counts ledger mutations. A reader captures this before it starts and re-checks it before
   * publishing, so a consent change that lands mid-read cannot be published as if it had not.
   */
  get generation(): number {
    return this.#generation;
  }

  /** Invalidates every snapshot for a change this store cannot see, such as a brief revision. */
  invalidateSnapshots(): void {
    this.#invalidateSnapshots();
  }

  /** Test/integration seam proving stale snapshots cannot survive a ledger mutation. */
  publishSnapshot(id: string, value: unknown): void {
    this.#snapshots.set(id, { generation: this.#generation, value: structuredClone(value) });
  }

  readSnapshot(id: string): unknown | null {
    const snapshot = this.#snapshots.get(id);
    return snapshot?.generation === this.#generation ? structuredClone(snapshot.value) : null;
  }

  async deleteSession(sessionId: string): Promise<void> {
    // Tombstone first: an already-started async request cannot recreate data after erasure.
    this.#deletedSessions.add(sessionId);
    this.#consents.delete(sessionId);
    this.#events.delete(sessionId);
    this.#idempotency.delete(sessionId);
    this.#invalidateSnapshots();
  }

  #invalidateSnapshots(): void {
    this.#generation += 1;
    this.#snapshots.clear();
  }
}
