/**
 * @sei/reason: public entry point. Owner: L3 (Reasoning & Pipeline).
 *
 * OpenAIReasoner + FixtureReasoner, prompt registry, profile normalizer, planner, section
 * synthesizers + registry, citation validator, assemble, actions, `createReasonStages(env)`, CLIs.
 * Design §3.4, §5.1, §5.3, §5.9–§5.12, §6.3, §9. Allowed workspace imports: @sei/contracts,
 * @sei/core. Never import @sei/enrich or @sei/collect: cross-lane calls (e.g. selectBundle) are
 * injected through interfaces by the pipeline / composition root.
 */
export {};
