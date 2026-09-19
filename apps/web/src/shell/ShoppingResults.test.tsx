import type { IntentBrief } from '@sei/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
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
it('starts once in StrictMode and shows actionable empty results', async () => {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return Response.json({ runId: 'run_test' });
    if (init?.method === 'DELETE') return Response.json({ cancelled: true });
    return Response.json({
      events: [
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
      ],
    });
  });
  vi.stubGlobal('fetch', fetcher);
  render(
    <StrictMode>
      <QueryClientProvider client={new QueryClient()}>
        <ShoppingResults brief={brief} onEdit={() => {}} />
      </QueryClientProvider>
    </StrictMode>,
  );
  expect(await screen.findByText(/No verifiable storefront/)).toBeTruthy();
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
