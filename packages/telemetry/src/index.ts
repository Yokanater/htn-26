/**
 * @sei/telemetry: public entry point. Owner: L4 (Product & Platform).
 *
 * Implementations of the core `Telemetry` interface: noop (default), console, and Sentry
 * (`@sentry/node`, enabled when SENTRY_DSN is set). Design §15; slot IS-SENTRY.
 * Allowed workspace imports: @sei/core.
 */
export {};
