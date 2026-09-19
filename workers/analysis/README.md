# workers/analysis

OpenAI reasoning layer. Input: `StoreProfile` + enriched or unenriched `EvidenceDocument[]` (+ optional upstream `EntitySeed[]` scores). Output: schema-valid, evidence-cited `report_item[]`. Never browses.

```
npm test                              # vitest
npm run typecheck
npm run analyze -- --fixture          # full pipeline, fake client, no API key
npm run analyze -- --fixture --plan   # also print the research plan
npm run analyze -- --live             # OpenAI; needs OPENAI_API_KEY + OPENAI_MODEL (.env supported)
npm run analyze -- --fixture --input my.json   # {profile, evidence, seeds?}
npm run eval [-- --live] [-- --no-quarantine]  # citation coverage, unknown-ID / duplicate rate, low_evidence, injection check
```

- Shared contracts: `packages/contracts` owns `SCHEMA_VERSION`, Zod schemas, generated JSON Schema artifacts (`JSON_SCHEMAS`), and portable fixtures. `src/contracts.ts` is a compatibility re-export for existing worker imports.
- Upstream handoff: use `adaptEvidenceDocuments()` for Phase C `EvidenceDocument` records, `adaptEnrichmentResponse()` for the Phase D `{ model_version, items }` batch response, and `adaptEntityScores()` for Phase E records shaped as `EntitySeed`. Failed enrichment (`enrichment_status: "failed"`) is valid: the adapter returns evidence with no `enrichment`, so selection/synthesis degrades gracefully.
- The model never writes `score_components`, `low_evidence` or discourse sample stats (source counts, date ranges); code computes them. `validateReport` remains the authority on citations.
- Feature gate: the calling API/orchestrator must require `ANALYSIS_ENABLED=true` before invoking this worker. The worker does not make rollout decisions itself.
- `validateReport` (`src/validator.ts`) is the authority on citations; workflows retry once with its errors.
- Docs that look like prompt injection are quarantined before selection; everything else is fenced as untrusted data.
