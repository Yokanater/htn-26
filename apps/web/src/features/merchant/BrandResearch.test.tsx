import { MerchantResearchSchema, type MerchantWorkspaceProfile } from '@sei/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import fixture from '../../../../../fixtures/seed/outfit/merchant-research.json';
import { BrandResearch } from './BrandResearch';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('shows server progress and elapsed time while polling a background search', async () => {
  const report = MerchantResearchSchema.parse(fixture);
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return Response.json({ jobId: 'test-job' }, { status: 202 });
    if (init?.method === 'DELETE') return Response.json({ cancelled: true });
    return Response.json({
      status: 'running',
      progress: { stage: 'Searching stores and checking products', completed: 2, total: 6 },
    });
  });
  vi.stubGlobal('fetch', fetch);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BrandResearch
        profile={{
          merchant: report.comparisonProducts[0]!.merchant,
          sampleOrigin: 'seed',
          categories: ['top'],
          evidenceIds: [],
          workspace: 'synthetic_demo',
        }}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Find products and brands' }));
  expect(await screen.findByRole('progressbar')).toBeTruthy();
  await waitFor(() => expect(screen.getByText(/2 of 6 category searches finished/)).toBeTruthy(), {
    timeout: 3500,
  });
  expect(screen.getByRole('progressbar').getAttribute('value')).toBe('2');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel search' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Search cancelled.');
  expect(
    fetch.mock.calls.some(
      ([url, init]) => url.endsWith('/jobs/test-job') && init?.method === 'DELETE',
    ),
  ).toBe(true);
});
it('requests research and switches between bundle, brand and competitor comparisons', async () => {
  const report = MerchantResearchSchema.parse(fixture);
  report.competitors = [{ ...report.partners[0]!, reason: 'Sells similar products.' }];
  const fetch = vi.fn(async () => Response.json(report));
  vi.stubGlobal('fetch', fetch);
  const profile: MerchantWorkspaceProfile = {
    merchant: report.comparisonProducts[0]!.merchant,
    sampleOrigin: 'seed',
    categories: ['top'],
    evidenceIds: [],
    workspace: 'synthetic_demo',
  };
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <BrandResearch profile={profile} />
    </QueryClientProvider>,
  );
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Find products and brands' }));
  expect(await screen.findByRole('tab', { name: /Bundle products/ })).toBeTruthy();
  expect(
    screen
      .getByRole('link', { name: report.bundles[0]!.complementaryProduct.title })
      .getAttribute('href'),
  ).toBe(report.bundles[0]!.complementaryProduct.productUrl);
  fireEvent.click(screen.getByRole('tab', { name: /Complementary brands/ }));
  expect(screen.getByText(/Partnership interest has not been checked/)).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: /Competitors/ }));
  expect(screen.getByRole('region', { name: 'Brand comparison' })).toBeTruthy();
  expect(screen.getByText('Your store')).toBeTruthy();
  expect(screen.getByText('Products found')).toBeTruthy();
  expect(screen.getByText(report.competitors[0]!.reason)).toBeTruthy();
  expect(fetch).toHaveBeenCalledOnce();
});

it('keeps the last useful report visible when a refresh provider call fails', async () => {
  const report = MerchantResearchSchema.parse(fixture);
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(report))
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: 'MERCHANT_RESEARCH_UNAVAILABLE',
            message: 'The catalog provider could not complete this search. Try again.',
          },
        },
        { status: 503 },
      ),
    );
  vi.stubGlobal('fetch', fetch);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <BrandResearch
        profile={{
          merchant: report.comparisonProducts[0]!.merchant,
          sampleOrigin: 'live',
          categories: ['top'],
          evidenceIds: [],
          workspace: 'synthetic_demo',
        }}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Find products and brands' }));
  expect(await screen.findByRole('tab', { name: /Bundle products/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Search again' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/catalog provider/i);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('tab', { name: /Bundle products/ })).toBeTruthy();
});
