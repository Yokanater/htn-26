import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { ReportItem } from "../src/contracts.js";
import { FakeLlmClient } from "../src/llm/fake.js";
import { LlmError } from "../src/llm/types.js";
import { runAnalysis } from "../src/pipeline.js";
import { coffeeEvidence, INJECTION_CANARY } from "../src/fixtures/evidence.js";
import { coffeeProfile, FIXTURE_NOW } from "../src/fixtures/profile.js";
import { coffeeSeeds } from "../src/fixtures/seeds.js";
import { fakeCollaboration, fakeCompetitors, fakeConsistencyFindings, fakeSwotActions } from "../src/fixtures/outputs.js";
import { parseArgs } from "../src/cli.js";

const run = (client: FakeLlmClient) => runAnalysis(coffeeProfile, coffeeEvidence, { client, seeds: coffeeSeeds, run_id: "run_t", now: FIXTURE_NOW });
const bad = <T extends { candidates?: { evidence_ids: string[] }[]; competitors?: { evidence_ids: string[] }[] }>(o: T) => {
  const c = structuredClone(o);
  (c.candidates ?? c.competitors)![0]!.evidence_ids = [];
  return c;
};

// The fake is not adaptive: the fixture SWOT cites docs that only exist in scope when every upstream section survived.
// For partial-upstream tests, script a SWOT that cites only the merchant's own page (always in scope).
const swotFromMerchantPageOnly = () => {
  const o = structuredClone(fakeSwotActions);
  for (const it of [...o.swot.strengths, ...o.swot.weaknesses, ...o.swot.opportunities, ...o.swot.threats, ...o.actions]) it.evidence_ids = ["ev_002"];
  return o;
};

describe("runAnalysis", () => {
  it("completes end to end on fixtures and emits schema-valid report items", async () => {
    const r = await run(new FakeLlmClient());
    expect(r).toMatchObject({ status: "completed", missing_sections: [], run_id: "run_t" });
    const kinds = r.items.reduce<Record<string, number>>((a, i) => ((a[i.kind] = (a[i.kind] ?? 0) + 1), a), {});
    expect(kinds).toEqual({ collaboration_candidate: 5, competitor: 6, discourse_theme: 8, swot_item: 16, recommended_action: 3 });
    for (const i of r.items) {
      ReportItem.parse(i);
      expect(i.run_id).toBe("run_t");
      expect(i.evidence_ids.length > 0 || i.insufficient_evidence).toBe(true);
    }
    expect(new Set(r.items.map((i) => i.id)).size).toBe(r.items.length);
    expect(r.items.find((i) => i.kind === "collaboration_candidate")!.score).toBe(85);
    expect(r.bundle.excluded).toContainEqual({ id: "ev_020", reason: "possible prompt injection" });
  });

  it("returns partial naming the missing section when one section fails validation twice", async () => {
    const r = await run(new FakeLlmClient({ scripted: { CollaborationOutput: [bad(fakeCollaboration), bad(fakeCollaboration)], SwotActionsOutput: [swotFromMerchantPageOnly()] } }));
    expect(r.status).toBe("partial");
    expect(r.missing_sections).toHaveLength(1);
    expect(r.missing_sections[0]).toMatchObject({ section: "collaboration", errors: [expect.objectContaining({ code: "EMPTY_EVIDENCE_IDS" })] });
    expect(r.items.some((i) => i.kind === "collaboration_candidate")).toBe(false);
    expect(r.items.some((i) => i.kind === "competitor")).toBe(true);
    expect(r.items.some((i) => i.kind === "swot_item")).toBe(true); // SWOT still runs on what survived
  });

  it("returns partial when a section hits a transport error", async () => {
    const r = await run(new FakeLlmClient({ scripted: { CompetitorDiscourseOutput: [new LlmError("503", 503)], SwotActionsOutput: [swotFromMerchantPageOnly()] } }));
    expect(r.status).toBe("partial");
    expect(r.missing_sections.map((m) => m.section)).toEqual(["competitors_discourse"]);
    expect(r.items.some((i) => i.kind === "discourse_theme")).toBe(false);
  });

  it("returns partial when only SWOT fails", async () => {
    const r = await run(new FakeLlmClient({ scripted: { SwotActionsOutput: [new LlmError("boom"), new LlmError("boom")] } }));
    expect(r.missing_sections.map((m) => m.section)).toEqual(["swot_actions"]);
    expect(r.items.some((i) => i.kind === "collaboration_candidate")).toBe(true);
  });

  it("returns failed with no items when every section fails", async () => {
    const boom = new LlmError("down");
    const r = await run(new FakeLlmClient({ scripted: { CollaborationOutput: [boom], CompetitorDiscourseOutput: [boom], SwotActionsOutput: [boom] } }));
    expect(r).toMatchObject({ status: "failed", items: [] });
    expect(r.missing_sections).toHaveLength(3);
  });

  it("rejects malformed input at the boundary", async () => {
    await expect(runAnalysis(coffeeProfile, [{ id: "" } as never], { client: new FakeLlmClient() })).rejects.toThrow();
  });

  it("never leaks the injection canary into output", async () => {
    expect(JSON.stringify((await run(new FakeLlmClient())).items)).not.toContain(INJECTION_CANARY);
  });
});

