import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MerchantProfile, MerchantRun } from '@sei/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MerchantWorkspace } from './MerchantWorkspace';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const mount = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MerchantWorkspace back={() => {}} />
    </QueryClientProvider>,
  );

describe.each(['outfit', 'setup'])('%s merchant workspace', (domain) => {
  it.each(['demand', 'supply'] as const)(
    'requires confirmation and shows useful %s results',
    async (mode) => {
      const read = (file: string) =>
        JSON.parse(
          readFileSync(
            resolve(
              dirname(fileURLToPath(import.meta.url)),
              '../../../../../fixtures/seed',
              domain,
              `${file}.json`,
            ),
            'utf8',
          ),
        );
      const offers = read('offers');
      const opportunity = read('opportunity');
      const profile: MerchantProfile = {
        id: 'prof_test',
        merchant: offers[0].merchant,
        domain: domain as 'outfit' | 'setup',
        sampleOrigin: 'seed',
        offers: [offers[0]],
        confirmed: false,
        capturedAt: '2026-09-19T12:00:00Z',
        warnings: [],
      };
      const run: MerchantRun = {
        id: 'run_test',
        status: 'ready',
        sampleOrigin: 'seed',
        events: [
          {
            sequence: 0,
            at: profile.capturedAt,
            stage: 'ready',
            message: 'Synthetic catalog ready.',
            productCount: 1,
          },
        ],
        liveViewUrl: null,
        profile,
      };
      const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.endsWith('/settings'))
          return Response.json({
            provider: 'synthetic',
            stores: [`${domain}-brand-1.example`],
            retention: 'One hour.',
          });
        if (path.endsWith('/profiles')) return Response.json([]);
        if (path === '/api/drafts') return Response.json([]);
        if (path.endsWith('/profile') || path.includes('/runs/')) return Response.json(run);
        if (path.endsWith('/confirm')) return Response.json({ ...profile, confirmed: true });
        if (path.endsWith('/opportunities'))
          return Response.json({
            opportunities: mode === 'demand' ? [opportunity] : [],
            candidates: [
              {
                profile: {
                  ...profile,
                  id: 'prof_partner',
                  merchant: offers[1].merchant,
                  offers: [offers[1]],
                  discoveredFor: profile.id,
                },
                complementaryCategories: [offers[1].category],
                stale: false,
              },
            ],
            offers,
            message: 'Compare the evidence.',
          });
        if (path.endsWith('/drafts') && init?.method === 'POST')
          return Response.json({
            id: 'act_test',
            revision: 1,
            opportunity,
            title: 'Proposed collaboration',
            hypothesis: 'Synthetic evidence summary',
            experiment: 'Run a small interest test',
            outreach: 'Would you discuss a test?',
            merchantNotes: '',
            generatedBy: 'template',
            warnings: [],
            updatedAt: profile.capturedAt,
          });
        return new Response('', { status: 404 });
      });
      vi.stubGlobal('fetch', fetch);
      mount();
      if (domain === 'setup')
        fireEvent.change(screen.getByLabelText('Collection domain'), {
          target: { value: 'setup' },
        });
      await screen.findByRole('option', { name: `${domain}-brand-1.example` });
      fireEvent.change(screen.getByLabelText('Public Shopify store'), {
        target: { value: `${domain}-brand-1.example` },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Profile store' }));
      expect(await screen.findByText('Synthetic catalog ready.')).toBeTruthy();
      expect(
        (screen.getByRole('button', { name: 'Compare demand & partners' }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Confirm reviewed catalog' }));
      await screen.findByRole('button', { name: 'Catalog confirmed' });
      fireEvent.click(screen.getByRole('button', { name: 'Compare demand & partners' }));
      await screen.findByRole('region', { name: 'Automatically discovered merchants' });
      expect(screen.getByText(/not evidence of customer demand/)).toBeTruthy();
      if (mode === 'supply') {
        expect(screen.queryByText('Eligible consented sessions')).toBeNull();
        expect(screen.queryByRole('button', { name: /Create collaboration draft/ })).toBeNull();
        expect(screen.getByRole('button', { name: 'Explore again' })).toBeTruthy();
        return;
      }
      await screen.findByText('OBSERVED PAIR');
      expect(screen.getByText('Both catalogs, with proof')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Create collaboration draft/ }));
      expect(await screen.findByLabelText('Outreach draft')).toBeTruthy();
      fireEvent.change(screen.getByLabelText('Outreach draft'), { target: { value: 'My edit' } });
      expect(
        (screen.getByRole('button', { name: 'Copy proposal' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(screen.getByText(/Save your edits/)).toBeTruthy();
    },
  );
});

it('shows real provider stages and preserves a completed catalog on cancellation', async () => {
  const captured: MerchantProfile = JSON.parse(
    readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../../fixtures/seed/outfit/merchant-profile.json',
      ),
      'utf8',
    ),
  );
  captured.confirmed = false;
  captured.sampleOrigin = 'live';
  const run: MerchantRun = {
    id: 'run_live',
    status: 'running',
    sampleOrigin: 'live',
    profile: null,
    liveViewUrl: 'https://www.browserbase.com/live/session?readOnly=true',
    events: [
      {
        sequence: 0,
        at: '2026-09-19T12:00:00Z',
        stage: 'browser',
        message: 'Browserbase is finding product pages.',
        productCount: 0,
      },
    ],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input, init) => {
      if (String(input).endsWith('/settings'))
        return Response.json({ provider: 'browserbase_baseten', stores: [], retention: '' });
      if (String(input).endsWith('/profiles') || String(input) === '/api/drafts')
        return Response.json([]);
      return Response.json(
        init?.method === 'DELETE'
          ? { ...run, status: 'cancelled', liveViewUrl: null, profile: captured }
          : run,
      );
    }),
  );
  mount();
  fireEvent.change(await screen.findByLabelText('Public Shopify store'), {
    target: { value: 'store.example' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Profile store' }));
  expect(await screen.findByText('Browserbase is finding product pages.')).toBeTruthy();
  expect(screen.getByTitle('Browserbase public catalog live view')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel scan' }));
  expect(await screen.findByText('Catalog scan · cancelled')).toBeTruthy();
  expect(screen.queryByTitle('Browserbase public catalog live view')).toBeNull();
  expect(await screen.findByRole('heading', { name: captured.merchant.name })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Confirm reviewed catalog' })).toBeTruthy();
});
