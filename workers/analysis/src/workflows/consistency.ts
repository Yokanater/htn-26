import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { CollaborationCandidate, CompetitorProfile, DiscourseTheme, RecommendedAction, SwotReport } from "../contracts.js";
import { norm, renderEvidence, type EvidenceBundle } from "../evidence.js";
import { SchemaError } from "../llm/types.js";
import { CURRENT } from "../prompts.js";
import { findForbiddenAssertions, formatErrors, validateReport, type ValidationError, type ValidationErrorCode } from "../validator.js";
import type { WorkflowCtx } from "./run.js";

const QUADRANTS = ["strengths", "weaknesses", "opportunities", "threats"] as const;

/** The assembled report this stage checks. `swot` is null when that section failed upstream. */
export interface AssembledReport {
  collaboration: CollaborationCandidate[];
  competitors: CompetitorProfile[];
  themes: DiscourseTheme[];
  swot: { swot: SwotReport; actions: RecommendedAction[] } | null;
}

// ---------------------------------------------------------------------------
// Model-facing schema. Deliberately has no evidence_ids field anywhere: this stage
// cannot add or change a citation, only comment on items that already exist.
// ---------------------------------------------------------------------------

export const ConsistencyFinding = z.object({
  id: z.string(),
  kind: z.enum(["cross_section_contradiction", "ignored_conflict", "unsupported_recommendation", "overstated_confidence", "duplicate_point"]),
  severity: z.enum(["info", "warning", "blocking"]),
  item_ids: z.array(z.string()),
  description: z.string(),
  resolution: z.enum(["flag", "rewrite"]),
  rewrite: z
    .object({
      item_id: z.string(),
      revised_claim: z.string(),
      lower_confidence_to: z.enum(["low", "medium"]).nullable(),
    })
    .nullable(),
});

export const ConsistencyOutput = z.object({
  findings: z.array(ConsistencyFinding).max(12),
  summary: z.string(),
});

export type ConsistencyFinding = z.infer<typeof ConsistencyFinding>;
export type ConsistencyOutput = z.infer<typeof ConsistencyOutput>;

export type ConsistencyIssueCode = ValidationErrorCode | "ACTION_EVIDENCE_NOT_UPSTREAM";
export interface ConsistencyIssue {
  code: ConsistencyIssueCode;
  path: string;
  message: string;
}

