/**
 * Milestone preset sanity (card M1-L4-0). Runs with `pnpm milestone:check` (no filter).
 * Per-milestone checks live next to it as `<m>.test.ts` (M1-L4-6 writes m1.test.ts, etc.) and
 * run with `pnpm milestone:check <m>`. This file also proves the evals package resolves @sei/*.
 */
import { resolveMilestones } from '@sei/core';
import { describe, expect, it } from 'vitest';

describe('milestone presets', () => {
  it('the recommended ladder m1 → m5 resolves with every section', () => {
    expect(resolveMilestones('m1,m2,m3,m4,m5').sections).toEqual([
      'collaborators',
      'competitors',
      'discourse',
      'swot',
      'actions',
      'ecosystem_map',
      'partner_view',
    ]);
  });
});
