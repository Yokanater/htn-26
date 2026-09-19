/**
 * @sei/contracts: report contracts. Owner: L3 (Reasoning & Pipeline).
 *
 * Transcribe into Zod schemas + inferred types in Step 0 (split §3.2), mirroring design exactly:
 * - §4.5: Claim, CollaborationCandidate, CompetitorProfile, DiscourseTheme, SwotItem, SwotReport,
 *         RecommendedAction, SectionKey (open string union), ReportSection, EvidencePreview,
 *         Report, RunStats
 * - §4.7: VerificationResult, SynthesisInput, ActionKind, ActionRequest, ActionDraft, Approval,
 *         ActionResult
 *
 * Convention: export `FooSchema` (Zod) and `type Foo = z.infer<typeof FooSchema>`.
 * These are DOMAIN schemas; LLM output schemas (`.nullable()`, never `.optional()`) live in
 * packages/reason and packages/enrich/prompts. Additive-only after M0 (split §11.3).
 */
export {};
