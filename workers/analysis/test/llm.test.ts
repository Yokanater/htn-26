import { describe, expect, it, vi } from "vitest";
import OpenAI from "openai";
import { z } from "zod";
import { OpenAiLlmClient } from "../src/llm/openai.js";
import { FakeLlmClient } from "../src/llm/fake.js";
import { LlmError, SchemaError, type LlmRequest } from "../src/llm/types.js";
import { ResearchPlan } from "../src/contracts.js";
import { fakePlan } from "../src/fixtures/outputs.js";

const Out = z.object({ answer: z.string() });
const req: LlmRequest<z.infer<typeof Out>> = {
  task: "unit", run_id: "run_1", task_id: "task_1", promptVersion: "unit.v1", system: "sys", user: "usr", schema: Out, schemaName: "Out",
};
const okResp = (text: string, extra = {}) => ({ id: "resp_1", _request_id: "req_abc", status: "completed", output_text: text, output: [], usage: { total_tokens: 5 }, ...extra });
const apiError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status, requestID: `req_err_${status}` });

function make(create: ReturnType<typeof vi.fn>, logs: Record<string, unknown>[] = []) {
  const sleep = vi.fn(async () => {});
  const client = new OpenAiLlmClient({ model: "test-model", timeoutMs: 1234, openai: { responses: { create } } as never, logger: (e) => logs.push(e), sleep });
  return { client, sleep, logs };
}

describe("OpenAiLlmClient", () => {
  it("calls Responses API with structured-output format, timeout, and logs request id with run/task ids", async () => {
    const create = vi.fn().mockResolvedValue(okResp('{"answer":"hi"}'));
    const { client, logs } = make(create);
    await expect(client.generate(req)).resolves.toEqual({ answer: "hi" });

    const [body, opts] = create.mock.calls[0]!;
    expect(body).toMatchObject({ model: "test-model", instructions: "sys", input: "usr", store: false });
    expect(body.text.format).toMatchObject({ type: "json_schema", name: "Out", strict: true });
    expect(opts).toMatchObject({ timeout: 1234, maxRetries: 0 });
    expect(logs[0]).toMatchObject({ event: "openai_call", run_id: "run_1", task_id: "task_1", request_id: "req_abc", status: "completed" });
    expect(JSON.stringify(logs)).not.toContain("usr"); // prompts are never logged
  });

  it("retries once with backoff on 429 / 5xx", async () => {
    const create = vi.fn().mockRejectedValueOnce(apiError(429)).mockResolvedValue(okResp('{"answer":"ok"}'));
    const { client, sleep, logs } = make(create);
    await expect(client.generate(req)).resolves.toEqual({ answer: "ok" });
    expect(create).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(logs[0]).toMatchObject({ status: "error", http_status: 429, request_id: "req_err_429", will_retry: true });
  });

  it("retries a connection timeout, but only once", async () => {
    const timeout = new OpenAI.APIConnectionTimeoutError(); // real SDK class: live run showed it has no distinguishing `name`
    const create = vi.fn().mockRejectedValue(timeout);
    const { client } = make(create);
    await expect(client.generate(req)).rejects.toBeInstanceOf(LlmError);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("enforces a hard deadline via AbortSignal and retries once when it fires", async () => {
    const hang = vi.fn((_body: unknown, opts: { signal: AbortSignal }) =>
      new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(new OpenAI.APIUserAbortError()))));
    const logs: Record<string, unknown>[] = [];
    const client = new OpenAiLlmClient({ model: "m", timeoutMs: 20, openai: { responses: { create: hang } } as never, logger: (e) => logs.push(e), sleep: async () => {} });
    await expect(client.generate(req)).rejects.toMatchObject({ name: "LlmError", message: "Timed out after 20ms" });
    expect(hang).toHaveBeenCalledTimes(2);
    expect(logs[0]).toMatchObject({ will_retry: true });
  });

  it("does not retry client errors", async () => {
    const create = vi.fn().mockRejectedValue(apiError(400));
    const { client } = make(create);
    await expect(client.generate(req)).rejects.toMatchObject({ name: "LlmError", status: 400, request_id: "req_err_400" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("throws SchemaError (not retried) for non-JSON, schema-invalid, refused and incomplete outputs", async () => {
    for (const resp of [
      okResp("not json"),
      okResp('{"wrong":1}'),
      okResp("", { output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] }),
      okResp('{"answ', { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }),
    ]) {
      const create = vi.fn().mockResolvedValue(resp);
      const { client } = make(create);
      await expect(client.generate(req)).rejects.toBeInstanceOf(SchemaError);
      expect(create).toHaveBeenCalledTimes(1);
    }
  });

  it("requires OPENAI_MODEL", () => {
    vi.stubEnv("OPENAI_MODEL", "");
    expect(() => new OpenAiLlmClient({ openai: {} as never })).toThrow(/OPENAI_MODEL/);
    vi.unstubAllEnvs();
  });
});

describe("FakeLlmClient", () => {
  const planReq = { ...req, schema: ResearchPlan, schemaName: "ResearchPlan" } as unknown as LlmRequest<z.infer<typeof ResearchPlan>>;

  it("returns fixture output with no network and records calls", async () => {
    const fake = new FakeLlmClient();
    await expect(fake.generate(planReq)).resolves.toEqual(fakePlan);
    expect(fake.calls).toHaveLength(1);
  });

  it("serves scripted responses first, then falls back to the fixture", async () => {
    const fake = new FakeLlmClient({ scripted: { ResearchPlan: [new Error("boom"), { queries: [], stop_conditions: [] }] } });
    await expect(fake.generate(planReq)).rejects.toThrow("boom");
    await expect(fake.generate(planReq)).rejects.toBeInstanceOf(SchemaError); // scripted output violates the 8-12 bound
    await expect(fake.generate(planReq)).resolves.toEqual(fakePlan);
  });

  it("fails loudly on an unknown schema name", async () => {
    await expect(new FakeLlmClient().generate(req)).rejects.toThrow(/no fixture/);
  });
});
