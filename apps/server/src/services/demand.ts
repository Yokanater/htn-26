/**
 * Private demand ledger, consent CAS, and snapshot registry. Owner: L4 (S3-L4-1). Design v3 §6, §8–9.
 * Core `DemandStore.append` stays inserted|duplicate; fingerprint conflicts are handled here.
 */
import {
  type ConsentRecord,
  ConsentRecordSchema,
  type DemandAggregate,
  DemandAggregateSchema,
  type DemandEvent,
  DemandEventSchema,
  type IntentBrief,
  type MerchantDemandSummary,
  MerchantDemandSummarySchema,
  newId,
} from '@sei/contracts';
import type { DemandAggregationInput, DemandAggregator, DemandStore } from '@sei/core';

export const DEMAND_MIN_SESSIONS = 5;
export const DEMAND_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export class ConsentConflictError extends Error {
  constructor() {
    super('Consent changed in another request. Reload and try again.');
    this.name = 'ConsentConflictError';
  }
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super('That idempotency key was already used with a different request.');
    this.name = 'IdempotencyConflictError';
  }
}

export class SessionDeletedError extends Error {
  constructor() {
    super('The private session is gone.');
    this.name = 'SessionDeletedError';
  }
}

export class SnapshotInvalidatedError extends Error {
  constructor() {
    super('Demand snapshot is no longer valid.');
    this.name = 'SnapshotInvalidatedError';
  }
}

export interface SessionConsentRef {
  sessionId: string;
  consentVersion: number | null;
}

export interface PrivateDemandSnapshot {
  id: string;
  createdAt: string;
  invalidated: boolean;
  windowStart: string;
  windowEnd: string;
  origin: DemandAggregationInput['origin'];
  /** Every session whose events were in the window, including ineligible origins. */
  sessionRefs: SessionConsentRef[];
  /** Eligible live/granted/current-version sessions only. */
  contributingSessions: Array<{ sessionId: string; consentVersion: number }>;
  summary: MerchantDemandSummary;
}

interface IdempotencyRecord {
  fingerprint: string;
  eventId: string;
}

export function decisionFingerprint(input: {
  briefId: string;
  kind: string;
  runId: string | null;
  matchId: string | null;
  selections: ReadonlyArray<{ slotId: string; offerId: string }>;
  rejectionReason: string | null;
  briefRevision: number;
}): string {
  return JSON.stringify(input);
}

export function filterEligibleDemandEvents(input: DemandAggregationInput): DemandEvent[] {
  const consents = new Map(input.consents.map((record) => [record.sessionId, record]));
  const start = input.window.start.getTime();
  const end = input.window.end.getTime();
  return input.events.filter((event) => {
    if (event.sampleOrigin !== 'live' || input.origin !== 'live') return false;
    if (event.sampleOrigin !== input.origin) return false;
    const consent = consents.get(event.sessionId);
    if (consent?.state !== 'granted') return false;
    if (event.consentVersion !== consent?.version) return false;
    const occurred = Date.parse(event.occurredAt);
    if (!Number.isFinite(occurred) || occurred < start || occurred >= end) return false;
    return true;
  });
}

function cohortFrom(input: DemandAggregationInput): DemandAggregate['cohort'] {
  const brief = input.briefs[0];
  const categories = brief
    ? [...new Set(brief.slots.map((slot) => slot.category))].sort()
    : ['general'];
  return {
    domain: brief?.domain ?? 'outfit',
    country: brief?.country ?? 'CA',
    currency: brief?.currency ?? 'CAD',
    categories: categories.length > 0 ? categories.slice(0, 6) : ['general'],
  };
}

