import { fakeCollaboration, fakeCompetitors, fakePlan, fakeSwotActions } from "../fixtures/outputs.js";
import { SchemaError, type LlmClient, type LlmRequest } from "./types.js";

const FIXTURES: Record<string, unknown> = {
  ResearchPlan: fakePlan,
  CollaborationOutput: fakeCollaboration,
  CompetitorDiscourseOutput: fakeCompetitors,
  SwotActionsOutput: fakeSwotActions,
};

/**
 * Deterministic stand-in for OpenAI. Returns fixture outputs keyed by schemaName; no network, no key.
 * `scripted` queues per-schemaName responses used before the fixture (a value is returned, an Error is thrown),
 * so tests can script "bad first, good second".
 */
export class FakeLlmClient implements LlmClient {
  readonly calls: LlmRequest<unknown>[] = [];
  private readonly scripted: Record<string, unknown[]>;

  constructor(opts: { scripted?: Record<string, unknown[]> } = {}) {
    this.scripted = Object.fromEntries(Object.entries(opts.scripted ?? {}).map(([k, v]) => [k, [...v]]));
  }

  async generate<T>(req: LlmRequest<T>): Promise<T> {
    this.calls.push(req as LlmRequest<unknown>);
    const queue = this.scripted[req.schemaName];
    const next = queue?.length ? queue.shift() : FIXTURES[req.schemaName];
    if (next === undefined) throw new Error(`FakeLlmClient has no fixture for schema "${req.schemaName}"`);
    if (next instanceof Error) throw next;
    const parsed = req.schema.safeParse(structuredClone(next));
    if (!parsed.success)
      throw new SchemaError("Fake output failed schema validation", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`), JSON.stringify(next));
    return parsed.data;
  }
}
