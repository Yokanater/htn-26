/**
 * @sei/core: storage interfaces. Owner: L2 (Intelligence).
 *
 * Interfaces to write in Step 0 (split §3.2), mirroring design exactly:
 * - §3.5: RunStore (incl. subscribe → unsubscribe), EvidenceStore, VectorIndex
 * - §10.2: BlobStore (optional, for artifacts)
 *
 * Interfaces only; FileRunStore lives in @sei/pipeline (L3), Pg stores in @sei/db (L2),
 * MemoryRunStore in apps/server (L4).
 */
export {};
