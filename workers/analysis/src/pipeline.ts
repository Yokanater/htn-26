import { z } from "zod";
import {
  EntitySeed, EvidenceDocument, ReportItem, SCHEMA_VERSION, StoreProfile,
  type CollaborationCandidate, type CompetitorProfile, type DiscourseTheme, type RecommendedAction, type SwotReport,
} from "./contracts.js";
import { selectEvidence, type EvidenceBundle } from "./evidence.js";
import type { LlmClient, Logger } from "./llm/types.js";
import type { ValidationError } from "./validator.js";
import { analyzeCompetitors } from "./workflows/competitors.js";
import { scoutCollaborators } from "./workflows/collaboration.js";
import { isLowEvidence } from "./workflows/finalize.js";
import { WorkflowError, type WorkflowCtx } from "./workflows/run.js";
import { synthesizeSwot } from "./workflows/swot.js";

export type Section = "collaboration" | "competitors_discourse" | "swot_actions";

export interface AnalysisOptions {
  client: LlmClient;
  logger?: Logger;
  seeds?: EntitySeed[]; // upstream score components; joined onto model output by entity_key
  run_id?: string;
  maxItems?: number; // evidence bundle size; default 40
  now?: Date; // freshness reference; default now
  quarantineInjections?: boolean; // default true; false lets injection-looking docs reach the model (fenced), for red-teaming
}

export interface AnalysisResult {
  run_id: string;
  status: "completed" | "partial" | "failed";
  missing_sections: { section: Section; reason: string; errors?: ValidationError[] }[];
  items: ReportItem[];
  bundle: { included: string[]; excluded: EvidenceBundle["excluded"] };
}

const failure = (section: Section, err: unknown) => ({
  section,
  reason: err instanceof Error ? err.message.split("\n")[0]! : String(err),
  ...(err instanceof WorkflowError ? { errors: err.errors } : {}),
});

export async function runAnalysis(profileIn: StoreProfile, evidenceIn: EvidenceDocument[], opts: AnalysisOptions): Promise<AnalysisResult> {
  const profile = StoreProfile.parse(profileIn);
  const evidence = z.array(EvidenceDocument).parse(evidenceIn);
  const seeds = z.array(EntitySeed).parse(opts.seeds ?? []);
  const run_id = opts.run_id ?? `run_${Date.now().toString(36)}`;
  const ctx: WorkflowCtx = { client: opts.client, run_id, log: opts.logger };
  const bundle = selectEvidence(profile, evidence, { maxItems: opts.maxItems ?? 40, now: opts.now, quarantineInjections: opts.quarantineInjections });

  const missing: AnalysisResult["missing_sections"] = [];
  const [collab, comp] = await Promise.allSettled([scoutCollaborators(bundle, seeds, ctx), analyzeCompetitors(bundle, seeds, ctx)]);
  if (collab.status === "rejected") missing.push(failure("collaboration", collab.reason));
  if (comp.status === "rejected") missing.push(failure("competitors_discourse", comp.reason));

  const upstream = {
    collaboration: collab.status === "fulfilled" ? collab.value : [],
    competitors: comp.status === "fulfilled" ? comp.value.competitors : [],
    themes: comp.status === "fulfilled" ? comp.value.themes : [],
  };
  let swot: { swot: SwotReport; actions: RecommendedAction[] } | null = null;
  try {
    swot = await synthesizeSwot(bundle, upstream, ctx);
  } catch (err) {
    missing.push(failure("swot_actions", err));
  }

  const items = toReportItems(run_id, bundle, upstream, swot);
  return {
    run_id,
    status: missing.length === 0 ? "completed" : missing.length === 3 ? "failed" : "partial",
    missing_sections: missing,
    items,
    bundle: { included: bundle.documents.map((d) => d.id), excluded: bundle.excluded },
  };
}

function toReportItems(
  run_id: string,
  bundle: EvidenceBundle,
  up: { collaboration: CollaborationCandidate[]; competitors: CompetitorProfile[]; themes: DiscourseTheme[] },
  swot: { swot: SwotReport; actions: RecommendedAction[] } | null,
): ReportItem[] {
  const base = (p: { id: string; confidence: "low" | "medium" | "high"; evidence_ids: string[]; insufficient_evidence: boolean }, kind: string, score: number | null, low?: boolean) => ({
    id: `${kind}/${p.id}`, run_id, score, confidence: p.confidence, evidence_ids: p.evidence_ids,
    low_evidence: low ?? isLowEvidence(p.evidence_ids, bundle), insufficient_evidence: p.insufficient_evidence, schema_version: SCHEMA_VERSION,
  });
  const items = [
    ...up.collaboration.map((p) => ({ ...base(p, "collaboration_candidate", p.score_components?.total ?? null, p.low_evidence), kind: "collaboration_candidate" as const, payload: p })),
    ...up.competitors.map((p) => ({ ...base(p, "competitor", p.score_components?.total ?? null, p.low_evidence), kind: "competitor" as const, payload: p })),
    ...up.themes.map((p) => ({ ...base(p, "discourse_theme", null, p.low_evidence), kind: "discourse_theme" as const, payload: p })),
    ...(swot
      ? [
          ...(["strengths", "weaknesses", "opportunities", "threats"] as const).flatMap((quadrant) =>
            swot.swot[quadrant].map((p) => ({ ...base(p, "swot_item", null), kind: "swot_item" as const, payload: { ...p, quadrant } })),
          ),
          ...swot.actions.map((p) => ({ ...base(p, "recommended_action", null), kind: "recommended_action" as const, payload: p })),
        ]
      : []),
  ];
  return items.map((i) => ReportItem.parse(i)); // the output contract is enforced, not assumed
}
