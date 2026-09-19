import { describe, expect, it } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";
import {
  CollaborationOutput, CompetitorDiscourseOutput, EntitySeed, EvidenceDocument, ResearchPlan, StoreProfile, SwotActionsOutput,
} from "../src/contracts.js";
import { coffeeProfile } from "../src/fixtures/profile.js";
import { coffeeEvidence, INJECTION_CANARY, INJECTION_DOC_ID, MARKETING_COPY_DOC_ID } from "../src/fixtures/evidence.js";
import { coffeeSeeds } from "../src/fixtures/seeds.js";
import { fakeCollaboration, fakeCompetitors, fakePlan, fakeSwotActions } from "../src/fixtures/outputs.js";

describe("fixtures", () => {
  it("profile, evidence and seeds match the contracts", () => {
    expect(StoreProfile.parse(coffeeProfile)).toBeTruthy();
    for (const d of coffeeEvidence) EvidenceDocument.parse(d);
    for (const s of coffeeSeeds) EntitySeed.parse(s);
  });

  it("has ~30 unique docs across 3+ source types with mixed stances and dates", () => {
    expect(coffeeEvidence.length).toBeGreaterThanOrEqual(30);
    expect(new Set(coffeeEvidence.map((d) => d.id)).size).toBe(coffeeEvidence.length);
    expect(new Set(coffeeEvidence.map((d) => d.source_type)).size).toBeGreaterThanOrEqual(3);
    const labels = new Set(coffeeEvidence.map((d) => d.enrichment?.sentiment.label));
    for (const l of ["positive", "negative", "neutral", "mixed"]) expect(labels.has(l as never)).toBe(true);
    const years = new Set(coffeeEvidence.map((d) => d.published_at?.slice(0, 4)));
    expect(years.size).toBeGreaterThan(1);
  });

  it("contains an injection doc and the merchant's marketing copy", () => {
    const inj = coffeeEvidence.find((d) => d.id === INJECTION_DOC_ID)!;
    expect(inj.exact_span).toMatch(/ignore all previous instructions/i);
    expect(inj.exact_span).toContain(INJECTION_CANARY);
    const mk = coffeeEvidence.find((d) => d.id === MARKETING_COPY_DOC_ID)!;
    expect(mk.source_url).toContain(coffeeProfile.domain);
    expect(mk.exact_span).toMatch(/best coffee in North America/);
  });

  it("fake outputs satisfy the LLM-facing schemas", () => {
    ResearchPlan.parse(fakePlan);
    CollaborationOutput.parse(fakeCollaboration);
    CompetitorDiscourseOutput.parse(fakeCompetitors);
    SwotActionsOutput.parse(fakeSwotActions);
  });
});

describe("contracts", () => {
  it("rejects out-of-range counts", () => {
    expect(CollaborationOutput.safeParse({ candidates: fakeCollaboration.candidates.slice(0, 4) }).success).toBe(false);
    expect(SwotActionsOutput.safeParse({ ...fakeSwotActions, actions: fakeSwotActions.actions.slice(0, 2) }).success).toBe(false);
    const swot = { ...fakeSwotActions.swot, strengths: fakeSwotActions.swot.strengths.slice(0, 2) };
    expect(SwotActionsOutput.safeParse({ ...fakeSwotActions, swot }).success).toBe(false);
  });

  it("every LLM-facing schema converts to a Structured Outputs format", () => {
    for (const [name, schema] of Object.entries({ ResearchPlan, CollaborationOutput, CompetitorDiscourseOutput, SwotActionsOutput })) {
      const fmt = zodTextFormat(schema, name);
      expect(fmt.type).toBe("json_schema");
    }
  });
});
