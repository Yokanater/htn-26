import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
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

it('shows the server as ok when /api/healthz answers', async () => {
  const fetchMock = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetchMock);
  renderApp();
  expect(await screen.findByText('server: ok')).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledWith('/api/healthz');
});

it('shows the server as unreachable when the request fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('down', { status: 502 })),
  );
  renderApp();
  expect(await screen.findByText('server: unreachable')).toBeTruthy();
});

it('renders the contracts schema version (workspace TS source resolves)', () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ ok: true })),
  );
  renderApp();
  expect(screen.getByText(/contracts v1\.1\.0/)).toBeTruthy();
});

it('describes both surfaces without presenting unfinished features as available', () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ ok: true })),
  );
  renderApp();
  expect(screen.getByRole('heading', { name: 'Shopify Intent Studio' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'For shoppers' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'For merchants' })).toBeTruthy();
  expect(screen.getByText(/Outfits and room or desk setups/)).toBeTruthy();
  expect(screen.getByText(/not yet available/)).toBeTruthy();
});
