/**
 * @sei/contracts: runs and pipeline events. Owner: L4 (Product & Platform).
 *
 * Transcribe into Zod schemas + inferred types in Step 0 (split §3.2), mirroring design exactly:
 * - §4.6: StageKey, RunStatus, ReportRun, PipelineEvent (discriminated union on `type`),
 *         PipelineEventInput
 * - §4.7: RunBudget. Note: split §3.2 lists RunBudget under core/context.ts, but ReportRun
 *         (a contract) embeds it and @sei/contracts cannot import @sei/core, so the data shape
 *         lives here and core re-exports / uses it.
 *
 * Convention: export `FooSchema` (Zod) and `type Foo = z.infer<typeof FooSchema>`.
 * Additive-only after M0 (split §11.3).
 */
export {};
