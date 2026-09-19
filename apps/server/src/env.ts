/**
 * apps/server: environment helpers. Owner: L4 (Product & Platform).
 */
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/** Loads the repo-root `.env` (never committed; see .env.example). Real env vars win. */
export function loadRootEnv(): void {
  dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
}

export const DEFAULT_PORT = 8787;

/** PORT (default 8787). `0` asks the OS for a free port. */
export function serverPort(env: Record<string, string | undefined> = process.env): number {
  const raw = env.PORT?.trim();
  if (!raw) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT="${raw}": expected an integer 0-65535`);
  }
  return port;
}
