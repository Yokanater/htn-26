import type {
  CollaborationOutput, CompetitorDiscourseOutput, EntitySeed, EvidenceDocument, StoreProfile, SwotActionsOutput,
} from "../../contracts.js";

/**
 * One benchmark store: everything the pipeline consumes plus the hand-written "model outputs" the fake client
 * returns. Human labels live separately in evals/labels/<id>.json so reviewers can edit them without touching code.
 * Adding a store = one file here + one labels file + one line in index.ts.
 */
export interface FixtureStore {
  id: string; // also the labels file name
  category: string;
  profile: StoreProfile;
  evidence: EvidenceDocument[];
  seeds: EntitySeed[];
  outputs: { collaboration: CollaborationOutput; competitors: CompetitorDiscourseOutput; swot: SwotActionsOutput };
  injection?: { doc_id: string; canary: string }; // a planted prompt-injection doc, when the store has one
}

type Sent = "positive" | "negative" | "neutral" | "mixed";
export type Row = [
  id: string,
  type: EvidenceDocument["source_type"],
  url: string,
  title: string,
  published: string,
  span: string,
  enr: [relevance: number, sentiment: Sent, score: number, topics: string[]],
];

/** Compact evidence rows -> EvidenceDocument[] (same shape as the coffee fixture). */
export const docs = (rows: Row[]): EvidenceDocument[] =>
  rows.map(([id, type, url, title, published, span, [relevance, label, score, topics]]) => ({
    id,
    source_url: url,
    source_type: type,
    title,
    published_at: `${published}T00:00:00Z`,
    fetched_at: "2026-09-17T14:00:00Z",
    exact_span: span,
    language: "en",
    enrichment: { relevance, sentiment: { label, score }, topics: topics.map((t) => ({ label: t, score: 0.75 })), model_version: "market-enrichment-v1" },
  }));

/** Upstream seed with a plausible component breakdown summing to `total` (fixture stand-in for the scoring teammate). */
export const seed = (kind: EntitySeed["kind"], entity_key: string, name: string, total: number): EntitySeed => {
  const names = kind === "collaboration"
    ? ["complementary_job", "audience_overlap", "price_fit", "feasibility", "evidence_quality", "novelty"]
    : ["product_overlap", "audience_overlap", "price_overlap", "positioning_similarity", "discourse", "source_diversity"];
  const weights = [0.3, 0.2, 0.15, 0.15, 0.1, 0.1];
  const components = Object.fromEntries(names.map((n, i) => [n, Math.round(total * weights[i]!)]));
  return { entity_key, name, kind, score_components: { components, total: Object.values(components).reduce((a, b) => a + b, 0) } };
};

type Conf = "low" | "medium" | "high";
export const obs = (claim: string, evidence_ids: string[], confidence: Conf) => ({
  claim, claim_type: "observed" as const, explanation: null, evidence_ids, confidence, insufficient_evidence: false,
});
export const inf = (claim: string, explanation: string, evidence_ids: string[], confidence: Conf) => ({
  claim, claim_type: "inference" as const, explanation, evidence_ids, confidence, insufficient_evidence: false,
});
