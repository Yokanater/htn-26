import {
  CollectionMatchSchema,
  type IntentBrief,
  IntentBriefSchema,
  ProductOfferSchema,
} from '@sei/contracts';

import { cleanup, render, screen } from '@testing-library/react';

import { afterEach, expect, it, vi } from 'vitest';
import outfitBrief from '../../../../fixtures/seed/outfit/brief.json';
import outfitMatches from '../../../../fixtures/seed/outfit/matches.json';
import outfitOffers from '../../../../fixtures/seed/outfit/offers.json';
import setupBrief from '../../../../fixtures/seed/setup/brief.json';
import setupMatches from '../../../../fixtures/seed/setup/matches.json';
import setupOffers from '../../../../fixtures/seed/setup/offers.json';
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

it('shows one product in Explore the finds instead of duplicate size variants', () => {
  const base = ProductOfferSchema.parse(outfitOffers[0]);
  const first = { ...base, id: 'offer_first', variantId: 'M', title: 'Alternative blue shirt' };
  const second = { ...first, id: 'offer_second', variantId: 'L' };
  render(
    <ShoppingResults
      brief={brief}
      runId="run_test"
      onCancel={vi.fn()}
      onRetry={vi.fn()}
      events={[
        {
          type: 'result',
          runId: 'run_test',
          briefId: brief.id,
          briefRevision: brief.revision,
          seq: 1,
          result: {
            runId: 'run_test',
            briefId: brief.id,
            briefRevision: brief.revision,
            status: 'partial',
            collection: null,
            alternatives: [],
            offers: [first, second],
            candidates: [],
            missing: [],
            warnings: [],
          },
        },
      ]}
    />,
  );
  expect(screen.getAllByText('Alternative blue shirt')).toHaveLength(1);
});
it('shows actionable empty results from the current streamed run', async () => {
  render(
    <ShoppingResults
      brief={brief}
      runId="run_test"
      onCancel={() => {}}
      onRetry={() => {}}
      events={[
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
      ]}
    />,
  );
  expect(await screen.findByText(/No verifiable storefront/)).toBeTruthy();
});

/**
 * Decision controls only reach a shopper if the shell forwards flags and a handler. The
 * components were complete while nothing passed these through, so S3 was unreachable in the
 * app; this guards that wiring rather than the controls themselves.
 */
it.each([
  ['outfit', outfitBrief, outfitOffers, outfitMatches],
  ['setup', setupBrief, setupOffers, setupMatches],
] as const)(
  'forwards %s decision wiring to the collection workspace',
  async (_d, raw, rawOffers, rawMatches) => {
    const seeded = IntentBriefSchema.parse(raw);
    const offers = rawOffers.map((offer) => ProductOfferSchema.parse(offer));
    const match = CollectionMatchSchema.parse(rawMatches[0]);
    const onDecision = vi.fn(async () => ({ ok: true }) as const);

    render(
      <ShoppingResults
        brief={seeded}
        runId="run_test"
        onCancel={() => {}}
        onRetry={() => {}}
        flags={{ FEATURE_DEMAND_LEDGER: true }}
        onDecision={onDecision}
        events={[
          {
            type: 'result',
            runId: 'run_test',
            briefId: seeded.id,
            briefRevision: seeded.revision,
            seq: 1,
            result: {
              runId: 'run_test',
              briefId: seeded.id,
              briefRevision: seeded.revision,
              status: 'ready',
              collection: { match, explanation: { matchId: match.id, summary: [], slots: [] } },
              alternatives: [],
              offers,
              candidates: [],
              missing: [],
              warnings: [],
            },
          },
        ]}
      />,
    );

    const groups = await screen.findAllByRole('group', { name: /Your choice for/ });
    expect(groups.length).toBeGreaterThan(0);
  },
);
