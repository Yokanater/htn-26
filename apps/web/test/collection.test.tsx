/** S2-L4 shopper flow: confirmed brief -> capability-gated search -> streamed collection. */
import {
  type CollectionMatch,
  CollectionMatchSchema,
  type IntentBrief,
  IntentBriefSchema,
  type ProductOffer,
  ProductOfferSchema,
} from '@sei/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import outfitBrief from '../../../fixtures/seed/outfit/brief.json';
import outfitMatches from '../../../fixtures/seed/outfit/matches.json';
import outfitOffers from '../../../fixtures/seed/outfit/offers.json';
import setupBrief from '../../../fixtures/seed/setup/brief.json';
import setupMatches from '../../../fixtures/seed/setup/matches.json';
import setupOffers from '../../../fixtures/seed/setup/offers.json';
import { App } from '../src/App';

const SEEDS = {
  outfit: { brief: outfitBrief, offers: outfitOffers, matches: outfitMatches, toggle: null },
  setup: { brief: setupBrief, offers: setupOffers, matches: setupMatches, toggle: 'Room or desk' },
} as const;
type Domain = keyof typeof SEEDS;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  closed = false;
  onerror: (() => void) | null = null;
  readonly listeners = new Map<string, Array<(message: { data: string }) => void>>();
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (message: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    act(() => {
      for (const listener of this.listeners.get(type) ?? []) {
        listener({ data: JSON.stringify(data) });
      }
    });
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function seed(domain: Domain) {
  const raw = SEEDS[domain];
  const brief = IntentBriefSchema.parse(raw.brief);
  const offers = raw.offers.map((offer) => ProductOfferSchema.parse(offer));
  const match = CollectionMatchSchema.parse(raw.matches[0]);
  return { brief, offers, match, toggle: raw.toggle };
}

function readyResult(brief: IntentBrief, offers: ProductOffer[], match: CollectionMatch) {
  return {
    runId: 'run_ui_1',
    briefId: brief.id,
    briefRevision: brief.revision,
    status: 'ready',
    collection: {
      match,
      explanation: {
        matchId: match.id,
        summary: [
          {
            text: 'Known item subtotal CAD 300.00; excludes shipping and tax, which each store sets.',
            basis: 'computed_summary',
            evidenceIds: [],
          },
        ],
        slots: match.slots.map((slot, index) => ({
          slotId: slot.slotId,
          category: brief.slots[index]!.category,
          required: slot.required,
          state: 'selected',
          lines: [
            {
              text: `${offers[index]!.title} from ${offers[index]!.merchant.name}`,
              basis: 'product_fact',
              evidenceIds: [offers[index]!.evidence[0]!.id],
            },
          ],
        })),
      },
    },
    alternatives: [],
    offers,
    candidates: brief.slots.map((slot, index) => ({
      slotId: slot.id,
      offerIds: [offers[index]!.id],
    })),
    missing: [],
    warnings: [],
  };
}

interface Api {
  matchesResponse?: () => Response;
  collectionEnabled?: boolean;
}

function stubApi(domain: Domain, api: Api = {}) {
  const { brief } = seed(domain);
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    if (path === '/api/session') return Response.json({ owner: true });
    if (path === '/api/capabilities') {
      return Response.json({
        flags: { FEATURE_COLLECTION_MATCHING: api.collectionEnabled ?? true },
      });
    }
    if (path === '/api/briefs' && method === 'POST') {
      return Response.json({ ...brief, status: 'draft' }, { status: 201 });
    }
    if (path === `/api/briefs/${brief.id}` && method === 'PATCH') return Response.json(brief);
    if (path === `/api/briefs/${brief.id}/matches` && method === 'POST') {
      return (
        api.matchesResponse?.() ??
        Response.json(
          { runId: 'run_ui_1', briefId: brief.id, briefRevision: brief.revision },
          { status: 202 },
        )
      );
    }
    if (path === '/api/runs/run_ui_1' && method === 'DELETE') {
      return Response.json({ cancelled: true });
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

async function confirmBrief(domain: Domain) {
  const { toggle } = seed(domain);
  fireEvent.click(screen.getByRole('button', { name: /Start a collection/ }));
  if (toggle) fireEvent.click(screen.getByRole('button', { name: toggle }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Your collection idea' }), {
    target: { value: 'A calm, complete collection I can shop from a few stores' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Build my draft brief/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Find my collection/ }));
}

describe.each(['outfit', 'setup'] as const)('%s collection search', (domain) => {
  it('offers a search only after confirmation and shows the streamed collection', async () => {
    const { brief, offers, match } = seed(domain);
    const fetchMock = stubApi(domain);
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /Start a collection/ }));
    expect(screen.queryByRole('button', { name: /Find products/ })).toBeNull();
    cleanup();
    renderApp();
    await confirmBrief(domain);

    expect(await screen.findByText(/Searching stores for revision/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/briefs/${brief.id}/matches`,
      expect.objectContaining({ method: 'POST' }),
    );
    const stream = FakeEventSource.instances.at(-1)!;
    expect(stream.url).toBe('/api/runs/run_ui_1/events');

    stream.emit('stage', {
      type: 'stage',
      stage: 'discover',
      status: 'running',
      runId: 'run_ui_1',
      briefId: brief.id,
      briefRevision: brief.revision,
      seq: 1,
    });
    stream.emit('result', {
      type: 'result',
      runId: 'run_ui_1',
      briefId: brief.id,
      briefRevision: brief.revision,
      seq: 2,
      result: readyResult(brief, offers, match),
    });

    expect(await screen.findByText(/Collection ready/)).toBeTruthy();
    for (const offer of offers) expect(screen.getAllByText(offer.title).length).toBeGreaterThan(0);
    expect(screen.getByText(/no combined\s+checkout/i)).toBeTruthy();
    expect(stream.closed).toBe(true);
  });

  it('cancels the running search and closes the stream when the shopper leaves', async () => {
    const fetchMock = stubApi(domain);
    const { unmount } = renderApp();
    await confirmBrief(domain);
    fireEvent.click(await screen.findByRole('button', { name: /Cancel search/ }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/runs/run_ui_1',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );

    const stream = FakeEventSource.instances.at(-1)!;
    unmount();
    expect(stream.closed).toBe(true);
  });

  it('says why a search could not start', async () => {
    stubApi(domain, {
      matchesResponse: () =>
        Response.json(
          {
            error: {
              code: 'BRIEF_NOT_CONFIRMED',
              message: 'Confirm the brief before searching for products.',
            },
          },
          { status: 409 },
        ),
    });
    renderApp();
    await confirmBrief(domain);
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Confirm the brief before searching',
    );
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('hides the search entirely when collection matching is not enabled', async () => {
    stubApi(domain, { collectionEnabled: false });
    renderApp();
    await confirmBrief(domain);
    expect(screen.queryByRole('button', { name: /Find products/ })).toBeNull();
  });
});
