/** Legacy preset regression; not active feature acceptance. */
import { resolveMilestones } from '@sei/core';
import { describe, expect, it } from 'vitest';

describe('milestone presets', () => {
  it('the archived ladder m1 → m5 resolves with every section', () => {
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
