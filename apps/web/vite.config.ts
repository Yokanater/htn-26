/**
 * apps/web Vite config. Owner: L4 (Product & Platform).
 * Dev server on WEB_PORT (default 5173); `/api` is proxied to the server on PORT (default 8787).
 * Both are read from the real environment first, then the repo-root `.env`.
 */
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, repoRoot, ''), ...process.env };
  const webPort = Number(env.WEB_PORT || 5173);
  const apiPort = Number(env.PORT || 8787);

  return {
    // Only VITE_* vars from the repo-root .env reach the browser (never put secrets there).
    envDir: repoRoot,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: webPort,
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
          configure(proxy) {
            proxy.on('proxyReq', (proxyRequest, request) => {
              if (request.headers.host) {
                proxyRequest.setHeader('x-forwarded-host', request.headers.host);
              }
            });
          },
        },
      },
    },
  };
});