/** Inspects live/granted/current-version/window constraints; never claims real cohort counts. */
export function createFakeDemandAggregator(): DemandAggregator {
  return {
    aggregate(input) {
      void filterEligibleDemandEvents(input);
      const start = input.window.start.toISOString();
      const end = input.window.end.toISOString();
      return [
        DemandAggregateSchema.parse({
          id: newId('agg_'),
          version: 1,
          cohort: cohortFrom(input),
          windowStart: start,
          windowEnd: end,
          sampleOrigin: input.origin,
          eligibleSessions: 0,
          pairs: [],
        }),
      ];
    },
    summarize(aggregate, minimumSessions) {
      return MerchantDemandSummarySchema.parse({
        aggregateId: aggregate.id,
        aggregateVersion: aggregate.version,
        cohort: aggregate.cohort,
        windowStart: aggregate.windowStart,
        windowEnd: aggregate.windowEnd,
        sampleOrigin: aggregate.sampleOrigin,
        status: 'insufficient_evidence',
        minimumSessions,
        eligibleSessions: null,
      });
    },
  };
}

function snapshotMentionsSession(snapshot: PrivateDemandSnapshot, sessionId: string): boolean {
  return (
    snapshot.sessionRefs.some((ref) => ref.sessionId === sessionId) ||
    snapshot.contributingSessions.some((ref) => ref.sessionId === sessionId)
  );
}

class SnapshotRegistry {
  readonly #snapshots = new Map<string, PrivateDemandSnapshot>();

  put(snapshot: PrivateDemandSnapshot): void {
    this.#snapshots.set(snapshot.id, snapshot);
  }

  get(id: string): PrivateDemandSnapshot {
    const snapshot = this.#snapshots.get(id);
    if (!snapshot || snapshot.invalidated) throw new SnapshotInvalidatedError();
    return structuredClone(snapshot);
  }

  list(): PrivateDemandSnapshot[] {
    return [...this.#snapshots.values()].map((snapshot) => structuredClone(snapshot));
  }

  invalidateSession(sessionId: string): void {
    for (const snapshot of this.#snapshots.values()) {
      if (snapshotMentionsSession(snapshot, sessionId)) snapshot.invalidated = true;
    }
  }

  /** Erasure: drop records and scrub remaining refs so deleted session IDs cannot be listed. */
  eraseSession(sessionId: string): void {
    for (const [id, snapshot] of this.#snapshots) {
      if (snapshotMentionsSession(snapshot, sessionId)) {
        this.#snapshots.delete(id);
        continue;
      }
      snapshot.sessionRefs = snapshot.sessionRefs.filter((ref) => ref.sessionId !== sessionId);
      snapshot.contributingSessions = snapshot.contributingSessions.filter(
        (ref) => ref.sessionId !== sessionId,
      );
    }
  }
}

export class DemandLedger implements DemandStore {
  readonly #events = new Map<string, DemandEvent>();
  readonly #consents = new Map<string, ConsentRecord>();
  readonly #idempotency = new Map<string, IdempotencyRecord>();
  readonly #deleted = new Set<string>();
  readonly #tail = new Map<string, Promise<void>>();
  readonly #snapshots = new SnapshotRegistry();
  #snapshotTail: Promise<void> = Promise.resolve();
  #generation = 0;
  readonly #aggregator: DemandAggregator;
  readonly #now: () => Date;
  /** Test seam: runs after HTTP validation and before the per-session write lock. */
  beforeRecord: (() => Promise<void>) | null = null;
  /** Test seam: runs after a projection read and before the generation-checked publish. */
  beforeProjectCommit: (() => Promise<void>) | null = null;

  constructor(options: { now?: () => Date; aggregator?: DemandAggregator } = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#aggregator = options.aggregator ?? createFakeDemandAggregator();
  }

