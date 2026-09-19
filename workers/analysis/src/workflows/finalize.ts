import type { EntitySeed, RecommendedAction, SampleStats, ScoreComponents } from "../contracts.js";
import { distinctSources, hostOf, type EvidenceBundle } from "../evidence.js";

/** Join upstream score by entity_key. The model never writes scores. */
export function scoreFor(entity_key: string | null, kind: EntitySeed["kind"], seeds: EntitySeed[]): ScoreComponents | null {
  if (!entity_key) return null;
  return seeds.find((s) => s.kind === kind && s.entity_key === entity_key)?.score_components ?? null;
}

/** Fewer than 2 independent (distinct-host) sources. */
export const isLowEvidence = (ids: string[], bundle: EvidenceBundle) => distinctSources(ids, bundle) < 2;

export function sampleStats(ids: string[], contradicting: string[], bundle: EvidenceBundle): SampleStats {
  const byId = new Map(bundle.documents.map((d) => [d.id, d]));
  const docs = [...new Set(ids)].flatMap((id) => byId.get(id) ?? []);
  const mix = { positive: 0, negative: 0, neutral: 0, mixed: 0, unknown: 0 };
  for (const d of docs) mix[d.enrichment?.sentiment.label ?? "unknown"]++;
  const dates = docs.flatMap((d) => (d.published_at ? [d.published_at.slice(0, 10)] : [])).sort();
  const labels = new Set([...docs, ...contradicting.flatMap((id) => byId.get(id) ?? [])].map((d) => d.enrichment?.sentiment.label));
  return {
    evidence_count: docs.length,
    source_count: new Set(docs.map((d) => hostOf(d.source_url))).size,
    source_types: [...new Set(docs.map((d) => d.source_type))],
    date_range: dates.length ? { earliest: dates[0]!, latest: dates[dates.length - 1]! } : null,
    sentiment_mix: mix,
    contradictory: contradicting.length > 0 || (labels.has("positive") && labels.has("negative")),
  };
}

const LEVEL = { low: 0, medium: 1, high: 2 } as const;

/** Impact desc, then confidence desc, then effort asc (stable). Ranks are reassigned 1..n. */
export function rankActions(actions: RecommendedAction[]): RecommendedAction[] {
  return actions
    .map((a, i) => ({ a, i }))
    .sort((x, y) =>
      LEVEL[y.a.expected_impact] - LEVEL[x.a.expected_impact] ||
      LEVEL[y.a.confidence] - LEVEL[x.a.confidence] ||
      LEVEL[x.a.effort] - LEVEL[y.a.effort] ||
      x.i - y.i,
    )
    .map(({ a }, i) => ({ ...a, rank: i + 1 }));
}

/**
 * Observed claims must have explanation === null. Live runs showed the model leaking scratch text into that field
 * ("/", ")", "Need null.", even "oops. Need clean output") on ~20 of ~35 items per report, so enforce it in code.
 * Inference explanations are left alone (validator requires them to be real sentences).
 */
export function cleanExplanation<T extends { claim_type: "observed" | "inference"; explanation: string | null }>(item: T): T {
  return item.claim_type === "observed" && item.explanation !== null ? { ...item, explanation: null } : item;
}
