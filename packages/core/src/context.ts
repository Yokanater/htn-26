/**
 * @sei/core: run context. Owner: L3 (Reasoning & Pipeline).
 *
 * Interfaces to write in Step 0 (split §3.2), mirroring design exactly:
 * - §3.5: RunContext { runId, signal, budget, emit, cache, telemetry, log, flags }
 * - §4.7: BudgetTracker, FeatureFlags (Record<string, boolean>; build it with featureFlags() from
 *         ./milestones), RequestCache, Logger, plus a BudgetExceeded error class.
 * - RunBudget is a data shape embedded in ReportRun, so its schema lives in
 *   @sei/contracts (run.ts); import it from there.
 *
 * Interfaces only (plus tiny helpers); implementations live in the owning lane's package.
 */
export {};
