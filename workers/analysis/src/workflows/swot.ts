import { SwotActionsOutput, type CollaborationCandidate, type CompetitorProfile, type DiscourseTheme } from "../contracts.js";
import { renderEvidence, type EvidenceBundle } from "../evidence.js";
import { validateReport } from "../validator.js";
import { cleanExplanation, rankActions } from "./finalize.js";
import { runWorkflow, type WorkflowCtx } from "./run.js";

export interface Upstream {
  collaboration: CollaborationCandidate[];
  competitors: CompetitorProfile[];
  themes: DiscourseTheme[];
}

/** Only evidence that upstream items cite (plus the merchant's own pages) is visible and citable. Falls back to the full bundle if no upstream survived. */
export function narrowBundle(bundle: EvidenceBundle, up: Upstream): EvidenceBundle {
  const ids = new Set<string>();
  for (const it of [...up.collaboration, ...up.competitors, ...up.themes]) {
    it.evidence_ids.forEach((id) => ids.add(id));
    if ("contradicting_evidence_ids" in it) it.contradicting_evidence_ids.forEach((id) => ids.add(id));
  }
  if (ids.size === 0) return bundle;
  return { ...bundle, documents: bundle.documents.filter((d) => ids.has(d.id) || d.origin === "merchant_owned") };
}

export async function synthesizeSwot(bundle: EvidenceBundle, up: Upstream, ctx: WorkflowCtx) {
  const scoped = narrowBundle(bundle, up);
  const findings = {
    collaboration_candidates: up.collaboration.map((c) => ({ id: c.id, brand: c.brand_name, claim: c.claim, confidence: c.confidence, evidence_ids: c.evidence_ids, low_evidence: c.low_evidence })),
    competitors: up.competitors.map((c) => ({ id: c.id, name: c.name, classification: c.classification, claim: c.claim, confidence: c.confidence, evidence_ids: c.evidence_ids, low_evidence: c.low_evidence })),
    discourse_themes: up.themes.map((t) => ({ id: t.id, kind: t.theme_kind, about: t.about, claim: t.claim, confidence: t.confidence, evidence_ids: t.evidence_ids, contradicting_evidence_ids: t.contradicting_evidence_ids, contradiction_note: t.contradiction_note, sampling_bias_note: t.sampling_bias_note })),
  };
  const out = await runWorkflow({
    ctx, task: "swot", prompt: "swot_actions", schema: SwotActionsOutput, schemaName: "SwotActionsOutput",
    user: [
      `<store_profile>\n${JSON.stringify(scoped.profile, null, 2)}\n</store_profile>`,
      `<upstream_findings untrusted="true">\n${JSON.stringify(findings, null, 2)}\n</upstream_findings>`,
      renderEvidence(scoped.documents),
      "Produce the SWOT and the three recommended actions.",
    ].join("\n\n"),
    validate: (o) => validateReport({ swot: o.swot, actions: o.actions }, scoped),
  });
  const q = (items: typeof out.swot.strengths) => items.map(cleanExplanation);
  return {
    swot: { strengths: q(out.swot.strengths), weaknesses: q(out.swot.weaknesses), opportunities: q(out.swot.opportunities), threats: q(out.swot.threats) },
    actions: rankActions(out.actions.map(cleanExplanation)),
  };
}
