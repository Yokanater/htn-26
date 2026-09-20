import {
  type CollectionMatch,
  CollectionMatchSchema,
  type DemandEvent,
  DemandEventSchema,
  type IntentBrief,
  IntentBriefSchema,
  type ProductOffer,
  ProductOfferSchema,
} from '@sei/contracts';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import outfitBrief from '../../../../../../fixtures/seed/outfit/brief.json';
import outfitMatches from '../../../../../../fixtures/seed/outfit/matches.json';
import outfitOffers from '../../../../../../fixtures/seed/outfit/offers.json';
import setupBrief from '../../../../../../fixtures/seed/setup/brief.json';
import setupMatches from '../../../../../../fixtures/seed/setup/matches.json';
import setupOffers from '../../../../../../fixtures/seed/setup/offers.json';
import { CollectionWorkspace, type CollectionWorkspaceProps } from './CollectionWorkspace';
import {
  collectionDecision,
  type DecisionHandler,
  type DecisionResult,
  type DemandDecisionDto,
  displayedCollection,
  itemDecision,
} from './decisions';
import type { CollectionRunEvent, OfferTileRenderer } from './types';

afterEach(cleanup);

const SEEDS = {
  outfit: { brief: outfitBrief, offers: outfitOffers, matches: outfitMatches },
  setup: { brief: setupBrief, offers: setupOffers, matches: setupMatches },
};
const ON = { FEATURE_DEMAND_LEDGER: true };

/** Seed brief, offers and first match, plus one synthetic alternative for the second slot. */
function seed(domain: keyof typeof SEEDS) {
  const raw = SEEDS[domain];
  const brief = IntentBriefSchema.parse(raw.brief);
  const offers = raw.offers.map((offer) => ProductOfferSchema.parse(offer));
  const base = offers[1]!;
  const alternative: ProductOffer = {
    ...base,
    id: `offer_${domain}_alt`,
    variantId: `${base.variantId}-alt`,
    title: `${base.title} (alternative)`,
    merchant: { ...base.merchant, id: `mer_${domain}_alt`, name: 'Alt Store' },
  };
  const seeded = CollectionMatchSchema.parse(raw.matches[0]);
  const match: CollectionMatch = {
    ...seeded,
    slots: seeded.slots.map((slot, i) =>
      i === 1 ? { ...slot, alternativeOfferIds: [alternative.id] } : slot,
    ),
  };
  return { brief, offers: [...offers, alternative], match, alternative };
}

function resultEvent(
  brief: IntentBrief,
  offers: ProductOffer[],
  match: CollectionMatch,
  runId = 'run_1',
): CollectionRunEvent {
  return {
    type: 'result',
    runId,
    briefId: brief.id,
    briefRevision: brief.revision,
    seq: 1,
    result: {
      runId,
      briefId: brief.id,
      briefRevision: brief.revision,
      status: match.status === 'ready' ? 'ready' : 'partial',
      collection: {
        match,
        explanation: { matchId: match.id, summary: [], slots: [] },
      },
      alternatives: [],
      offers,
      candidates: [],
      missing: [],
      warnings: [],
    },
  };
}

const tile: OfferTileRenderer = (offer) => <p>tile:{offer.id}</p>;

/** Completes a DTO with the server-assigned fields; proves it is `DemandEvent`-compatible. */
function asEvent(dto: DemandDecisionDto): DemandEvent {
  return DemandEventSchema.parse({
    ...dto,
    id: 'evt_test',
    sessionId: 'sess_test',
    consentVersion: null,
    occurredAt: '2026-09-19T12:00:00Z',
    sampleOrigin: 'seed',
  });
}

function setup(
  domain: keyof typeof SEEDS,
  handler: DecisionHandler = async () => ({ ok: true }),
  props: Partial<CollectionWorkspaceProps> = {},
) {
  const data = seed(domain);
  const onDecision = vi.fn(handler);
  const view = render(
    <CollectionWorkspace
      brief={data.brief}
      events={[resultEvent(data.brief, data.offers, data.match)]}
      flags={ON}
      onDecision={onDecision}
      renderOffer={tile}
      runId="run_1"
      {...props}
    />,
  );
  const sent = () => onDecision.mock.calls.map(([dto]) => dto);
  return { ...data, onDecision, sent, view };
}

