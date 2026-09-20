import { MerchantResearchSchema, type MerchantWorkspaceProfile } from '@sei/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import fixture from '../../../../../fixtures/seed/outfit/merchant-research.json';
import { BrandResearch } from './BrandResearch';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
  expect(fetch).toHaveBeenCalledOnce();
});
