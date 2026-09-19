import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../src/App';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

it('presents shopper and merchant paths without claiming unfinished merchant actions work', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ owner: true })),
  );
  renderApp();
  expect(screen.getByRole('heading', { name: /Find what belongs together/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /I’m building a look or space/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /I run a Shopify store/ }));
  expect(screen.getByRole('heading', { name: /See the demand between categories/ })).toBeTruthy();
  expect(screen.getByText(/Merchant profiling unlocks with S4/)).toBeTruthy();
  expect(screen.getByText('SYNTHETIC PREVIEW')).toBeTruthy();
  expect(await screen.findByText('Private session')).toBeTruthy();
});

it('creates a private text brief and stops at the confirmation barrier', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === '/api/session') return Response.json({ owner: true });
    if (path === '/api/briefs' && init?.method === 'POST') {
      return Response.json(
        {
          id: 'brief_web_1',
          domain: 'setup',
          revision: 1,
          status: 'draft',
          input: { kind: 'text', text: 'A compact reading corner with warm wood and soft light' },
          slots: [
            {
              id: 'slot_web_1',
              category: 'chair',
              description: 'A comfortable reading chair',
              required: true,
              visualAttributes: [],
              constraints: [],
            },
            {
              id: 'slot_web_2',
              category: 'lighting',
              description: 'Warm task lighting',
              required: true,
              visualAttributes: [],
              constraints: [],
            },
          ],
          country: 'CA',
          currency: 'CAD',
          itemBudget: null,
          sampleOrigin: 'seed',
          createdAt: '2026-09-19T12:00:00.000Z',
        },
        { status: 201 },
      );
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  renderApp();
  fireEvent.click(screen.getByRole('button', { name: /Start a collection/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Room or desk' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Your collection idea' }), {
    target: { value: 'A compact reading corner with warm wood and soft light' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Build my draft brief/ }));
  expect(
    await screen.findByRole('heading', { name: /Here’s the collection we heard/ }),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: /Confirm brief/ })).toBeTruthy();
  expect(screen.queryByText(/search results/i)).toBeNull();
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/briefs',
      expect.objectContaining({ method: 'POST' }),
    ),
  );
});

it('renders the shared contract version', () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ owner: true })),
  );
  renderApp();
  expect(screen.getByText(/Contracts v1\.1\.0/)).toBeTruthy();
});
