import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { EntitySeed, EvidenceDocument, StoreProfile } from "./contracts.js";
import { coffeeEvidence } from "./fixtures/evidence.js";
import { coffeeProfile, FIXTURE_NOW } from "./fixtures/profile.js";
import { coffeeSeeds } from "./fixtures/seeds.js";
import { FakeLlmClient } from "./llm/fake.js";
import { OpenAiLlmClient } from "./llm/openai.js";
import { stderrLogger, type LlmClient } from "./llm/types.js";
import { runAnalysis } from "./pipeline.js";
import { planQueries } from "./workflows/planner.js";

const USAGE = `Usage: npm run analyze -- (--fixture [coffee] | --live) [--input file.json] [--plan] [--max-items N] [--out file]
  --fixture   built-in coffee fixtures with the deterministic fake client, no API key needed
  --live      OpenAI Responses API (needs OPENAI_API_KEY and OPENAI_MODEL; reads .env if present).
              On its own it runs on the coffee fixtures; "--fixture coffee --live" is equivalent.
  --input     JSON {profile, evidence, seeds?} instead of the built-in coffee fixtures
  --plan      also run the research planner and include its plan in the output
  --out       write JSON here instead of stdout`;

export function parseArgs(argv: string[]) {
  const flag = (n: string) => argv.includes(`--${n}`);
  const value = (n: string) => argv[argv.indexOf(`--${n}`) + 1];
  const fixture = flag("fixture");
  const live = flag("live");
  if (!fixture && !live) throw new Error("Pass --fixture (fake client) and/or --live (OpenAI)");
  const named = fixture ? value("fixture") : undefined;
  if (named && !named.startsWith("--") && named !== "coffee") throw new Error(`Unknown fixture "${named}" (only "coffee")`);
  const maxItems = flag("max-items") ? Number(value("max-items")) : undefined;
  if (maxItems !== undefined && !(maxItems > 0)) throw new Error("--max-items must be a positive number");
  return { live, plan: flag("plan"), input: flag("input") ? value("input") : undefined, out: flag("out") ? value("out") : undefined, maxItems };
}

export async function cli(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error(`${(e as Error).message}\n\n${USAGE}`);
    return 64;
  }

  let client: LlmClient;
  if (args.live) {
    try { process.loadEnvFile(".env"); } catch { /* no .env: rely on the environment */ }
    if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) {
      console.error("--live requires OPENAI_API_KEY and OPENAI_MODEL");
      return 64;
    }
    client = new OpenAiLlmClient();
  } else {
    client = new FakeLlmClient();
  }

  let input = { profile: coffeeProfile, evidence: coffeeEvidence, seeds: coffeeSeeds };
  if (args.input) {
    const raw = JSON.parse(readFileSync(args.input, "utf8"));
    input = z.object({ profile: StoreProfile, evidence: z.array(EvidenceDocument), seeds: z.array(EntitySeed).default([]) }).parse(raw);
  }

  const run_id = args.live ? undefined : "run_fixture";
  const plan = args.plan ? await planQueries(input.profile, { client, run_id: run_id ?? "run_plan" }, input.seeds.map((s) => s.name)) : undefined;
  const result = await runAnalysis(input.profile, input.evidence, {
    client, logger: args.live ? stderrLogger : undefined, seeds: input.seeds, run_id, maxItems: args.maxItems, now: args.input ? undefined : FIXTURE_NOW,
  });

  const json = JSON.stringify({ ...result, ...(plan ? { plan } : {}) }, null, 2);
  if (args.out) writeFileSync(args.out, json + "\n");
  else console.log(json);

  console.error(`status=${result.status} items=${result.items.length}${result.missing_sections.map((m) => ` missing=${m.section}(${m.reason})`).join("")}`);
  return result.status === "failed" ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await cli(process.argv.slice(2));
