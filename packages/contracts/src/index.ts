import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const SCHEMA_VERSION = "1.0.0";

/** Consumers may accept additive contract changes within the current major. */
export function isCompatibleSchemaVersion(version: string): boolean {
  const candidate = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  const current = /^(\d+)\.(\d+)\.(\d+)$/.exec(SCHEMA_VERSION);
  return candidate?.[1] === current?.[1];
}

// ---------------------------------------------------------------------------
// Inputs (owned by research / enrichment teammates; we only consume them)
// ---------------------------------------------------------------------------

export const SourceType = z.enum(["storefront", "forum", "review", "editorial", "video", "social"]);
export const SentimentLabel = z.enum(["positive", "negative", "neutral", "mixed"]);

export const Enrichment = z.object({
  relevance: z.number().min(0).max(1),
  sentiment: z.object({ label: SentimentLabel, score: z.number().min(0).max(1) }),
  topics: z.array(z.object({ label: z.string(), score: z.number().min(0).max(1) })),
  model_version: z.string().optional(),
});

export const EvidenceDocument = z.object({
  id: z.string().min(1),
  source_url: z.string().url(),
  source_type: SourceType,
  title: z.string(),
  published_at: z.string().datetime().nullable(),
  fetched_at: z.string().datetime(),
  exact_span: z.string().min(1),
  language: z.string(),
  enrichment: Enrichment.optional(), // absent when Baseten enrichment failed
});

export const StoreProfile = z.object({
  store_url: z.string().url(),
  domain: z.string(),
  brand_name: z.string(),
  shopify_confidence: z.number().min(0).max(1),
  categories: z.array(z.string()),
  products: z.array(
    z.object({
      name: z.string(),
      product_type: z.string(),
      price_min: z.number(),
      price_max: z.number(),
      currency: z.string(),
    }),
  ),
  price_position: z.enum(["budget", "mid", "premium"]),
  audiences: z.array(z.string()),
  geography: z.array(z.string()),
  positioning: z.string(),
  stated_values: z.array(z.string()),
  differentiators: z.array(z.string()),
  complementary_needs: z.array(z.string()),
});

/** Computed upstream (scoring teammate). We attach it to model output; the model never writes it. */
export const ScoreComponents = z.object({
  components: z.record(z.string(), z.number()), // e.g. complementary_job: 27, audience_overlap: 14, conflict_penalty: -5
  total: z.number().min(0).max(100), // 0-100
});

/** Upstream candidate entity + its score. Lets us join scores onto model output by entity_key (canonical domain). */
export const EntitySeed = z.object({
  entity_key: z.string(),
  name: z.string(),
  kind: z.enum(["collaboration", "competitor"]),
  score_components: ScoreComponents,
});

// ---------------------------------------------------------------------------
// Model-facing claim fields.
// Structured Outputs strict mode: no .optional() (use .nullable()) and no refinements
// (the SDK rejects ZodEffects), so array bounds use native .min()/.max().
// ---------------------------------------------------------------------------

export const Confidence = z.enum(["low", "medium", "high"]);
export const ClaimType = z.enum(["observed", "inference"]);

const claimFields = {
  claim: z.string(), // the factual statement; if insufficient_evidence, states what is missing
  claim_type: ClaimType,
  explanation: z.string().nullable(), // required (non-empty) when claim_type = "inference"
  evidence_ids: z.array(z.string()), // may be empty only when insufficient_evidence = true
  confidence: Confidence,
  insufficient_evidence: z.boolean(),
};

const bounded = <T extends z.ZodTypeAny>(item: T, min: number, max: number) => z.array(item).min(min).max(max);

// ---- Collaboration -------------------------------------------------------

export const ActivationType = z.enum(["bundle", "co_marketing", "gift_with_purchase", "content", "event", "channel"]);

