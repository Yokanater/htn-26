import {
  type CollectionMatch,
  CollectionMatchSchema,
  type IntentBrief,
  IntentBriefSchema,
  type ProductOffer,
  ProductOfferSchema,
} from '@sei/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import outfitBrief from '../../../../../../fixtures/seed/outfit/brief.json';
import outfitMatches from '../../../../../../fixtures/seed/outfit/matches.json';
import outfitOffers from '../../../../../../fixtures/seed/outfit/offers.json';
import setupBrief from '../../../../../../fixtures/seed/setup/brief.json';
import setupMatches from '../../../../../../fixtures/seed/setup/matches.json';
import setupOffers from '../../../../../../fixtures/seed/setup/offers.json';
import { CollectionWorkspace } from './CollectionWorkspace';
import { applyRunEvent, deriveRunView, initialRunView } from './runState';
import type {
  CollectionRunEvent,
  CollectionRunResult,
  MissingItem,
  OfferTileRenderer,
} from './types';

afterEach(cleanup);

const SEEDS = {
  outfit: { brief: outfitBrief, offers: outfitOffers, matches: outfitMatches },
  setup: { brief: setupBrief, offers: setupOffers, matches: setupMatches },
};

function seed(domain: keyof typeof SEEDS) {
  const raw = SEEDS[domain];
  return {
    brief: IntentBriefSchema.parse(raw.brief),
    offers: raw.offers.map((offer) => ProductOfferSchema.parse(offer)),
    match: CollectionMatchSchema.parse(raw.matches[0]),
  };
}

