import { CompetitorDiscourseOutput, type CompetitorProfile, type DiscourseTheme, type EntitySeed } from "../contracts.js";
import { renderEvidence, type EvidenceBundle } from "../evidence.js";
import { validateReport } from "../validator.js";
import { isLowEvidence, sampleStats, scoreFor } from "./finalize.js";
import { runWorkflow, type WorkflowCtx } from "./run.js";

export async function analyzeCompetitors(
  bundle: EvidenceBundle,
  seeds: EntitySeed[],
  ctx: WorkflowCtx,
): Promise<{ competitors: CompetitorProfile[]; themes: DiscourseTheme[] }> {
  const hints = seeds.filter((s) => s.kind === "competitor").map((s) => ({ entity_key: s.entity_key, name: s.name, upstream_score_total: s.score_components.total }));
  const out = await runWorkflow({
    ctx, task: "competitors", prompt: "competitor_discourse", schema: CompetitorDiscourseOutput, schemaName: "CompetitorDiscourseOutput",
    user: [
      `<store_profile>\n${JSON.stringify(bundle.profile, null, 2)}\n</store_profile>`,
      `<candidate_seeds>\n${JSON.stringify(hints, null, 2)}\n</candidate_seeds>`,
      renderEvidence(bundle.documents),
      "Produce the competitor profiles and discourse themes.",
    ].join("\n\n"),
    validate: (o) => validateReport({ competitors: o.competitors, themes: o.themes }, bundle),
  });
  return {
    competitors: [...out.competitors]
      .map((c) => ({ ...c, score_components: scoreFor(c.entity_key, "competitor", seeds), low_evidence: isLowEvidence(c.evidence_ids, bundle) }))
      .sort((a, b) => a.rank - b.rank || (b.score_components?.total ?? 0) - (a.score_components?.total ?? 0))
      .map((c, i) => ({ ...c, rank: i + 1 })),
    themes: out.themes.map((t) => ({
      ...t,
      sample: sampleStats(t.evidence_ids, t.contradicting_evidence_ids, bundle),
      low_evidence: isLowEvidence(t.evidence_ids, bundle),
    })),
  };
}
