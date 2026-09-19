import { CollaborationOutput, type CollaborationCandidate, type EntitySeed } from "../contracts.js";
import { renderEvidence, type EvidenceBundle } from "../evidence.js";
import { validateReport } from "../validator.js";
import { isLowEvidence, scoreFor } from "./finalize.js";
import { runWorkflow, type WorkflowCtx } from "./run.js";

export async function scoutCollaborators(bundle: EvidenceBundle, seeds: EntitySeed[], ctx: WorkflowCtx): Promise<CollaborationCandidate[]> {
  const hints = seeds.filter((s) => s.kind === "collaboration").map((s) => ({ entity_key: s.entity_key, name: s.name, upstream_score_total: s.score_components.total }));
  const out = await runWorkflow({
    ctx, task: "collaboration", prompt: "collaboration", schema: CollaborationOutput, schemaName: "CollaborationOutput",
    user: [
      `<store_profile>\n${JSON.stringify(bundle.profile, null, 2)}\n</store_profile>`,
      `<candidate_seeds>\n${JSON.stringify(hints, null, 2)}\n</candidate_seeds>`,
      renderEvidence(bundle.documents),
      "Produce the ranked collaboration candidates.",
    ].join("\n\n"),
    validate: (o) => validateReport({ collaboration: o.candidates }, bundle),
  });
  return [...out.candidates]
    .map((c) => ({ ...c, score_components: scoreFor(c.entity_key, "collaboration", seeds), low_evidence: isLowEvidence(c.evidence_ids, bundle) }))
    .sort((a, b) => a.rank - b.rank || (b.score_components?.total ?? 0) - (a.score_components?.total ?? 0))
    .map((c, i) => ({ ...c, rank: i + 1 }));
}