function result(
  brief: IntentBrief,
  offers: ProductOffer[],
  match: CollectionMatch | null,
  overrides: Partial<CollectionRunResult> = {},
): CollectionRunResult {
  return {
    runId: 'run_1',
    briefId: brief.id,
    briefRevision: brief.revision,
    status: 'ready',
    collection: match && {
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
    ...overrides,
  };
}

function resultEvent(res: CollectionRunResult, seq = 2): CollectionRunEvent {
  return {
    type: 'result',
    runId: res.runId,
    briefId: res.briefId,
    briefRevision: res.briefRevision,
    seq,
    result: res,
  };
}

function stageEvent(
  brief: IntentBrief,
  runId: string,
  seq: number,
  revision = brief.revision,
): CollectionRunEvent {
  return {
    type: 'stage',
    stage: 'discover',
    status: 'running',
    runId,
    briefId: brief.id,
    briefRevision: revision,
    seq,
  };
}

describe.each(['outfit', 'setup'] as const)('%s collection workspace', (domain) => {
  it('renders each selected offer through the injected product tile with cited reasons', () => {
    const { brief, offers, match } = seed(domain);
    const renderOffer = vi.fn<OfferTileRenderer>((offer) => <p>tile:{offer.id}</p>);
    render(
      <CollectionWorkspace
        brief={brief}
        events={[resultEvent(result(brief, offers, match))]}
        renderOffer={renderOffer}
        runId="run_1"
      />,
    );
    expect(renderOffer.mock.calls.map(([offer, ctx]) => [offer.id, ctx.selected])).toEqual(
      offers.map((offer) => [offer.id, true]),
    );
    for (const offer of offers) expect(screen.getByText(`tile:${offer.id}`)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/Collection ready/);
    expect(screen.getByRole('list', { name: 'Collection summary' }).textContent).toMatch(
      /excludes shipping and tax/,
    );
    expect(screen.getAllByText('Product fact')).toHaveLength(offers.length);
    expect(screen.queryByRole('button', { name: /cart|checkout|buy/i })).toBeNull();
  });

  it('falls back to a readable tile with an external store link', () => {
    const { brief, offers, match } = seed(domain);
    const unknownPrice = offers.map((offer, i) => (i === 0 ? { ...offer, price: null } : offer));
    render(
      <CollectionWorkspace
        brief={brief}
        events={[resultEvent(result(brief, unknownPrice, match))]}
        runId="run_1"
      />,
    );
    const link = screen.getByRole('link', { name: `View on ${offers[0]!.merchant.domain}` });
    expect(link.getAttribute('href')).toBe(offers[0]!.productUrl);
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText('Price unknown')).toBeTruthy();
  });

  it('shows the exact missing slot and unverified constraint of a partial collection', () => {
    const { brief, offers, match } = seed(domain);
    const partialMatch: CollectionMatch = {
      ...match,
      status: 'partial',
      itemSubtotal: null,
      slots: match.slots.map((slot, index) =>
        index === 1 ? { ...slot, selectedOfferId: null, checks: [] } : slot,
      ),
    };
    const missing: MissingItem[] = [
      {
        kind: 'constraint',
        slotId: brief.slots[0]!.id,
        offerId: offers[0]!.id,
        key: 'size',
        status: 'unknown',
      },
      {
        kind: 'slot',
        slotId: brief.slots[1]!.id,
        category: brief.slots[1]!.category,
        required: true,
        reason: 'provider_failed',
      },
    ];
    render(
      <CollectionWorkspace
        brief={brief}
        events={[
          resultEvent(
            result(brief, offers, partialMatch, {
              status: 'partial',
              missing,
              candidates: brief.slots.map((slot, index) => ({
                slotId: slot.id,
                offerIds: index === 1 ? [] : [offers[index]!.id],
              })),
            }),
          ),
        ]}
        runId="run_1"
      />,
    );
    expect(screen.getByRole('status').textContent).toMatch(/closest products/);
    expect(screen.queryByRole('list', { name: `${brief.slots[0]!.category} gaps` })).toBeNull();
    expect(
      screen.getByRole('list', { name: `${brief.slots[1]!.category} gaps` }).textContent,
    ).toMatch(/product search failed/);
    expect(screen.getByText('Not found.')).toBeTruthy();
  });

  it('shows the closest ranked candidate instead of a verification placeholder', () => {
    const { brief, offers, match } = seed(domain);
    const emptySelection: CollectionMatch = {
      ...match,
      status: 'partial',
      slots: match.slots.map((slot, index) =>
        index === 0 ? { ...slot, selectedOfferId: null, alternativeOfferIds: [] } : slot,
      ),
    };
    const renderOffer = vi.fn<OfferTileRenderer>((offer) => <p>tile:{offer.id}</p>);
    const missing: MissingItem[] = [
      {
        kind: 'slot',
        slotId: brief.slots[0]!.id,
        category: brief.slots[0]!.category,
        required: true,
        reason: 'no_eligible_offer',
      },
    ];
    render(
      <CollectionWorkspace
        brief={brief}
        events={[
          resultEvent(result(brief, offers, emptySelection, { status: 'partial', missing })),
        ]}
        renderOffer={renderOffer}
        runId="run_1"
      />,
    );

    expect(screen.getByText(`tile:${offers[0]!.id}`)).toBeTruthy();
    expect(screen.queryByText(/verification needed/i)).toBeNull();
    expect(screen.queryByText(/not every requirement/i)).toBeNull();
  });

  it('shows progress and cancels while running', () => {
    const { brief } = seed(domain);
    const onCancel = vi.fn();
    render(
      <CollectionWorkspace
        brief={brief}
        events={[stageEvent(brief, 'run_1', 1)]}
        onCancel={onCancel}
        runId="run_1"
      />,
    );
    expect(screen.getByRole('list', { name: 'Search progress' }).textContent).toMatch(
      /Finding products: in progress/,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel search' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('never lets an old revision or another run update the view', () => {
    const { brief, offers, match } = seed(domain);
    const renderOffer = vi.fn<OfferTileRenderer>(() => <p>tile</p>);
    const oldResult = resultEvent(result(brief, offers, match), 5);
    const { rerender } = render(
      <CollectionWorkspace
        brief={brief}
        events={[oldResult]}
        renderOffer={renderOffer}
        runId="run_1"
      />,
    );
    expect(renderOffer).toHaveBeenCalled();

    // The shopper changes the budget: revision 2 starts run_2; run_1's events keep arriving.
    renderOffer.mockClear();
    const revised: IntentBrief = {
      ...brief,
      revision: 2,
      itemBudget: { amount: 10_000, currency: 'CAD' },
    };
    rerender(
      <CollectionWorkspace
        brief={revised}
        events={[
          oldResult,
          stageEvent(revised, 'run_2', 1),
          resultEvent(result(brief, offers, match), 6),
        ]}
        renderOffer={renderOffer}
        runId="run_2"
      />,
    );
    expect(renderOffer).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toMatch(/revision 2/);
    expect(screen.queryByText(/Collection ready/)).toBeNull();
  });
});

describe('run view state', () => {
  const { brief, offers, match } = seed('outfit');

  it('ignores events from another run, brief or revision, and out-of-order events', () => {
    const start = initialRunView(brief, 'run_1');
    const foreign: CollectionRunEvent[] = [
      stageEvent(brief, 'run_other', 1),
      stageEvent({ ...brief, id: 'brief_other' }, 'run_1', 1),
      stageEvent(brief, 'run_1', 1, brief.revision + 1),
    ];
    for (const event of foreign) expect(applyRunEvent(start, event)).toBe(start);
    const advanced = applyRunEvent(start, stageEvent(brief, 'run_1', 3));
    expect(applyRunEvent(advanced, stageEvent(brief, 'run_1', 2))).toBe(advanced);
  });

  it('rejects a result whose payload disagrees with its envelope, and freezes once done', () => {
    const mismatched = resultEvent(result(brief, offers, match, { briefRevision: 7 }));
    const forged = { ...mismatched, briefRevision: brief.revision };
    expect(deriveRunView(brief, 'run_1', [forged]).result).toBeNull();

    const done = deriveRunView(brief, 'run_1', [resultEvent(result(brief, offers, match))]);
    expect(done.phase).toBe('done');
    expect(applyRunEvent(done, stageEvent(brief, 'run_1', 9))).toBe(done);
  });

  it('shows nothing before a run starts', () => {
    const view = deriveRunView(brief, null, [resultEvent(result(brief, offers, match))]);
    expect(view).toMatchObject({ phase: 'idle', result: null });
  });
});