export const CollaborationCandidateDraft = z.object({
  ...claimFields, // claim = why this brand complements the merchant's product
  id: z.string(),
  rank: z.number().int(),
  brand_name: z.string(),
  entity_key: z.string().nullable(), // canonical domain; must match an upstream seed key when one exists
  use_moment: z.enum(["before", "during", "after"]), // when the partner product is used relative to the merchant's
  is_direct_substitute: z.boolean(),
  conflict_note: z.string().nullable(), // required when is_direct_substitute
  activation: z.object({ type: ActivationType, description: z.string() }),
  value_for_merchant: z.string(),
  value_for_partner: z.string(),
  risk_note: z.string(),
  first_validation_step: z.string(),
});

export const CollaborationCandidate = CollaborationCandidateDraft.extend({
  score_components: ScoreComponents.nullable(),
  low_evidence: z.boolean(),
});

export const CollaborationOutput = z.object({ candidates: bounded(CollaborationCandidateDraft, 5, 10) });

// ---- Competitors + discourse ----------------------------------------------

export const CompetitorClass = z.enum(["direct", "substitute", "adjacent"]);
export const ThemeKind = z.enum(["praise", "complaint", "switching_trigger", "unmet_need"]);

export const CompetitorProfileDraft = z.object({
  ...claimFields, // claim = what the competitor is / sells, as evidenced
  id: z.string(),
  rank: z.number().int(),
  name: z.string(),
  entity_key: z.string().nullable(),
  classification: CompetitorClass,
  classification_reason: z.string(), // short and testable
});

export const CompetitorProfile = CompetitorProfileDraft.extend({
  score_components: ScoreComponents.nullable(),
  low_evidence: z.boolean(),
});

export const DiscourseThemeDraft = z.object({
  ...claimFields, // claim = the theme, worded as what people said, never as market fact
  id: z.string(),
  theme_kind: ThemeKind,
  about: z.string(), // brand the theme concerns (merchant or competitor name)
  contradicting_evidence_ids: z.array(z.string()),
  contradiction_note: z.string().nullable(),
  sampling_bias_note: z.string().nullable(),
});

/** Computed from cited evidence in code, never by the model. */
export const SampleStats = z.object({
  evidence_count: z.number().int(),
  source_count: z.number().int(), // distinct hostnames
  source_types: z.array(SourceType),
  date_range: z.object({ earliest: z.string(), latest: z.string() }).nullable(),
  sentiment_mix: z.object({
    positive: z.number().int(),
    negative: z.number().int(),
    neutral: z.number().int(),
    mixed: z.number().int(),
    unknown: z.number().int(),
  }),
  contradictory: z.boolean(), // cited evidence includes both positive and negative sentiment
});

export const DiscourseTheme = DiscourseThemeDraft.extend({
  sample: SampleStats,
  low_evidence: z.boolean(),
});

export const CompetitorDiscourseOutput = z.object({
  competitors: bounded(CompetitorProfileDraft, 5, 10),
  themes: z.array(DiscourseThemeDraft),
});

// ---- SWOT + actions ---------------------------------------------------------

export const SwotItem = z.object({
  ...claimFields,
  id: z.string(),
  subject: z.enum(["merchant", "market"]), // strengths/weaknesses must be "merchant"
});

export const SwotReport = z.object({
  strengths: bounded(SwotItem, 3, 5),
  weaknesses: bounded(SwotItem, 3, 5),
  opportunities: bounded(SwotItem, 3, 5),
  threats: bounded(SwotItem, 3, 5),
});

export const Level = z.enum(["low", "medium", "high"]);

export const RecommendedAction = z.object({
  ...claimFields, // claim = the evidence-backed reason for the action
  id: z.string(),
  rank: z.number().int(), // reassigned in code from impact/confidence/effort
  title: z.string(),
  action: z.string(),
  expected_impact: Level,
  effort: Level,
  cheapest_falsifying_experiment: z.object({
    experiment: z.string(),
    metric: z.string(),
    falsified_if: z.string(),
  }),
});

export const SwotActionsOutput = z.object({
  swot: SwotReport,
  actions: bounded(RecommendedAction, 3, 3),
});

