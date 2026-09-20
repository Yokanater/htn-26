/**
 * apps/server entry point: `pnpm dev` (tsx watch) / `pnpm start`. Owner: L4.
 * Listens on PORT (default 8787). Tests never import this file; they use createApp() from ./app.
 */
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadRootEnv, serverPort } from './env';

loadRootEnv();

const server = serve(
  {
    fetch: createApp({ ...process.env, STORE: process.env.STORE || 'sqlite' }).fetch,
    port: serverPort(),
  },
  (info) => {
    console.log(`[server] listening on http://localhost:${info.port}`);
  },
);

function shutdown(signal: string): void {
  console.log(`[server] ${signal} received, closing`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