function slotGroup(category: string) {
  return screen.getByRole('group', { name: `Your choice for ${category}` });
}

async function rejectWith(title: string, reason: string) {
  fireEvent.click(screen.getByRole('button', { name: `Reject ${title}` }));
  const confirm = screen.getByRole('button', { name: 'Confirm rejection' });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: reason }));
  fireEvent.click(confirm);
}

describe.each(['outfit', 'setup'] as const)('%s collection decisions', (domain) => {
  it('accepts the displayed offer for the current revision and match', async () => {
    const { brief, offers, match, sent } = setup(domain);
    const [first] = offers;
    fireEvent.click(screen.getByRole('button', { name: `Accept ${first!.title}` }));
    await screen.findByText(`Accepted: ${first!.title}.`);
    expect(sent()).toEqual([
      {
        briefId: brief.id,
        briefRevision: brief.revision,
        kind: 'item_accepted',
        matchId: match.id,
        selections: [
          { slotId: brief.slots[0]!.id, offerId: first!.id, merchantId: first!.merchant.id },
        ],
        rejectionReason: null,
      },
    ]);
    expect(asEvent(sent()[0]!).kind).toBe('item_accepted');
  });

  it('rejects with a reason code and keeps the rejected item visible', async () => {
    const { brief, offers, sent } = setup(domain);
    const [first] = offers;
    await rejectWith(first!.title, 'Price');
    await screen.findByText(/^Rejected: .*\(Price\)\. It stays listed/);
    expect(sent()).toHaveLength(1);
    expect(asEvent(sent()[0]!)).toMatchObject({
      kind: 'item_rejected',
      rejectionReason: 'price',
      selections: [{ slotId: brief.slots[0]!.id, offerId: first!.id }],
    });
    expect(screen.getByText(`tile:${first!.id}`)).toBeTruthy();
    expect(slotGroup(brief.slots[0]!.category).dataset.decision).toBe('rejected');
  });

  it('undoes a rejection so the item can be chosen again', async () => {
    const { brief, offers, sent } = setup(domain);
    const [first] = offers;
    await rejectWith(first!.title, 'Other');
    fireEvent.click(await screen.findByRole('button', { name: 'Undo rejection' }));
    expect(screen.getByText(/Rejection undone/)).toBeTruthy();
    expect(sent()).toHaveLength(1);
    expect(slotGroup(brief.slots[0]!.category).dataset.decision).toBe('none');

    fireEvent.click(screen.getByRole('button', { name: `Accept ${first!.title}` }));
    await screen.findByText(`Accepted: ${first!.title}.`);
    expect(sent().map((dto) => dto.kind)).toEqual(['item_rejected', 'item_accepted']);
  });

  it('lets a rejection after an accept win and leaves the slot out of the saved selection', async () => {
    const { brief, offers, sent } = setup(domain);
    const [first, second] = offers;
    fireEvent.click(screen.getByRole('button', { name: `Accept ${first!.title}` }));
    await screen.findByText(`Accepted: ${first!.title}.`);
    await rejectWith(first!.title, 'Style');
    await screen.findByText(/^Rejected: /);
    expect(slotGroup(brief.slots[0]!.category).dataset.decision).toBe('rejected');

    fireEvent.click(screen.getByRole('button', { name: 'Save selection' }));
    await screen.findByRole('button', { name: 'Selection saved' });
    const saved = asEvent(sent()[2]!);
    expect(saved.kind).toBe('collection_saved');
    expect(saved.selections.map((s) => s.offerId)).toEqual([second!.id]);
  });

  it('replaces an item with a displayed alternative from its own merchant', async () => {
    const { brief, alternative, sent } = setup(domain);
    fireEvent.click(screen.getByRole('button', { name: `Use ${alternative.title} instead` }));
    await screen.findByText(`Accepted: ${alternative.title}.`);
    expect(sent()[0]!.selections).toEqual([
      { slotId: brief.slots[1]!.id, offerId: alternative.id, merchantId: alternative.merchant.id },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Request offer' }));
    await screen.findByRole('button', { name: 'Offer requested' });
    expect(asEvent(sent()[1]!).selections.map((s) => s.offerId)).toContain(alternative.id);
    expect(screen.getByText(/It is not an order: nothing is bought here/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /buy|purchase|checkout|cart/i })).toBeNull();
  });

  it('recovers from a stale revision and re-applies the choice to the latest revision', async () => {
    const results: DecisionResult[] = [{ ok: false, status: 409 }, { ok: true }];
    const onRefreshBrief = vi.fn();
    const { brief, offers, match, onDecision, sent, view } = setup(
      domain,
      async () => results.shift()!,
      { onRefreshBrief },
    );
    const [first] = offers;
    await rejectWith(first!.title, 'Size');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/results are no longer current/);
    fireEvent.click(within(alert).getByRole('button', { name: 'Load latest version' }));
    expect(onRefreshBrief).toHaveBeenCalledOnce();
    expect(slotGroup(brief.slots[0]!.category).dataset.decision).toBe('none');

    const revised: IntentBrief = { ...brief, revision: 2 };
    const revisedMatch: CollectionMatch = { ...match, id: `match_${domain}_r2`, briefRevision: 2 };
    view.rerender(
      <CollectionWorkspace
        brief={revised}
        events={[resultEvent(revised, offers, revisedMatch, 'run_2')]}
        flags={ON}
        onDecision={onDecision}
        onRefreshBrief={onRefreshBrief}
        renderOffer={tile}
        runId="run_2"
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: `Re-apply: Reject ${first!.title} (Size)` }),
    );
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(sent()).toHaveLength(2);
    expect(asEvent(sent()[1]!)).toMatchObject({
      briefRevision: 2,
      matchId: revisedMatch.id,
      kind: 'item_rejected',
      rejectionReason: 'size',
    });
    expect(sent()[0]!.briefRevision).toBe(1);
    expect(slotGroup(brief.slots[0]!.category).dataset.decision).toBe('rejected');
  });

  it('never submits an offer the latest revision no longer shows', async () => {
    const { brief, offers, match, alternative, onDecision, view } = setup(domain, async () => ({
      ok: false,
      status: 409,
    }));
    fireEvent.click(screen.getByRole('button', { name: `Use ${alternative.title} instead` }));
    await screen.findByRole('alert');

    const revised: IntentBrief = { ...brief, revision: 2 };
    const revisedMatch: CollectionMatch = {
      ...match,
      id: `match_${domain}_r2`,
      briefRevision: 2,
      slots: match.slots.map((slot) => ({ ...slot, alternativeOfferIds: [] })),
    };
    view.rerender(
      <CollectionWorkspace
        brief={revised}
        events={[
          resultEvent(
            revised,
            offers.filter((o) => o.id !== alternative.id),
            revisedMatch,
            'run_2',
          ),
        ]}
        flags={ON}
        onDecision={onDecision}
        renderOffer={tile}
        runId="run_2"
      />,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/isn't shown for this item/);
    expect(screen.queryByRole('button', { name: /^Re-apply/ })).toBeNull();
    expect(onDecision).toHaveBeenCalledOnce();

    const shown = displayedCollection(revised, revisedMatch, offers)!;
    const forged = { kind: 'item_accepted', slotId: brief.slots[1]!.id } as const;
    expect(itemDecision(shown, { ...forged, offerId: alternative.id })).toBeNull();
    expect(itemDecision(shown, { ...forged, offerId: 'offer_never_shown' })).toBeNull();
    // An offer shown for another slot is not shown for this one.
    expect(itemDecision(shown, { ...forged, offerId: offers[0]!.id })).toBeNull();
    expect(displayedCollection(revised, match, offers)).toBeNull();
  });

  it('sends one event for a double click and none for a repeat of the recorded choice', async () => {
    let release: (value: DecisionResult) => void = () => {};
    const { offers, sent } = setup(
      domain,
      () =>
        new Promise<DecisionResult>((resolve) => {
          release = resolve;
        }),
    );
    const [first] = offers;
    const accept = screen.getByRole('button', { name: `Accept ${first!.title}` });
    fireEvent.click(accept);
    fireEvent.click(accept);
    fireEvent.click(screen.getByRole('button', { name: 'Save selection' }));
    expect(sent()).toHaveLength(1);
    release({ ok: true });
    await screen.findByText(`Accepted: ${first!.title}.`);
    fireEvent.click(screen.getByRole('button', { name: `Accept ${first!.title}` }));
    expect(sent()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Save selection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save selection' }));
    expect(sent()).toHaveLength(2);
    release({ ok: true });
    await screen.findByRole('button', { name: 'Selection saved' });
    fireEvent.click(screen.getByRole('button', { name: 'Selection saved' }));
    expect(sent()).toHaveLength(2);
  });

  it('renders no decision control and sends nothing when the ledger flag is off', () => {
    const cases: Partial<CollectionWorkspaceProps>[] = [
      { flags: { FEATURE_DEMAND_LEDGER: false } },
      { flags: undefined },
      { flags: {} },
      { onDecision: undefined },
    ];
    for (const props of cases) {
      const { onDecision, offers } = setup(domain, undefined, props);
      expect(screen.getByText(`tile:${offers[0]!.id}`)).toBeTruthy();
      expect(
        screen.queryByRole('button', {
          name: /accept|reject|instead|save selection|request offer/i,
        }),
      ).toBeNull();
      expect(screen.queryByRole('group', { name: /Your choice/ })).toBeNull();
      expect(onDecision).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it('keeps the choice and explains a non-stale failure', async () => {
    const results: (DecisionResult | Error)[] = [{ ok: false, status: 500 }, new Error('offline')];
    const { brief, offers } = setup(domain, async () => {
      const next = results.shift()!;
      if (next instanceof Error) throw next;
      return next;
    });
    const accept = () =>
      fireEvent.click(screen.getByRole('button', { name: `Accept ${offers[0]!.title}` }));
    accept();
    expect((await screen.findByRole('alert')).textContent).toMatch(/error 500/);
    accept();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/Couldn't reach the server/),
    );
    expect(slotGroup(brief.slots[0]!.category).dataset.decision).toBe('none');
  });

  it('shows no consent state: decisions are the same with or without sharing', () => {
    setup(domain);
    expect(screen.queryByText(/consent|sharing|opt(ed)? in/i)).toBeNull();
  });
});

describe('decision DTOs', () => {
  const { brief, offers, match } = seed('setup');
  const shown = displayedCollection(brief, match, offers)!;

  it('builds DemandEvent-compatible collection decisions over current picks only', () => {
    const dto = collectionDecision(
      shown,
      { kind: 'offer_requested' },
      {
        [brief.slots[0]!.id]: { kind: 'rejected', offerId: offers[0]!.id, reason: 'shipping' },
      },
    )!;
    expect(asEvent(dto).selections).toEqual([
      { slotId: brief.slots[1]!.id, offerId: offers[1]!.id, merchantId: offers[1]!.merchant.id },
    ]);
    const allRejected = Object.fromEntries(
      brief.slots.map((slot, i) => [
        slot.id,
        { kind: 'rejected', offerId: offers[i]!.id, reason: 'other' } as const,
      ]),
    );
    expect(collectionDecision(shown, { kind: 'collection_saved' }, allRejected)).toBeNull();
  });

  it('does not treat a match for another brief as displayed', () => {
    expect(displayedCollection({ ...brief, id: 'brief_other' }, match, offers)).toBeNull();
  });
});
