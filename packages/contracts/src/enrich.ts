/**
 * @sei/contracts: enrichment contracts. Owner: L2 (Intelligence).
 *
 * Transcribe into Zod schemas + inferred types in Step 0 (split §3.2), mirroring design exactly:
 * - §4.4: DiscourseType, Enrichment, Entity, DiscourseCluster, ScoreComponent, CandidateScore
 * - §4.7: ResolveResult, TagInput, TagOutput
 *
 * Convention: export `FooSchema` (Zod) and `type Foo = z.infer<typeof FooSchema>`.
 * Additive-only after M0 (split §11.3).
 */
export {};
