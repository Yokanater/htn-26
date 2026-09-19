/**
 * @sei/core: reasoning interfaces. Owner: L3 (Reasoning & Pipeline).
 *
 * Interfaces to write in Step 0 (split §3.2), mirroring design exactly:
 * - §3.5: Reasoner (parse<T> with a Zod schema), SectionSynthesizer<T>, Verifier,
 *         ActionProvider (drafts are always human-approved)
 *
 * Interfaces only; implementations live in @sei/reason (and are injected elsewhere, so
 * @sei/enrich prompts run through Reasoner without importing @sei/reason).
 */
export {};
