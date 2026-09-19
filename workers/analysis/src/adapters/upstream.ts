import { z } from "zod";
import {
  EntitySeed,
  EvidenceDocument,
  type EntitySeed as EntitySeedType,
  type EvidenceDocument as EvidenceDocumentType,
} from "../contracts.js";

/** Phase C records from the research worker. Extra collection metadata is ignored. */
export const ResearchEvidenceRecord = EvidenceDocument.omit({ enrichment: true }).extend({
  // Persisted when Phase D exhausts its retries; it intentionally does not
  // become model-facing enrichment.
  enrichment_status: z.enum(["completed", "failed"]).optional(),
});

/** Phase D response from the versioned Baseten enrichment endpoint (§5). */
export const EnrichmentResponse = z.object({
  model_version: z.string().optional(),
  enrichment_status: z.enum(["completed", "failed"]).optional(),
  items: z.array(z.object({
    evidence_id: z.string().min(1),
    embedding: z.array(z.number()), // retained by enrichment storage; not passed to OpenAI
    relevance: z.number().min(0).max(1),
    sentiment: z.object({ label: z.enum(["positive", "negative", "neutral", "mixed"]), score: z.number().min(0).max(1) }),
    topics: z.array(z.object({ label: z.string(), score: z.number().min(0).max(1) })),
    language: z.string(),
  })).default([]),
});

/** Phase E score record. Scores remain code-owned, never model-owned. */
export const EntityScoreRecord = EntitySeed;

export function adaptEvidenceDocuments(records: unknown[]): EvidenceDocumentType[] {
  return records.map((record) => ResearchEvidenceRecord.parse(record));
}

/**
 * Joins successful enrichment by evidence ID. A failed batch or an omitted item
 * deliberately leaves `enrichment` absent, allowing degraded but usable synthesis.
 */
export function adaptEnrichmentResponse(
  documents: unknown[],
  response: unknown,
): EvidenceDocumentType[] {
  const evidence = adaptEvidenceDocuments(documents);
  const parsed = EnrichmentResponse.parse(response);
  if (parsed.enrichment_status === "failed") return evidence;

  const results = new Map(parsed.items.map((item) => [item.evidence_id, item]));
  return evidence.map((document) => {
    const item = results.get(document.id);
    if (!item) return document;
    return EvidenceDocument.parse({
      ...document,
      language: item.language || document.language,
      enrichment: {
        relevance: item.relevance,
        sentiment: item.sentiment,
        topics: item.topics,
        model_version: parsed.model_version,
      },
    });
  });
}

export function adaptEntityScores(records: unknown[]): EntitySeedType[] {
  return records.map((record) => EntityScoreRecord.parse(record));
}
