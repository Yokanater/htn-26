/** Private, owner-scoped demand ledger. Owner: L4 (S3-L4-1). Design v3 §§6, 8–9. */
import {
  type ConsentRecord,
  ConsentRecordSchema,
  type DemandEvent,
  DemandEventSchema,
} from '@sei/contracts';
import type { DemandStore } from '@sei/core';

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
  readonly #consents = new Map<string, ConsentRecord>();
  readonly #events = new Map<string, DemandEvent[]>();
  readonly #idempotency = new Map<string, Map<string, DemandEvent>>();
  readonly #snapshots = new Map<string, { generation: number; value: unknown }>();
  readonly #deletedSessions = new Set<string>();
  #generation = 1;

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
    const keys = this.#idempotency.get(parsed.sessionId) ?? new Map<string, DemandEvent>();
    const existing = keys.get(idempotencyKey);
    if (existing) {
      if (!sameChoice(existing, parsed)) throw new IdempotencyConflictError();
      return 'duplicate';
    }
    const events = this.#events.get(parsed.sessionId) ?? [];
    events.push(structuredClone(parsed));
    keys.set(idempotencyKey, structuredClone(parsed));
    this.#events.set(parsed.sessionId, events);
    this.#idempotency.set(parsed.sessionId, keys);
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
