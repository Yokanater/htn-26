import type { z } from "zod";
import { SchemaError, type LlmClient, type Logger } from "../llm/types.js";
import { loadPrompt, type PromptName } from "../prompts.js";
import { formatErrors, type ValidationError } from "../validator.js";

export interface WorkflowCtx {
  client: LlmClient;
  run_id: string;
  log?: Logger; // receives "workflow_retry" events with the validation errors that forced a retry
}

export class WorkflowError extends Error {
  constructor(
    public readonly task: string,
    public readonly errors: ValidationError[],
  ) {
    super(`${task} failed validation after retry:\n${formatErrors(errors)}`);
    this.name = "WorkflowError";
  }
}

/**
 * Call the model, validate deterministically, and on failure retry once with the errors (and the rejected output)
 * fed back. Transport errors are the client's business and propagate unchanged.
 */
export async function runWorkflow<T>(args: {
  ctx: WorkflowCtx;
  task: string;
  prompt: PromptName;
  schema: z.ZodType<T>;
  schemaName: string;
  user: string;
  validate: (out: T) => ValidationError[];
}): Promise<T> {
  const { ctx, task, schema, schemaName, validate } = args;
  const prompt = loadPrompt(args.prompt);
  let user = args.user;
  let errors: ValidationError[] = [];

  for (let attempt = 1; attempt <= 2; attempt++) {
    let rejected: string;
    try {
      const out = await ctx.client.generate({
        task, run_id: ctx.run_id, task_id: `${task}#${attempt}`, promptVersion: prompt.version, system: prompt.system, user, schema, schemaName,
      });
      errors = validate(out);
      if (errors.length === 0) return out;
      rejected = JSON.stringify(out);
    } catch (err) {
      if (!(err instanceof SchemaError)) throw err;
      errors = err.issues.map((message) => ({ code: "SCHEMA_INVALID" as const, path: "(output)", message }));
      rejected = err.raw;
    }
    if (attempt === 1) ctx.log?.({ event: "workflow_retry", run_id: ctx.run_id, task, errors: errors.map(({ code, path, message }) => ({ code, path, message })) });
    user = `${args.user}\n\n<validation_feedback>\nYour previous output was rejected by deterministic validation:\n${formatErrors(errors)}\n\nRejected output:\n${rejected}\n\nReturn a corrected, complete output that fixes every error. Do not add claims that lack evidence.\n</validation_feedback>`;
  }
  throw new WorkflowError(task, errors);
}
