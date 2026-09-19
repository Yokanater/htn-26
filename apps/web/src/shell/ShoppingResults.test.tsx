import type { IntentBrief } from '@sei/contracts';

import { cleanup, render, screen } from '@testing-library/react';

import { afterEach, expect, it, vi } from 'vitest';
import { ShoppingResults } from './ShoppingResults';

const brief: IntentBrief = {
  id: 'brief_test',
  revision: 2,
  status: 'confirmed',
  domain: 'outfit',
  country: 'CA',
  currency: 'CAD',
  itemBudget: null,
  sampleOrigin: 'seed',
  createdAt: '2026-09-19T00:00:00Z',
  input: { kind: 'text', text: 'A red shirt' },
  slots: [
    {
      id: 'slot_test',
      category: 'top',
      description: 'A red shirt',
      required: true,
      constraints: [{ kind: 'size', value: 'Medium' }],
      visualAttributes: [],
    },
  ],
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('shows actionable empty results from the current streamed run', async () => {
  render(
    <ShoppingResults
      brief={brief}
      runId="run_test"
      onCancel={() => {}}
      onRetry={() => {}}
      events={[
        {
          type: 'result',
          runId: 'run_test',
          briefId: brief.id,
          briefRevision: 2,
          seq: 1,
          result: {
            runId: 'run_test',
            briefId: brief.id,
            briefRevision: 2,
            status: 'partial',
            collection: null,
            alternatives: [],
            offers: [],
            candidates: [],
            missing: [],
            warnings: [],
          },
        },
      ]}
    />,
  );
  expect(await screen.findByText(/No verifiable storefront/)).toBeTruthy();
});
