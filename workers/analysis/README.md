# workers/analysis

OpenAI reasoning layer. Input: `StoreProfile` + enriched `EvidenceDocument[]` (+ optional upstream `EntitySeed[]` scores). Output: schema-valid, evidence-cited `report_item[]`. Never browses.

```
npm test                              # vitest
npm run typecheck
npm run analyze -- --fixture          # full pipeline, fake client, no API key
npm run analyze -- --fixture --plan   # also print the research plan
npm run analyze -- --live             # OpenAI; needs OPENAI_API_KEY + OPENAI_MODEL (.env supported)
npm run analyze -- --fixture --input my.json   # {profile, evidence, seeds?}
npm run eval [-- --live] [-- --no-quarantine]  # citation coverage, unknown-ID / duplicate rate, low_evidence, injection check
```

- Contracts: `src/contracts.ts`. Prompts (versioned, plain files): `prompts/`.
- The model never writes `score_components`, `low_evidence` or discourse sample stats (source counts, date ranges); code computes them.
- `validateReport` (`src/validator.ts`) is the authority on citations; workflows retry once with its errors.
- Docs that look like prompt injection are quarantined before selection; everything else is fenced as untrusted data.
