/**
 * Root Vitest config: `pnpm test` runs every workspace's tests in one command.
 * - "node":       packages/*, apps/server, evals (except evals/milestones), Node environment
 * - "milestones": evals/milestones/<m>.test.ts, also run alone by `pnpm milestone:check <m>`
 * - "web":        apps/web/vitest.config.ts (jsdom + React)
 * Filters work from the root: `pnpm vitest run packages/collect/test/policy.test.ts`.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['{packages,apps}/*/{src,test}/**/*.test.ts', 'evals/**/*.test.ts'],
          exclude: ['**/node_modules/**', 'apps/web/**', 'evals/milestones/**'],
        },
      },
      {
        test: {
          name: 'milestones',
          environment: 'node',
          include: ['evals/milestones/**/*.test.ts'],
        },
      },
      'apps/web/vitest.config.ts',
    ],
  },
});
