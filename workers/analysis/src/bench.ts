import { mkdirSync, writeFileSync } from "node:fs";
import { evaluate, gateFailures } from "./eval.js";
import { findStore } from "./fixtures/stores/index.js";
import { OpenAiLlmClient } from "./llm/openai.js";
import type { LlmClient, LlmRequest } from "./llm/types.js";

/** Live benchmark: N full reports, per-workflow first-pass failure rate, latency and tokens.
 *  Usage: npm run bench -- [--runs 5] [--concurrency 3] [--label name] [--store coffee] [--no-quarantine]
 *  Optional cost: OPENAI_PRICE_IN / OPENAI_PRICE_OUT = USD per 1M tokens (not assumed; unset => tokens only). */
const arg = (n: string, d: string) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1]! : d);
try { process.loadEnvFile(".env"); } catch { /* env only */ }

interface Call { task: string; attempt: number; ms: number; input: number; output: number; reasoning: number; failedFirst?: string[] }

async function one(i: number, quarantine: boolean) {
  const run_id = `bench${i}`;
  const calls: Call[] = [];
  const retries: Record<string, unknown>[] = [];
  const usage = new Map<string, { input: number; output: number; reasoning: number }>();
  const inner = new OpenAiLlmClient({
    logger: (e) => {
      if (e.status === "completed" || e.status === "incomplete") {
        const u = (e.usage ?? {}) as { input_tokens?: number; output_tokens?: number; output_tokens_details?: { reasoning_tokens?: number } };
        usage.set(String(e.task_id), { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, reasoning: u.output_tokens_details?.reasoning_tokens ?? 0 });
      } else if (e.status === "error") console.error(JSON.stringify({ run: i, ...e }));
    },
  });
  const tap: LlmClient = {
    async generate<T>(req: LlmRequest<T>) {
      const t0 = Date.now();
      const attempt = Number(req.task_id.split("#")[1]);
      const feedback = attempt > 1 ? [...req.user.matchAll(/^- \[([A-Z_]+)\]/gm)].map((m) => m[1]!) : undefined;
      try { return await inner.generate(req); }
      finally {
        const u = usage.get(req.task_id) ?? { input: 0, output: 0, reasoning: 0 };
        calls.push({ task: req.task, attempt, ms: Date.now() - t0, ...u, ...(feedback ? { failedFirst: feedback } : {}) });
      }
    },
  };
  const r = await evaluate(tap, { store, quarantineInjections: quarantine, run_id, logger: (e) => { if (e.event === "workflow_retry") retries.push(e); } });
  console.error(`run ${i}: status=${r.result.status} gates=${gateFailures(r).join(";") || "ok"}`);
  return { calls, r, retries };
}

const store = findStore(arg("store", "coffee"));
const runs = Number(arg("runs", "5"));
const conc = Number(arg("concurrency", "3"));
const label = arg("label", "bench");
const quarantine = !process.argv.includes("--no-quarantine");
const results: Awaited<ReturnType<typeof one>>[] = [];
for (let i = 0; i < runs; i += conc)
  results.push(...(await Promise.all(Array.from({ length: Math.min(conc, runs - i) }, (_, k) => one(i + k + 1, quarantine)))));

const tasks = ["collaboration", "competitors", "swot"];
const pIn = Number(process.env.OPENAI_PRICE_IN), pOut = Number(process.env.OPENAI_PRICE_OUT);
const priced = pIn > 0 && pOut > 0;
const rows = tasks.map((t) => {
  const first = results.flatMap((x) => x.calls.filter((c) => c.task === t && c.attempt === 1));
  const failed = results.flatMap((x) => x.calls.filter((c) => c.task === t && c.attempt === 2));
  const all = results.flatMap((x) => x.calls.filter((c) => c.task === t));
  const codes = failed.flatMap((c) => c.failedFirst ?? []);
  return {
    workflow: t, first_pass_failures: `${failed.length}/${first.length}`,
    codes: [...new Set(codes)].join(",") || "-",
    latency_avg_s: (all.reduce((a, c) => a + c.ms, 0) / Math.max(1, all.length) / 1000).toFixed(0),
    latency_max_s: (Math.max(0, ...all.map((c) => c.ms)) / 1000).toFixed(0),
    tokens_in_per_report: Math.round(all.reduce((a, c) => a + c.input, 0) / runs),
    tokens_out_per_report: Math.round(all.reduce((a, c) => a + c.output, 0) / runs),
    reasoning_per_report: Math.round(all.reduce((a, c) => a + c.reasoning, 0) / runs),
  };
});
const tin = rows.reduce((a, r) => a + r.tokens_in_per_report, 0), tout = rows.reduce((a, r) => a + r.tokens_out_per_report, 0);
console.table(rows);
console.log(`per full report: ${tin} in + ${tout} out tokens${priced ? ` = $${((tin * pIn + tout * pOut) / 1e6).toFixed(3)}` : " (set OPENAI_PRICE_IN/OUT for $)"}`);
console.log(`statuses: ${results.map((x) => x.r.result.status).join(", ")}; wall time/report ≈ ${(results.reduce((a, x) => a + Math.max(...x.calls.map((c) => c.ms)), 0) / runs / 1000).toFixed(0)}s (longest call)`);
mkdirSync("runs", { recursive: true });
writeFileSync(`runs/${label}.json`, JSON.stringify({ rows, results: results.map((x) => ({ calls: x.calls, retries: x.retries, status: x.r.result.status, missing: x.r.result.missing_sections, first_pass: x.r.first_pass, shipped: x.r.shipped, grades: x.r.grades, low_evidence: x.r.low_evidence, injection: x.r.injection, items: x.r.result.items })) }, null, 2));