export interface ConsistencyReport {
  /** Deterministic cross-section findings. Code, not the model, is the authority here. */
  issues: ConsistencyIssue[];
  /** Model findings, after discarding any that name unknown items or smuggle in a forbidden assertion. */
  findings: ConsistencyFinding[];
  applied_rewrites: { item_id: string; before: string; after: string; lowered_confidence_to: string | null }[];
  discarded_findings: { id: string; reason: string }[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Deterministic cross-section checks
// ---------------------------------------------------------------------------

const CONF_RANK = { low: 0, medium: 1, high: 2 } as const;

/**
 * Checks the assembled report as a whole, which per-section validation cannot do:
 *  - the same brand as both a collaborator and a competitor (validateReport's complement check, but
 *    fed the *actual* collaboration output rather than the upstream seeds);
 *  - duplicate items across SWOT quadrants, and strengths/weaknesses that are not about the merchant;
 *  - recommended actions citing evidence no upstream section cites.
 */
export function crossSectionIssues(report: AssembledReport, bundle: EvidenceBundle): ConsistencyIssue[] {
  // A section that failed upstream is absent, not empty: passing [] would trip completeness rules
  // (e.g. "no theme of kind praise") for work that was never produced.
  const issues: ConsistencyIssue[] = validateReport(
    {
      ...(report.collaboration.length ? { collaboration: report.collaboration } : {}),
      ...(report.competitors.length ? { competitors: report.competitors } : {}),
      ...(report.themes.length ? { themes: report.themes } : {}),
      ...(report.swot ? { swot: report.swot.swot, actions: report.swot.actions } : {}),
    },
    bundle,
    { complements: report.collaboration.map((c) => ({ entity_key: c.entity_key ?? norm(c.brand_name), name: c.brand_name })) },
  ).map(({ code, path, message }) => ({ code, path, message }));

  if (report.swot) {
    const upstream = new Set(
      [
        ...report.collaboration.flatMap((c) => c.evidence_ids),
        ...report.competitors.flatMap((c) => c.evidence_ids),
        ...report.themes.flatMap((t) => [...t.evidence_ids, ...t.contradicting_evidence_ids]),
        ...QUADRANTS.flatMap((q) => report.swot!.swot[q].flatMap((it) => it.evidence_ids)),
      ],
    );
    report.swot.actions.forEach((a, i) => {
      const orphans = a.evidence_ids.filter((id) => !upstream.has(id));
      if (orphans.length)
        issues.push({
          code: "ACTION_EVIDENCE_NOT_UPSTREAM",
          path: `actions[${i}]`,
          message: `Action "${a.id}" cites ${orphans.map((o) => `"${o}"`).join(", ")}, which no collaboration, competitor, discourse or SWOT item cites. Actions must trace to an upstream finding.`,
        });
    });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Rewrite application
// ---------------------------------------------------------------------------

type Claimish = { id: string; claim: string; confidence: "low" | "medium" | "high" };

/** Every claim-bearing item in the report, indexed by its payload id. */
function indexItems(report: AssembledReport): Map<string, Claimish> {
  const all: Claimish[] = [
    ...report.collaboration,
    ...report.competitors,
    ...report.themes,
    ...(report.swot ? [...QUADRANTS.flatMap((q) => report.swot!.swot[q]), ...report.swot.actions] : []),
  ];
  return new Map(all.map((it) => [it.id, it]));
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const dir = fileURLToPath(new URL("../../prompts/", import.meta.url));
const read = (file: string) => readFileSync(`${dir}${file}`, "utf8").trim();

/**
 * Loaded here rather than through `loadPrompt` because `PromptName` in src/prompts.ts does not list
 * "consistency" and that file is owned elsewhere. Shared-rules version still comes from CURRENT.
 */
export function consistencyPrompt(v = "v1"): { version: string; system: string } {
  return { version: `consistency.${v}+shared.${CURRENT.shared}`, system: `${read(`shared.${CURRENT.shared}.md`)}\n\n---\n\n${read(`consistency.${v}.md`)}` };
}

/** Compact view of the report for the model: ids, claims and the fields that make incoherence visible. */
function summarize(report: AssembledReport) {
  return {
    collaboration_candidates: report.collaboration.map((c) => ({
      id: c.id, brand: c.brand_name, claim: c.claim, claim_type: c.claim_type, confidence: c.confidence, low_evidence: c.low_evidence,
      use_moment: c.use_moment, is_direct_substitute: c.is_direct_substitute, conflict_note: c.conflict_note,
      activation: c.activation, risk_note: c.risk_note, evidence_ids: c.evidence_ids,
    })),
    competitors: report.competitors.map((c) => ({
      id: c.id, name: c.name, classification: c.classification, reason: c.classification_reason,
      claim: c.claim, confidence: c.confidence, low_evidence: c.low_evidence, evidence_ids: c.evidence_ids,
    })),
    discourse_themes: report.themes.map((t) => ({
      id: t.id, kind: t.theme_kind, about: t.about, claim: t.claim, confidence: t.confidence, low_evidence: t.low_evidence,
      contradiction_note: t.contradiction_note, sampling_bias_note: t.sampling_bias_note, sample: t.sample, evidence_ids: t.evidence_ids,
    })),
    swot: report.swot
      ? Object.fromEntries(
          QUADRANTS.map((q) => [
            q,
            report.swot!.swot[q].map((it) => ({ id: it.id, subject: it.subject, claim: it.claim, claim_type: it.claim_type, confidence: it.confidence, insufficient_evidence: it.insufficient_evidence, evidence_ids: it.evidence_ids })),
          ]),
        )
      : null,
    actions: report.swot
      ? report.swot.actions.map((a) => ({
          id: a.id, rank: a.rank, title: a.title, action: a.action, claim: a.claim, confidence: a.confidence,
          expected_impact: a.expected_impact, effort: a.effort, experiment: a.cheapest_falsifying_experiment, evidence_ids: a.evidence_ids,
        }))
      : null,
  };
}

/** Only the documents the report actually cites: this stage verifies coherence, it does not go looking for new material. */
function citedOnly(report: AssembledReport, bundle: EvidenceBundle): EvidenceBundle {
  const ids = new Set<string>();
  for (const it of [...report.collaboration, ...report.competitors, ...report.themes]) {
    it.evidence_ids.forEach((id) => ids.add(id));
    if ("contradicting_evidence_ids" in it) it.contradicting_evidence_ids.forEach((id) => ids.add(id));
  }
  if (report.swot)
    for (const it of [...QUADRANTS.flatMap((q) => report.swot!.swot[q]), ...report.swot.actions]) it.evidence_ids.forEach((id) => ids.add(id));
  return { ...bundle, documents: bundle.documents.filter((d) => ids.has(d.id)) };
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

/**
 * Final cross-section check (design doc §5 Phase F). Runs deterministic checks first, then asks the model only
 * about substantive incoherence. Model output can flag items or rewrite one claim's wording; it can never add a
 * fact, change a citation, raise a confidence, or touch scores / low_evidence / sample stats.
 *
 * Returns the (possibly patched) report alongside the findings. Callers treat a throw as a soft failure.
 */
export async function checkConsistency(
  bundle: EvidenceBundle,
  report: AssembledReport,
  ctx: WorkflowCtx,
): Promise<{ report: AssembledReport; consistency: ConsistencyReport }> {
  const issues = crossSectionIssues(report, bundle);
  const prompt = consistencyPrompt();
  const cited = citedOnly(report, bundle);
  const baseUser = [
    `<store_profile>\n${JSON.stringify(bundle.profile, null, 2)}\n</store_profile>`,
    `<assembled_report untrusted="true">\n${JSON.stringify(summarize(report), null, 2)}\n</assembled_report>`,
    `<deterministic_issues>\n${issues.length ? formatErrors(issues as ValidationError[]) : "None. Code found no cross-section problems."}\n</deterministic_issues>`,
    renderEvidence(cited.documents),
    "Check the report for cross-section incoherence and return your findings.",
  ].join("\n\n");

  // Local retry loop: unlike the other workflows there is no deterministic schema for "a correct finding",
  // so the only retryable failure is malformed output.
  let out: ConsistencyOutput | undefined;
  let lastIssues: string[] = [];
  for (let attempt = 1; attempt <= 2 && !out; attempt++) {
    try {
      out = await ctx.client.generate({
        task: "consistency", run_id: ctx.run_id, task_id: `consistency#${attempt}`, promptVersion: prompt.version,
        system: prompt.system, schema: ConsistencyOutput, schemaName: "ConsistencyOutput",
        user: attempt === 1 ? baseUser : `${baseUser}\n\n<validation_feedback>\nYour previous output was rejected:\n${lastIssues.map((i) => `- ${i}`).join("\n")}\n\nReturn a corrected output.\n</validation_feedback>`,
      });
    } catch (err) {
      if (!(err instanceof SchemaError) || attempt === 2) throw err;
      lastIssues = err.issues;
      ctx.log?.({ event: "workflow_retry", run_id: ctx.run_id, task: "consistency", errors: err.issues.map((message) => ({ code: "SCHEMA_INVALID", path: "(output)", message })) });
    }
  }

  const patched = structuredClone(report);
  const index = indexItems(patched);
  const findings: ConsistencyFinding[] = [];
  const applied: ConsistencyReport["applied_rewrites"] = [];
  const discarded: ConsistencyReport["discarded_findings"] = [];

  for (const f of out!.findings) {
    const unknown = f.item_ids.filter((id) => !index.has(id));
    if (unknown.length) {
      discarded.push({ id: f.id, reason: `names unknown item(s) ${unknown.join(", ")}` });
      continue;
    }
    const hit = findForbiddenAssertions(`${f.description} ${f.rewrite?.revised_claim ?? ""}`);
    if (hit.length) {
      discarded.push({ id: f.id, reason: `asserts ${hit[0]!.kind.replace("_", " ")} ("${hit[0]!.match}")` });
      continue;
    }

    const target = f.rewrite ? index.get(f.rewrite.item_id) : undefined;
    if (f.rewrite && !target) {
      discarded.push({ id: f.id, reason: `rewrites unknown item ${f.rewrite.item_id}` });
      continue;
    }
    if (f.rewrite && target && f.rewrite.revised_claim.trim()) {
      const before = target.claim;
      const beforeConf = target.confidence;
      const lower = f.rewrite.lower_confidence_to;
      target.claim = f.rewrite.revised_claim.trim();
      if (lower && CONF_RANK[lower] < CONF_RANK[beforeConf]) target.confidence = lower;

      // A rewrite may not break anything code already guarantees; if it does, put the item back.
      const broke = crossSectionIssues(patched, bundle);
      if (broke.length > issues.length) {
        target.claim = before;
        target.confidence = beforeConf;
        discarded.push({ id: f.id, reason: "rewrite introduced a validation error" });
        continue;
      }
      applied.push({ item_id: f.rewrite.item_id, before, after: target.claim, lowered_confidence_to: target.confidence === beforeConf ? null : target.confidence });
    }
    findings.push(f);
  }

  return { report: patched, consistency: { issues, findings, applied_rewrites: applied, discarded_findings: discarded, summary: out!.summary } };
}
