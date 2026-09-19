/**
 * @sei/contracts: store profile contract. Owner: L3 (Reasoning & Pipeline).
 *
 * Transcribe into Zod schemas + inferred types in Step 0 (split §3.2), mirroring design exactly:
 * - §4.1: StoreProfile (imports ShopifySignals / ProductSummary from ./collect, Money from ./common)
 *
 * Convention: export `FooSchema` (Zod) and `type Foo = z.infer<typeof FooSchema>`.
 * Additive-only after M0 (split §11.3).
 */
export {};
