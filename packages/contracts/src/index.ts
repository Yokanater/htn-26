/**
 * @sei/contracts: the only shared vocabulary between lanes (design v3 §4).
 * Zod schemas + inferred types. Browser-safe: imported by apps/web too.
 * Each file below has one owning lane; see its header comment and AGENTS.md.
 */
export * from './api';
export * from './collect';
export * from './common';
export * from './demand';
export * from './enrich';
export * from './intent';
export * from './opportunity';
export * from './plan';
export * from './profile';
export * from './report';
export * from './run';
export * from './shopping';
