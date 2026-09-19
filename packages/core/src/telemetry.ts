/**
 * @sei/core: telemetry interface. Owner: L4 (Product & Platform).
 *
 * Interface to write in Step 0 (split §3.2), mirroring design exactly:
 * - §3.5: Telemetry { span<T>(name, attrs, fn): Promise<T> }
 *
 * Interface only; noop / console / Sentry implementations live in @sei/telemetry (design §15).
 */
export {};
