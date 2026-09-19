import type { z } from "zod";

export interface LlmRequest<T> {
  task: string; // workflow name, e.g. "collaboration"
  run_id: string;
  task_id: string;
  promptVersion: string; // e.g. "collaboration.v1+shared.v2"
  system: string;
  user: string;
  schema: z.ZodType<T>;
  schemaName: string; // Structured Outputs schema name; also how the fake picks its fixture
}

export interface LlmClient {
  generate<T>(req: LlmRequest<T>): Promise<T>;
}

/** The model answered, but not with schema-valid JSON (or it refused). Workflows feed `issues` back for a retry. */
export class SchemaError extends Error {
  constructor(
    message: string,
    public readonly issues: string[],
    public readonly raw: string,
  ) {
    super(message);
    this.name = "SchemaError";
  }
}

/** Transport / API failure after the client's own retry. */
export class LlmError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly request_id?: string | null,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export type Logger = (event: Record<string, unknown>) => void;
export const stderrLogger: Logger = (event) => console.error(JSON.stringify(event));