  async getConsent(sessionId: string): Promise<ConsentRecord | null> {
    if (this.#deleted.has(sessionId)) return null;
    const record = this.#consents.get(sessionId);
    return record ? structuredClone(record) : null;
  }

  async setConsent(record: ConsentRecord, expectedVersion: number | null): Promise<void> {
    const parsed = ConsentRecordSchema.parse(record);
    await this.#serialized(parsed.sessionId, async () => {
      this.#assertWritable(parsed.sessionId);
      const current = this.#consents.get(parsed.sessionId);
      if ((current?.version ?? null) !== expectedVersion) throw new ConsentConflictError();
      if (expectedVersion === null) {
        if (parsed.version !== 1) throw new ConsentConflictError();
        if (parsed.state === 'withdrawn') {
          throw new Error('First consent cannot be withdrawn');
        }
      } else if (parsed.version !== expectedVersion + 1) {
        throw new ConsentConflictError();
      }
      this.#consents.set(parsed.sessionId, structuredClone(parsed));
      await this.#withSnapshots(() => {
        this.#snapshots.invalidateSession(parsed.sessionId);
        this.#generation += 1;
      });
    });
  }

  async append(event: DemandEvent, idempotencyKey: string): Promise<'inserted' | 'duplicate'> {
    const parsed = DemandEventSchema.parse(event);
    return this.#serialized(parsed.sessionId, () => this.#insert(parsed, idempotencyKey, ''));
  }

  async record(
    event: DemandEvent,
    idempotencyKey: string,
    fingerprint: string,
  ): Promise<{ status: 'inserted' | 'duplicate'; event: DemandEvent }> {
    if (this.beforeRecord) await this.beforeRecord();
    const parsed = DemandEventSchema.parse(event);
    return this.#serialized(parsed.sessionId, () => {
      this.#assertWritable(parsed.sessionId);
      const existing = this.#idempotency.get(this.#key(parsed.sessionId, idempotencyKey));
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new IdempotencyConflictError();
        const original = this.#events.get(existing.eventId);
        if (!original) throw new IdempotencyConflictError();
        return { status: 'duplicate' as const, event: structuredClone(original) };
      }
      const status = this.#insert(parsed, idempotencyKey, fingerprint);
      return { status, event: structuredClone(parsed) };
    });
  }

  async readWindow(start: Date, end: Date): Promise<DemandEvent[]> {
    const from = start.getTime();
    const to = end.getTime();
    return [...this.#events.values()]
      .filter((event) => {
        if (this.#deleted.has(event.sessionId)) return false;
        const occurred = Date.parse(event.occurredAt);
        return Number.isFinite(occurred) && occurred >= from && occurred < to;
      })
      .map((event) => structuredClone(event));
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.#serialized(sessionId, async () => {
      this.#deleted.add(sessionId);
      this.#consents.delete(sessionId);
      for (const [eventId, event] of this.#events) {
        if (event.sessionId === sessionId) this.#events.delete(eventId);
      }
      for (const key of this.#idempotency.keys()) {
        if (key.startsWith(`${sessionId}\0`)) this.#idempotency.delete(key);
      }
      await this.#withSnapshots(() => {
        this.#snapshots.eraseSession(sessionId);
        this.#generation += 1;
      });
    });
  }

  readSnapshot(id: string): PrivateDemandSnapshot {
    return this.#snapshots.get(id);
  }

  listSnapshots(): PrivateDemandSnapshot[] {
    return this.#snapshots.list();
  }

  async project(
    options: {
      window?: { start: Date; end: Date };
      briefs?: readonly IntentBrief[];
      origin?: DemandAggregationInput['origin'];
      minimumSessions?: number;
    } = {},
  ): Promise<PrivateDemandSnapshot[]> {
    const hook = this.beforeProjectCommit;
    let usedHook = false;
    for (;;) {
      const generation = this.#generation;
      const end = options.window?.end ?? this.#now();
      const start = options.window?.start ?? new Date(end.getTime() - DEMAND_WINDOW_MS);
      const origin = options.origin ?? 'live';
      const minimumSessions = options.minimumSessions ?? DEMAND_MIN_SESSIONS;
      const events = await this.readWindow(start, end);
      const consents = [...this.#consents.values()].filter(
        (record) => !this.#deleted.has(record.sessionId),
      );
      if (hook && !usedHook) {
        usedHook = true;
        await hook();
      }
      const input: DemandAggregationInput = {
        events,
        briefs: options.briefs ?? [],
        consents,
        window: { start, end },
        origin,
        minimumSessions,
      };
      const eligible = filterEligibleDemandEvents(input);
      const sessionRefs = uniqueSessionRefs(events);
      const contributingSessions = uniqueContributing(eligible);
      const createdAt = this.#now().toISOString();
      const built = this.#aggregator.aggregate(input).map((aggregate) => {
        const snapshot: PrivateDemandSnapshot = {
          id: aggregate.id,
          createdAt,
          invalidated: false,
          windowStart: aggregate.windowStart,
          windowEnd: aggregate.windowEnd,
          origin,
          sessionRefs,
          contributingSessions,
          summary: this.#aggregator.summarize(aggregate, minimumSessions),
        };
        return snapshot;
      });
      const published = await this.#withSnapshots(() => {
        if (this.#generation !== generation) return null;
        if (built.some((snapshot) => this.#staleForPublish(snapshot))) return null;
        for (const snapshot of built) this.#snapshots.put(snapshot);
        return built.map((snapshot) => structuredClone(snapshot));
      });
      if (published) return published;
    }
  }

  #staleForPublish(snapshot: PrivateDemandSnapshot): boolean {
    for (const ref of [...snapshot.sessionRefs, ...snapshot.contributingSessions]) {
      if (this.#deleted.has(ref.sessionId)) return true;
    }
    for (const ref of snapshot.contributingSessions) {
      const consent = this.#consents.get(ref.sessionId);
      if (consent?.state !== 'granted' || consent.version !== ref.consentVersion) return true;
    }
    return false;
  }

  #insert(
    event: DemandEvent,
    idempotencyKey: string,
    fingerprint: string,
  ): 'inserted' | 'duplicate' {
    this.#assertWritable(event.sessionId);
    const key = this.#key(event.sessionId, idempotencyKey);
    const existing = this.#idempotency.get(key);
    if (existing) return 'duplicate';
    this.#events.set(event.id, structuredClone(event));
    this.#idempotency.set(key, { fingerprint, eventId: event.id });
    return 'inserted';
  }

  #assertWritable(sessionId: string): void {
    if (this.#deleted.has(sessionId)) throw new SessionDeletedError();
  }

  #key(sessionId: string, idempotencyKey: string): string {
    return `${sessionId}\0${idempotencyKey}`;
  }

  #serialized<T>(sessionId: string, work: () => T | Promise<T>): Promise<T> {
    const previous = this.#tail.get(sessionId) ?? Promise.resolve();
    const current = previous.then(work, work);
    this.#tail.set(
      sessionId,
      current.then(
        () => undefined,
        () => undefined,
      ),
    );
    return current;
  }

  #withSnapshots<T>(work: () => T | Promise<T>): Promise<T> {
    const current = this.#snapshotTail.then(work, work);
    this.#snapshotTail = current.then(
      () => undefined,
      () => undefined,
    );
    return current;
  }
}

function uniqueSessionRefs(events: readonly DemandEvent[]): SessionConsentRef[] {
  const seen = new Map<string, SessionConsentRef>();
  for (const event of events) {
    if (!seen.has(event.sessionId)) {
      seen.set(event.sessionId, {
        sessionId: event.sessionId,
        consentVersion: event.consentVersion,
      });
    }
  }
  return [...seen.values()];
}

function uniqueContributing(
  events: readonly DemandEvent[],
): Array<{ sessionId: string; consentVersion: number }> {
  const seen = new Map<string, { sessionId: string; consentVersion: number }>();
  for (const event of events) {
    if (event.consentVersion === null) continue;
    if (!seen.has(event.sessionId)) {
      seen.set(event.sessionId, {
        sessionId: event.sessionId,
        consentVersion: event.consentVersion,
      });
    }
  }
  return [...seen.values()];
}