// ---- Planner ------------------------------------------------------------------

export const ResearchPlan = z.object({
  queries: bounded(
    z.object({
      query: z.string(),
      intent: z.enum(["complement", "competitor", "discourse"]),
      source_type_hint: z.enum(["storefront", "forum", "review", "editorial", "video", "any"]),
      rationale: z.string(), // the hypothesis being tested; must not name a final candidate
    }),
    8,
    12,
  ),
  stop_conditions: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// Final output: report_item (design doc §7)
// ---------------------------------------------------------------------------

const itemBase = {
  id: z.string(),
  run_id: z.string(),
  score: z.number().nullable(),
  confidence: Confidence,
  evidence_ids: z.array(z.string()),
  low_evidence: z.boolean(),
  insufficient_evidence: z.boolean(),
  schema_version: z.literal(SCHEMA_VERSION),
};

export const ReportItem = z.discriminatedUnion("kind", [
  z.object({ ...itemBase, kind: z.literal("collaboration_candidate"), payload: CollaborationCandidate }),
  z.object({ ...itemBase, kind: z.literal("competitor"), payload: CompetitorProfile }),
  z.object({ ...itemBase, kind: z.literal("discourse_theme"), payload: DiscourseTheme }),
  z.object({
    ...itemBase,
    kind: z.literal("swot_item"),
    payload: SwotItem.extend({ quadrant: z.enum(["strengths", "weaknesses", "opportunities", "threats"]) }),
  }),
  z.object({ ...itemBase, kind: z.literal("recommended_action"), payload: RecommendedAction }),
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SourceType = z.infer<typeof SourceType>;
export type EvidenceDocument = z.infer<typeof EvidenceDocument>;
export type StoreProfile = z.infer<typeof StoreProfile>;
export type ScoreComponents = z.infer<typeof ScoreComponents>;
export type EntitySeed = z.infer<typeof EntitySeed>;
export type CollaborationCandidateDraft = z.infer<typeof CollaborationCandidateDraft>;
export type CollaborationCandidate = z.infer<typeof CollaborationCandidate>;
export type CompetitorProfileDraft = z.infer<typeof CompetitorProfileDraft>;
export type CompetitorProfile = z.infer<typeof CompetitorProfile>;
export type DiscourseThemeDraft = z.infer<typeof DiscourseThemeDraft>;
export type DiscourseTheme = z.infer<typeof DiscourseTheme>;
export type SampleStats = z.infer<typeof SampleStats>;
export type SwotItem = z.infer<typeof SwotItem>;
export type SwotReport = z.infer<typeof SwotReport>;
export type RecommendedAction = z.infer<typeof RecommendedAction>;
export type ResearchPlan = z.infer<typeof ResearchPlan>;
export type ReportItem = z.infer<typeof ReportItem>;
export type CollaborationOutput = z.infer<typeof CollaborationOutput>;
export type CompetitorDiscourseOutput = z.infer<typeof CompetitorDiscourseOutput>;
export type SwotActionsOutput = z.infer<typeof SwotActionsOutput>;

/** JSON Schema artifacts for non-TypeScript producers and consumers. */
export const JSON_SCHEMAS = {
  evidence_document: zodToJsonSchema(EvidenceDocument, { name: "EvidenceDocument" }),
  store_profile: zodToJsonSchema(StoreProfile, { name: "StoreProfile" }),
  entity_seed: zodToJsonSchema(EntitySeed, { name: "EntitySeed" }),
  research_plan: zodToJsonSchema(ResearchPlan, { name: "ResearchPlan" }),
  collaboration_output: zodToJsonSchema(CollaborationOutput, { name: "CollaborationOutput" }),
  competitor_discourse_output: zodToJsonSchema(CompetitorDiscourseOutput, { name: "CompetitorDiscourseOutput" }),
  swot_actions_output: zodToJsonSchema(SwotActionsOutput, { name: "SwotActionsOutput" }),
  report_item: zodToJsonSchema(ReportItem, { name: "ReportItem" }),
} as const;
