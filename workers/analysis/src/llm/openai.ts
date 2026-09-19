import OpenAI, { APIConnectionError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { LlmError, SchemaError, stderrLogger, type LlmClient, type LlmRequest, type Logger } from "./types.js";

export interface OpenAiClientOptions {
  apiKey?: string; // default: OPENAI_API_KEY
  model?: string; // default: OPENAI_MODEL (required)
  timeoutMs?: number; // per attempt; default OPENAI_TIMEOUT_MS or 120s
  maxRetries?: number; // transport retries; default 1
  backoffMs?: number; // base backoff; default 500
  logger?: Logger;
  openai?: Pick<OpenAI, "responses">; // injectable for tests
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE_STATUS = new Set([408, 409, 429]);

function isRetryable(err: unknown, timedOut: boolean): boolean {
  if (timedOut) return true; // our hard deadline fired (surfaces as APIUserAbortError)
  const e = err as { status?: number };
  if (typeof e.status === "number") return RETRYABLE_STATUS.has(e.status) || e.status >= 500;
  // SDK errors do not set `name`, so match the classes: APIConnectionError covers APIConnectionTimeoutError.
  return err instanceof APIConnectionError;
}

export class OpenAiLlmClient implements LlmClient {
  private readonly openai: Pick<OpenAI, "responses">;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly backoffMs: number;
  private readonly log: Logger;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: OpenAiClientOptions = {}) {
    const model = opts.model ?? process.env.OPENAI_MODEL;
    if (!model) throw new Error("OPENAI_MODEL is not set");
    this.model = model;
    this.timeoutMs = opts.timeoutMs ?? Number(process.env.OPENAI_TIMEOUT_MS ?? 240_000);
    this.maxRetries = opts.maxRetries ?? 1;
    this.backoffMs = opts.backoffMs ?? 500;
    this.log = opts.logger ?? stderrLogger;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.openai = opts.openai ?? new OpenAI({ apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY, maxRetries: 0 });
  }

  async generate<T>(req: LlmRequest<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const started = Date.now();
      const ctx = { event: "openai_call", run_id: req.run_id, task_id: req.task_id, task: req.task, prompt: req.promptVersion, model: this.model, attempt };
      let resp;
      const deadline = AbortSignal.timeout(this.timeoutMs); // the SDK's own `timeout` proved unreliable: a live call ran 1164s
      try {
        resp = await this.openai.responses.create(
          {
            model: this.model,
            instructions: req.system,
            input: req.user,
            text: { format: zodTextFormat(req.schema, req.schemaName) },
            store: false, // evidence bundles are not kept server-side
          },
          { timeout: this.timeoutMs, maxRetries: 0, signal: deadline },
        );
      } catch (err) {
        const e = err as { status?: number; requestID?: string | null; message?: string };
        const retry = attempt < this.maxRetries && isRetryable(err, deadline.aborted);
        this.log({ ...ctx, status: "error", http_status: e.status ?? null, request_id: e.requestID ?? null, latency_ms: Date.now() - started, will_retry: retry, error: e.message });
        if (!retry) throw new LlmError(deadline.aborted ? `Timed out after ${this.timeoutMs}ms` : (e.message ?? String(err)), e.status, e.requestID);
        await this.sleep(this.backoffMs * 2 ** attempt * (0.5 + Math.random()));
        continue;
      }

      const request_id = (resp as { _request_id?: string | null })._request_id ?? null;
      this.log({ ...ctx, status: resp.status ?? "unknown", request_id, response_id: resp.id, latency_ms: Date.now() - started, usage: resp.usage ?? null });

      const refusal = resp.output.flatMap((o) => (o.type === "message" ? o.content : [])).find((c) => c.type === "refusal");
      if (refusal && "refusal" in refusal) throw new SchemaError("Model refused", [`refusal: ${refusal.refusal}`], "");
      if (resp.status === "incomplete")
        throw new SchemaError("Response incomplete", [`response incomplete: ${resp.incomplete_details?.reason ?? "unknown"}`], resp.output_text ?? "");

      const raw = resp.output_text ?? "";
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        throw new SchemaError("Model output was not valid JSON", ["output is not valid JSON"], raw);
      }
      const parsed = req.schema.safeParse(json);
      if (!parsed.success)
        throw new SchemaError("Model output failed schema validation", parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`), raw);
      return parsed.data;
    }
  }
}
