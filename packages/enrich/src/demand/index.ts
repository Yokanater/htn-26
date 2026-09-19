/** Deterministic consented-demand projection. Owner: L2 (S3-L2-1). Design v3 §§6.1–6.2.
 * Pure functions over validated input: no model calls, no I/O, no clock reads.
 */
import { createHash } from 'node:crypto';
import type {
  DemandAggregate,
  DemandCohort,
  DemandEvent,
  IntentBrief,
  MerchantDemandSummary,
} from '@sei/contracts';
import type { DemandAggregationInput, DemandAggregator } from '@sei/core';

/** A slot's standing after the session's latest explicit decision about it. */
type SlotState = { merchantId: string; accepted: boolean; reason: string | null };

/** Events that express "I want this collection", as opposed to a single item decision. */
const COLLECTION_KINDS: ReadonlySet<DemandEvent['kind']> = new Set([
  'collection_saved',
  'offer_requested',
]);

/** §6.2 cohort key: domain × destination country × currency × sorted confirmed category set. */
function cohortOf(brief: IntentBrief): DemandCohort {
  return {
    domain: brief.domain,
    country: brief.country,
    currency: brief.currency,
    categories: [...new Set(brief.slots.map((slot) => slot.category))].sort(),
  };
}

function cohortKey(cohort: DemandCohort): string {
  return [cohort.domain, cohort.country, cohort.currency, cohort.categories.join(',')].join('|');
}

function stableId(key: string): `agg_${string}` {
  return `agg_${createHash('sha256').update(key).digest('hex').slice(0, 26)}`;
}

/**
 * A content fingerprint, not a monotonic counter — the projection is pure and holds no
 * prior state. It changes whenever the cohort's contents change (a withdrawal, a new
 * decision), which is what lets a consumer detect a citation of a superseded snapshot.
 */
function fingerprint(measures: unknown): number {
  const digest = createHash('sha256').update(JSON.stringify(measures)).digest('hex').slice(0, 8);
  return Number.parseInt(digest, 16) + 1;
}

/** Latest confirmed revision per brief ID; older revisions never contribute. */
function latestConfirmedRevisions(briefs: readonly IntentBrief[]): Map<string, IntentBrief> {
  const latest = new Map<string, IntentBrief>();
  for (const brief of briefs) {
    if (brief.status !== 'confirmed') continue;
    const current = latest.get(brief.id);
    if (!current || brief.revision > current.revision) latest.set(brief.id, brief);
  }
  return latest;
}

/**
 * Coarse published band. `SupportBandSchema` forbids an exact count, so even a known
 * value is widened to a bucket the size of the publication threshold.
 */
function band(count: number, bucket: number): { min: number; max: number } {
  const floor = Math.floor(count / bucket) * bucket;
  return { min: floor, max: floor + bucket };
}

