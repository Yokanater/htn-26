import { ResearchPlan, type StoreProfile } from "../contracts.js";
import { norm } from "../evidence.js";
import type { ValidationError } from "../validator.js";
import { runWorkflow, type WorkflowCtx } from "./run.js";

const MAX_QUERY_CHARS = 120;

export function validatePlan(plan: ResearchPlan, knownEntityNames: string[] = []): ValidationError[] {
  const errors: ValidationError[] = [];
  const bad = (path: string, message: string) => errors.push({ code: "PLAN_INVALID", path, message });
  const seen = new Set<string>();
  const names = knownEntityNames.map(norm).filter(Boolean);

  plan.queries.forEach((q, i) => {
    const path = `queries[${i}]`;
    if (q.query.length > MAX_QUERY_CHARS) bad(path, `Query is over ${MAX_QUERY_CHARS} characters.`);
    if (/https?:\/\/|\bsite:|www\./i.test(q.query)) bad(path, "Queries must be plain search text: no URLs or site: operators.");
    const key = norm(q.query);
    if (seen.has(key)) bad(path, "Duplicate query.");
    seen.add(key);
    const hit = names.find((n) => norm(`${q.query} ${q.rationale}`).includes(n));
    if (hit) bad(path, `Names a candidate ("${hit}"). The planner may describe categories and hypotheses but must not name final candidates.`);
  });
  for (const intent of ["complement", "competitor", "discourse"] as const)
    if (plan.queries.filter((q) => q.intent === intent).length < 2) bad("queries", `Need at least 2 "${intent}" queries.`);
  return errors;
}

/** Phase B: runs before any evidence exists. `knownEntityNames` (e.g. seeds) lets us reject plans that name candidates. */
export function planQueries(profile: StoreProfile, ctx: WorkflowCtx, knownEntityNames: string[] = []): Promise<ResearchPlan> {
  return runWorkflow({
    ctx, task: "planner", prompt: "planner", schema: ResearchPlan, schemaName: "ResearchPlan",
    user: `<store_profile>\n${JSON.stringify(profile, null, 2)}\n</store_profile>\n\nProduce the research plan.`,
    validate: (plan) => validatePlan(plan, knownEntityNames),
  });
}
