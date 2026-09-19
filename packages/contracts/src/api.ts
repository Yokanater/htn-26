/**
 * @sei/contracts: HTTP API DTOs. Owner: L4 (Product & Platform).
 *
 * Transcribe into Zod schemas + inferred types in Step 0 (split §3.2):
 * - Request/response DTOs for the design §11 routes (profiles, runs, events, cancel, evidence,
 *   feedback, actions, ask, demo runs).
 * - ErrorEnvelope `{ error: { code, message, details? } }` with codes `invalid_url`, `unsafe_url`,
 *   `not_found`, `conflict`, `budget_exceeded`, `provider_unavailable` (design §11).
 * - Later milestones add DTOs additively (e.g. M5 ConnectedStoreDTO, never containing tokens).
 *
 * Convention: export `FooSchema` (Zod) and `type Foo = z.infer<typeof FooSchema>`.
 * Additive-only after M0 (split §11.3).
 */
export {};
