import type {
  MerchantCollaborationDraft,
  MerchantOpportunity,
  MerchantWorkspaceProfile,
} from '@sei/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import outfitOpportunity from '../../../../../fixtures/seed/outfit/opportunity.json';
import setupOpportunity from '../../../../../fixtures/seed/setup/opportunity.json';
import { App } from '../../App';
import { MerchantWorkspace } from './MerchantWorkspace';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWithClient(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function profileFor(domain: 'outfit' | 'setup'): MerchantWorkspaceProfile {
  const opportunity = domain === 'outfit' ? outfitOpportunity : setupOpportunity;
  return {
    merchant: opportunity.merchants[0]!,
    sampleOrigin: 'seed',
    categories: [...opportunity.demand.cohort.categories],
    evidenceIds: [...opportunity.productEvidenceIds],
    workspace: 'synthetic_demo',
  };
}

function inferredOpportunity(domain: 'outfit' | 'setup'): MerchantOpportunity {
  const seed = domain === 'outfit' ? outfitOpportunity : setupOpportunity;
  return {
    ...seed,
    id: `opp_inferred_${domain}_1`,
    basis: 'inferred_supply_fit',
    observedPairSupport: null,
    merchants: [
      { id: 'mer_newcomer_1', name: 'Newcomer demo', domain: `newcomer-${domain}.example` },
      seed.merchants[1]!,
    ],
    uncertainties: [
      'Inferred supply fit only; shoppers have not selected this pairing',
      ...seed.uncertainties,
    ],
  } as MerchantOpportunity;
}

function draftFor(
  opportunity: MerchantOpportunity,
  merchantId: string,
): MerchantCollaborationDraft {
  return {
    id: 'draft_web_1',
    version: 1,
    merchantId,
    opportunityId: opportunity.id,
    aggregateId: opportunity.demand.aggregateId,
    aggregateVersion: opportunity.demand.aggregateVersion,
    sampleOrigin: 'seed',
    proposalText: opportunity.proposedExperiment,
    uncertainties: [...opportunity.uncertainties],
    evidenceIds: [...opportunity.productEvidenceIds],
    createdAt: '2026-09-19T12:00:00.000Z',
    updatedAt: '2026-09-19T12:00:00.000Z',
  };
}

describe('MerchantWorkspace', () => {
  it.each(['outfit', 'setup'] as const)(
    'profiles a synthetic %s store, shows banded counts, and PATCHes a draft',
    async (domain) => {
      const opportunity = (
        domain === 'outfit' ? outfitOpportunity : setupOpportunity
      ) as MerchantOpportunity;
      const profile = profileFor(domain);
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path === '/api/merchants/profile' && init?.method === 'POST') {
          return Response.json(profile, { status: 201 });
        }
        if (path === `/api/merchants/${profile.merchant.id}/opportunities`) {
          return Response.json({ opportunities: [opportunity] });
        }
        if (path.endsWith('/drafts') && init?.method === 'POST') {
          return Response.json(draftFor(opportunity, profile.merchant.id), { status: 201 });
        }
        if (path === '/api/drafts/draft_web_1' && init?.method === 'PATCH') {
          return Response.json({
            ...draftFor(opportunity, profile.merchant.id),
            version: 2,
            proposalText: 'Edited synthetic proposal',
            uncertainties: ['Costs remain unknown'],
            updatedAt: '2026-09-19T12:05:00.000Z',
          });
        }
        return new Response('not found', { status: 404 });
      });
      vi.stubGlobal('fetch', fetchMock);
      renderWithClient(<MerchantWorkspace back={() => undefined} />);

      expect(
        screen.getByRole('heading', { name: /See the demand between categories/ }),
      ).toBeTruthy();
      expect(screen.getByText(/Synthetic\/demo merchant workspace/i)).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();

      fireEvent.change(screen.getByRole('textbox', { name: 'Public HTTPS store URL' }), {
        target: { value: `https://${profile.merchant.domain}/` },
      });
      fireEvent.click(screen.getByRole('button', { name: /Profile demo store/ }));

      expect(await screen.findByText(profile.merchant.name)).toBeTruthy();
      expect(screen.getAllByText('5–9').length).toBeGreaterThan(0);
      expect(screen.getByText(/Observed pair · synthetic/i)).toBeTruthy();
      expect(screen.queryByText('verified owner')).toBeNull();
      expect(screen.queryByText(/connected store/i)).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: /Create collaboration draft/ }));
      expect(await screen.findByDisplayValue(opportunity.proposedExperiment)).toBeTruthy();
      fireEvent.change(screen.getByDisplayValue(opportunity.proposedExperiment), {
        target: { value: 'Edited synthetic proposal' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/drafts/draft_web_1',
          expect.objectContaining({ method: 'PATCH' }),
        ),
      );
    },
  );

  it('labels inferred supply fit without observed pair support', async () => {
    const opportunity = inferredOpportunity('outfit');
    const profile: MerchantWorkspaceProfile = {
      merchant: opportunity.merchants[0]!,
      sampleOrigin: 'seed',
      categories: ['top'],
      evidenceIds: opportunity.productEvidenceIds,
      workspace: 'synthetic_demo',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path === '/api/merchants/profile') return Response.json(profile, { status: 201 });
        if (path.includes('/opportunities')) return Response.json({ opportunities: [opportunity] });
        return new Response('not found', { status: 404 });
      }),
    );
    renderWithClient(<MerchantWorkspace back={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Profile demo store/ }));
    expect(await screen.findByText(/Inferred supply fit · synthetic/i)).toBeTruthy();
    expect(screen.getByText('Not observed for this pairing')).toBeTruthy();
  });

  it('labels a live public catalog separately from synthetic demand', async () => {
    const opportunity = inferredOpportunity('setup');
    const profile: MerchantWorkspaceProfile = {
      merchant: opportunity.merchants[0]!,
      sampleOrigin: 'live',
      categories: ['desk'],
      evidenceIds: opportunity.productEvidenceIds,
      workspace: 'synthetic_demo',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path === '/api/merchants/profile') return Response.json(profile, { status: 201 });
        if (path.includes('/opportunities')) return Response.json({ opportunities: [opportunity] });
        return new Response('not found', { status: 404 });
      }),
    );
    renderWithClient(<MerchantWorkspace back={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Profile demo store/ }));
    expect(await screen.findByText(/Live public catalog profile/i)).toBeTruthy();
    expect(screen.getAllByText(/Synthetic demand opportunity/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/verified owner/i)).toBeNull();
  });

  it('clears the previous store when a later profile attempt fails', async () => {
    const outfit = profileFor('outfit');
    const opportunity = outfitOpportunity as MerchantOpportunity;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/merchants/profile' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { url?: string };
        if (body.url?.includes('outfit-brand-1.example')) {
          return Response.json(outfit, { status: 201 });
        }
        return Response.json(
          { error: { code: 'INVALID_REQUEST', message: 'Check the store URL and try again.' } },
          { status: 400 },
        );
      }
      if (path === `/api/merchants/${outfit.merchant.id}/opportunities`) {
        return Response.json({ opportunities: [opportunity] });
      }
      if (path.endsWith('/drafts') && init?.method === 'POST') {
        return Response.json(draftFor(opportunity, outfit.merchant.id), { status: 201 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<MerchantWorkspace back={() => undefined} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Public HTTPS store URL' }), {
      target: { value: `https://${outfit.merchant.domain}/` },
    });
    fireEvent.click(screen.getByRole('button', { name: /Profile demo store/ }));
    expect(await screen.findByText(outfit.merchant.name)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Create collaboration draft/ }));
    expect(await screen.findByDisplayValue(opportunity.proposedExperiment)).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Public HTTPS store URL' }), {
      target: { value: 'https://not-a-seed.com/' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Profile demo store/ }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText(outfit.merchant.name)).toBeNull();
    expect(screen.queryByRole('button', { name: /Create collaboration draft/ })).toBeNull();
    expect(screen.queryByLabelText('Collaboration draft')).toBeNull();
    expect(screen.queryByDisplayValue(opportunity.proposedExperiment)).toBeNull();
  });

  it('reloads the current draft after a revision conflict so a later save can succeed', async () => {
    const outfit = profileFor('outfit');
    const opportunity = outfitOpportunity as MerchantOpportunity;
    const v1 = draftFor(opportunity, outfit.merchant.id);
    const v2 = {
      ...v1,
      version: 2,
      proposalText: 'Saved in another request',
      uncertainties: ['Costs remain unknown'],
      updatedAt: '2026-09-19T12:05:00.000Z',
    };
    const v3 = {
      ...v2,
      version: 3,
      proposalText: 'Reconciled synthetic proposal',
      updatedAt: '2026-09-19T12:06:00.000Z',
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/merchants/profile' && init?.method === 'POST') {
        return Response.json(outfit, { status: 201 });
      }
      if (path === `/api/merchants/${outfit.merchant.id}/opportunities`) {
        return Response.json({ opportunities: [opportunity] });
      }
      if (path.endsWith('/drafts') && init?.method === 'POST') {
        return Response.json(v1, { status: 201 });
      }
      if (path === '/api/drafts/draft_web_1' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as { expectedVersion?: number };
        if (body.expectedVersion !== 2) {
          return Response.json(
            {
              error: {
                code: 'REVISION_CONFLICT',
                message: 'The draft changed in another request. Reload and try again.',
              },
            },
            { status: 409 },
          );
        }
        return Response.json(v3);
      }
      if (path === '/api/drafts/draft_web_1') {
        return Response.json(v2);
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<MerchantWorkspace back={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: /Profile demo store/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Create collaboration draft/ }));
    expect(await screen.findByText(/DRAFT · VERSION 1/)).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue(opportunity.proposedExperiment), {
      target: { value: 'Stale local edit' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByRole('button', { name: /Reload latest draft/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Reload latest draft/ }));

    expect(await screen.findByText(/DRAFT · VERSION 2/)).toBeTruthy();
    expect(screen.getByDisplayValue('Saved in another request')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Reload latest draft/ })).toBeNull();

    fireEvent.change(screen.getByDisplayValue('Saved in another request'), {
      target: { value: 'Reconciled synthetic proposal' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/drafts/draft_web_1',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('"expectedVersion":2'),
        }),
      ),
    );
    expect(await screen.findByText(/DRAFT · VERSION 3/)).toBeTruthy();
  });
});

describe('merchant surface gating', () => {
  it('does not call merchant APIs until FEATURE_MERCHANT_OPPORTUNITIES is explicitly true', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/session') return Response.json({ owner: true });
      if (path === '/api/capabilities') {
        return Response.json({ flags: { FEATURE_MERCHANT_OPPORTUNITIES: false } });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /I run a Shopify store/ }));
    expect(await screen.findByText(/Merchant profiling unlocks with S4/)).toBeTruthy();
    expect(fetchMock.mock.calls.every(([input]) => !String(input).includes('/api/merchants'))).toBe(
      true,
    );
  });
});
