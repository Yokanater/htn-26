/** Minimal portable contract fixtures for upstream integration tests. */
export const validEvidenceDocument = {
  id: "ev_contract_1",
  source_url: "https://example.com/review",
  source_type: "review",
  title: "Example review",
  published_at: "2026-01-02T00:00:00.000Z",
  fetched_at: "2026-01-03T00:00:00.000Z",
  exact_span: "The product is easy to use.",
  language: "en",
};

export const invalidEvidenceDocument = { ...validEvidenceDocument, source_url: "not-a-url" };
export const failedEnrichmentDocument = { ...validEvidenceDocument, enrichment_status: "failed" };

export const validEnrichmentResponse = {
  model_version: "market-enrichment-v1",
  items: [{
    evidence_id: "ev_contract_1",
    embedding: [0.012, -0.044],
    relevance: 0.91,
    sentiment: { label: "positive", score: 0.84 },
    topics: [{ label: "ease of use", score: 0.79 }],
    language: "en",
  }],
};

export const failedEnrichmentResponse = {
  model_version: "market-enrichment-v1",
  enrichment_status: "failed",
  items: [],
};

export const validEntityScore = {
  entity_key: "example-partner.com",
  name: "Example Partner",
  kind: "collaboration",
  score_components: { components: { complementary_job: 27 }, total: 72 },
};

export const invalidEntityScore = { ...validEntityScore, kind: "unknown" };