describe("cli", () => {
  it("requires --fixture or --live; --fixture coffee --live means live client on the coffee fixtures", () => {
    expect(() => parseArgs([])).toThrow();
    expect(() => parseArgs(["--fixture", "nope"])).toThrow(/Unknown fixture/);
    expect(parseArgs(["--fixture", "coffee", "--live", "--out", "o.json"])).toMatchObject({ live: true, out: "o.json" });
    expect(parseArgs(["--fixture", "--max-items", "20"])).toMatchObject({ live: false, maxItems: 20 });
  });

  it("`npm run analyze -- --fixture` prints report_item[] JSON using the fake client, no API key", () => {
    const stdout = execFileSync("npm", ["run", "--silent", "analyze", "--", "--fixture", "--plan"], {
      encoding: "utf8", env: { ...process.env, OPENAI_API_KEY: "", OPENAI_MODEL: "" }, stdio: ["ignore", "pipe", "ignore"],
    });
    const out = JSON.parse(stdout);
    expect(out.status).toBe("completed");
    expect(out.items).toHaveLength(38);
    expect(out.plan.queries).toHaveLength(10);
  }, 30_000);
});

describe("runAnalysis consistency stage", () => {
  it("runs the check on a clean report and ships it untouched", async () => {
    const client = new FakeLlmClient();
    const r = await run(client);
    expect(r.status).toBe("completed");
    expect(r.consistency).toMatchObject({ issues: [], findings: [], applied_rewrites: [], discarded_findings: [] });
    expect(r.consistency!.summary).toBeTruthy();
    expect(client.calls.some((c) => c.schemaName === "ConsistencyOutput")).toBe(true);
    expect(r.items).toHaveLength(38);
    const clean = await run(new FakeLlmClient());
    expect(clean.items).toEqual(r.items); // deterministic, and the stage changed nothing
  });

  it("runs after the SWOT, so it sees every section", async () => {
    const client = new FakeLlmClient();
    await run(client);
    const order = client.calls.map((c) => c.task);
    expect(order.indexOf("consistency")).toBe(order.length - 1);
    expect(order.indexOf("consistency")).toBeGreaterThan(order.indexOf("swot"));
    const sent = client.calls.at(-1)!.user;
    for (const marker of ["collaboration_candidates", "competitors", "discourse_themes", "swot", "actions"]) expect(sent).toContain(marker);
  });

  it("carries an applied rewrite through into the shipped report items", async () => {
    const r = await run(new FakeLlmClient({ scripted: { ConsistencyOutput: [fakeConsistencyFindings] } }));
    expect(r.status).toBe("completed");
    const item = r.items.find((i) => i.id === "collaboration_candidate/collab_2")!;
    expect(item.payload.claim).toContain("must be resolved before any partnership");
    expect(item.confidence).toBe("low");
    expect(r.consistency!.applied_rewrites).toHaveLength(1);
    expect(r.consistency!.findings).toHaveLength(2);
  });

  it("catches a brand in both lists that per-section validation cannot see", async () => {
    // The competitors workflow screens against the upstream collaboration *seeds*. A partner the scout added on its
    // own is invisible to that check, so only the assembled report shows the clash. Brewbox is a competitor seed.
    const tampered = structuredClone(fakeCollaboration);
    Object.assign(tampered.candidates[4]!, { brand_name: "Brewbox", entity_key: "brewbox.example" });
    const r = await run(new FakeLlmClient({ scripted: { CollaborationOutput: [tampered] } }));
    expect(r.consistency!.issues.map((i) => i.code)).toContain("COMPLEMENT_LISTED_AS_COMPETITOR");
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.status).toBe("completed"); // flagged for the reader, not a lost section
  });

  it("ships partial, never failed, when only the consistency step fails", async () => {
    const r = await run(new FakeLlmClient({ scripted: { ConsistencyOutput: [new LlmError("503", 503)] } }));
    expect(r.status).toBe("partial");
    expect(r.missing_sections).toEqual([expect.objectContaining({ section: "consistency", reason: "503" })]);
    expect(r.consistency).toBeNull();
    expect(r.items).toHaveLength(38); // every section still ships
  });

  it("stays partial when a content section and the consistency step both fail", async () => {
    const r = await run(new FakeLlmClient({
      scripted: {
        CollaborationOutput: [bad(fakeCollaboration), bad(fakeCollaboration)],
        SwotActionsOutput: [swotFromMerchantPageOnly()],
        ConsistencyOutput: [new LlmError("boom")],
      },
    }));
    expect(r.status).toBe("partial");
    expect(r.missing_sections.map((m) => m.section).sort()).toEqual(["collaboration", "consistency"]);
  });

  it("skips the check and reports failed when no section produced anything", async () => {
    const boom = new LlmError("down");
    const client = new FakeLlmClient({ scripted: { CollaborationOutput: [boom], CompetitorDiscourseOutput: [boom], SwotActionsOutput: [boom] } });
    const r = await run(client);
    expect(r).toMatchObject({ status: "failed", items: [], consistency: null });
    expect(r.missing_sections.map((m) => m.section)).not.toContain("consistency");
    expect(client.calls.some((c) => c.schemaName === "ConsistencyOutput")).toBe(false);
  });
});
