import { describe, expect, it } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";
import {
  CollaborationOutput, CompetitorDiscourseOutput, EntitySeed, EvidenceDocument, ResearchPlan, StoreProfile, SwotActionsOutput,
} from "../src/contracts.js";
import { coffeeProfile } from "../src/fixtures/profile.js";
import { coffeeEvidence, INJECTION_CANARY, INJECTION_DOC_ID, MARKETING_COPY_DOC_ID } from "../src/fixtures/evidence.js";
import { coffeeSeeds } from "../src/fixtures/seeds.js";
import { fakeCollaboration, fakeCompetitors, fakePlan, fakeSwotActions } from "../src/fixtures/outputs.js";
import {
  adaptEnrichmentResponse, adaptEntityScores, adaptEvidenceDocuments,
} from "../src/adapters/upstream.js";
import {
  failedEnrichmentDocument, failedEnrichmentResponse, invalidEntityScore, invalidEvidenceDocument, validEnrichmentResponse, validEntityScore, validEvidenceDocument,
} from "../../../packages/contracts/fixtures/index.js";
import { isCompatibleSchemaVersion, JSON_SCHEMAS, SCHEMA_VERSION } from "../../../packages/contracts/src/index.js";

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
  it("uses a compatible semver schema version and exports JSON Schemas", () => {
    expect(SCHEMA_VERSION).toMatch(/^1\.\d+\.\d+$/);
    expect(isCompatibleSchemaVersion("1.99.0")).toBe(true);
    expect(isCompatibleSchemaVersion("2.0.0")).toBe(false);
    expect(JSON_SCHEMAS.evidence_document.$schema).toBeDefined();
    expect(JSON_SCHEMAS.report_item.definitions).toBeDefined();
  });

  it("adapts valid Phase C evidence and rejects malformed evidence", () => {
    expect(adaptEvidenceDocuments([validEvidenceDocument])[0]?.id).toBe("ev_contract_1");
    expect(() => adaptEvidenceDocuments([invalidEvidenceDocument])).toThrow();
  });

  it("adapts successful enrichment and degrades safely on a failed batch", () => {
    const enriched = adaptEnrichmentResponse([validEvidenceDocument], validEnrichmentResponse);
    expect(enriched[0]?.enrichment?.relevance).toBe(0.91);
    const degraded = adaptEnrichmentResponse([validEvidenceDocument], failedEnrichmentResponse);
    expect(degraded[0]?.enrichment).toBeUndefined();
    expect(adaptEvidenceDocuments([failedEnrichmentDocument])[0]?.enrichment).toBeUndefined();
    expect(() => adaptEnrichmentResponse([validEvidenceDocument], { items: [{ evidence_id: "ev_contract_1", relevance: 2 }] })).toThrow();
  });

  it("adapts real entity scores and rejects malformed score records", () => {
    expect(adaptEntityScores([validEntityScore])[0]?.score_components.total).toBe(72);
    expect(() => adaptEntityScores([{ ...validEntityScore, score_components: { components: {}, total: 101 } }])).toThrow();
    expect(() => adaptEntityScores([invalidEntityScore])).toThrow();
  });

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
