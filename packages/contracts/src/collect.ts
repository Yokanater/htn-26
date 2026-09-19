/**
 * @sei/contracts: collection contracts. Owner: L1 (Collection).
 *
 * Transcribe into Zod schemas + inferred types in Step 0 (split §3.2), mirroring design exactly:
 * - §4.1: ShopifySignal, ShopifySignals, ProductSummary, RawStoreSignals
 * - §4.2: CatalogProduct, SearchHit, Candidate, DiscoveryResult
 * - §4.3: Capture, Source, EvidenceKind, Evidence, CollectionBatch
 *
 * Convention: export `FooSchema` (Zod) and `type Foo = z.infer<typeof FooSchema>`.
 * Money and SourceType come from ./common. Additive-only after M0 (split §11.3).
 */
export {};