export function createDemandAggregator(): DemandAggregator {
  return {
    aggregate(input: DemandAggregationInput): DemandAggregate[] {
      const briefs = latestConfirmedRevisions(input.briefs);
      // Only consent that is currently granted, at the version the event was recorded under.
      const granted = new Map(
        input.consents
          .filter((record) => record.state === 'granted')
          .map((record) => [record.sessionId, record]),
      );

      type Bucket = {
        cohort: DemandCohort;
        /** sessionId -> slotId -> latest decision about that slot */
        slots: Map<string, Map<string, SlotState>>;
        /** Sessions that explicitly saved or requested a collection. */
        collected: Set<string>;
      };
      const cohorts = new Map<string, Bucket>();

      // Latest decision wins; equal timestamps keep input order.
      const eligible = input.events
        .map((event, index) => ({ event, index }))
        .filter(({ event }) => {
          if (event.sampleOrigin !== input.origin) return false;
          const occurredAt = new Date(event.occurredAt);
          if (occurredAt < input.window.start || occurredAt >= input.window.end) return false;
          const consent = granted.get(event.sessionId);
          if (!consent || consent.version !== event.consentVersion) return false;
          const brief = briefs.get(event.briefId);
          return Boolean(brief && brief.revision === event.briefRevision);
        })
        .sort(
          (a, b) =>
            Date.parse(a.event.occurredAt) - Date.parse(b.event.occurredAt) || a.index - b.index,
        );

      for (const { event } of eligible) {
        const brief = briefs.get(event.briefId);
        if (!brief) continue;
        const cohort = cohortOf(brief);
        const key = cohortKey(cohort);
        const bucket: Bucket = cohorts.get(key) ?? {
          cohort,
          slots: new Map(),
          collected: new Set(),
        };
        const slots = bucket.slots.get(event.sessionId) ?? new Map<string, SlotState>();
        bucket.slots.set(event.sessionId, slots);
        if (COLLECTION_KINDS.has(event.kind)) bucket.collected.add(event.sessionId);
        for (const selected of event.selections) {
          slots.set(selected.slotId, {
            merchantId: selected.merchantId,
            accepted: event.kind !== 'item_rejected',
            reason: event.rejectionReason,
          });
        }
        cohorts.set(key, bucket);
      }

      const windowKey = `${input.window.start.toISOString()}|${input.window.end.toISOString()}`;
      return [...cohorts.entries()].map(([key, bucket]) => {
        const sessions = [...bucket.slots.entries()];
        const support = new Map<string, Set<string>>();
        const pairs = new Map<string, Set<string>>();
        const gaps = new Map<string, Set<string>>();

        for (const [sessionId, slots] of sessions) {
          const states = [...slots.values()];
          const accepted = [...new Set(states.filter((s) => s.accepted).map((s) => s.merchantId))];
          for (const merchantId of accepted) {
            const holder = support.get(merchantId) ?? new Set<string>();
            holder.add(sessionId);
            support.set(merchantId, holder);
          }
          // A pair needs both merchants still standing AND an explicit collection intent,
          // which keeps pair support at or below each merchant's own support.
          if (bucket.collected.has(sessionId)) {
            const sorted = [...accepted].sort();
            for (let i = 0; i < sorted.length; i += 1) {
              for (let j = i + 1; j < sorted.length; j += 1) {
                const pairKey = `${sorted[i]}|${sorted[j]}`;
                const holder = pairs.get(pairKey) ?? new Set<string>();
                holder.add(sessionId);
                pairs.set(pairKey, holder);
              }
            }
          }
          for (const reason of new Set(
            states.filter((s) => !s.accepted && s.reason).map((s) => s.reason as string),
          )) {
            const gapKey = `rejection|${reason}`;
            const holder = gaps.get(gapKey) ?? new Set<string>();
            holder.add(sessionId);
            gaps.set(gapKey, holder);
          }
        }

        const measures = {
          eligibleSessions: bucket.slots.size,
          pairs: [...pairs.entries()]
            .map(([pairKey, holder]) => {
              const [first, second] = pairKey.split('|');
              return {
                merchantIds: [first, second] as [string, string],
                supportingSessions: holder.size,
              };
            })
            .sort((a, b) => a.merchantIds[0].localeCompare(b.merchantIds[0])),
          merchantSupport: [...support.entries()]
            .map(([merchantId, holder]) => ({ merchantId, supportingSessions: holder.size }))
            .sort((a, b) => a.merchantId.localeCompare(b.merchantId)),
          gaps: [...gaps.entries()]
            .map(([gapKey, holder]) => {
              const [kind, reason] = gapKey.split('|');
              return {
                kind: kind as 'rejection' | 'unmet_requirement',
                reason,
                sessions: holder.size,
              };
            })
            .sort((a, b) => a.reason.localeCompare(b.reason)),
        };

        return {
          id: stableId(`${key}|${windowKey}|${input.origin}`),
          version: fingerprint(measures),
          cohort: bucket.cohort,
          windowStart: input.window.start.toISOString(),
          windowEnd: input.window.end.toISOString(),
          sampleOrigin: input.origin,
          ...measures,
        };
      });
    },

    summarize(aggregate: DemandAggregate, minimumSessions: number): MerchantDemandSummary {
      const publishable = aggregate.eligibleSessions >= minimumSessions;
      const base = {
        aggregateId: aggregate.id,
        aggregateVersion: aggregate.version,
        cohort: aggregate.cohort,
        windowStart: aggregate.windowStart,
        windowEnd: aggregate.windowEnd,
        sampleOrigin: aggregate.sampleOrigin,
        minimumSessions,
      };
      if (!publishable) {
        // A suppressed cohort discloses nothing at all, not even a band.
        return { ...base, status: 'insufficient_evidence', eligibleSessions: null };
      }
      return {
        ...base,
        status: 'available',
        eligibleSessions: band(aggregate.eligibleSessions, minimumSessions),
        merchantSupport: (aggregate.merchantSupport ?? [])
          .filter((entry) => entry.supportingSessions >= minimumSessions)
          .map((entry) => ({
            merchantId: entry.merchantId,
            support: band(entry.supportingSessions, minimumSessions),
          })),
        gaps: (aggregate.gaps ?? [])
          .filter((gap) => gap.sessions >= minimumSessions)
          .map((gap) => ({
            kind: gap.kind,
            reason: gap.reason,
            support: band(gap.sessions, minimumSessions),
          })),
      };
    },
  };
}
