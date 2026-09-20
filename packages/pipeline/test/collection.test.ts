/** S2-L3-1 collection runs. Offline: fake catalog, fake matcher, synthetic seed fixtures. Owner: L3. */
import type { CollectionMatch, IntentBrief, ShoppingDomain } from '@sei/contracts';
import { type CollectionExplainer, checkExplanation, explainCollection } from '@sei/reason';
import { describe, expect, it, vi } from 'vitest';
import {
  type CollectionRunEvent,
  type CollectionRunnerOptions,
  createCollectionRunner,
  createMemoryCheckpointStore,
  matchIssues,
} from '../src';
import {
  DOMAINS,
  extraOffer,
  type FakeCatalogOptions,
  type FakeMatcherMode,
  fakeCatalog,
  fakeMatcher,
  revise,
  seedBrief,
  seedOffers,
} from './fakes';

const NOW = new Date('2026-09-19T12:00:00Z');

function harness(
  domain: ShoppingDomain,
  {
    catalog: catalogOptions = {},
    matcher: mode = 'greedy',
    runner: runnerOptions = {},
  }: {
    catalog?: Partial<FakeCatalogOptions>;
    matcher?: FakeMatcherMode;
    runner?: Partial<CollectionRunnerOptions>;
  } = {},
) {
  const brief = seedBrief(domain);
  const catalog = fakeCatalog({ offers: seedOffers(domain), ...catalogOptions });
  const matcher = fakeMatcher(mode);
  const events: CollectionRunEvent[] = [];
  let n = 0;
  const runner = createCollectionRunner({
    openCatalog: catalog.open,
    matcher,
    checkpoints: createMemoryCheckpointStore(),
    clock: () => NOW,
    runId: () => `run_t${++n}`,
    onEvent: (event) => events.push(event),
    ...runnerOptions,
  });
  return { brief, catalog, matcher, events, runner, slot: (i: number) => brief.slots[i]! };
}

function draft(brief: IntentBrief): IntentBrief {
  return { ...brief, status: 'draft' };
}

describe.each(DOMAINS)('%s collection run', (domain) => {
  it('turns a confirmed brief into a ready, evidence-cited collection and closes the catalog', async () => {
    const { brief, catalog, events, runner } = harness(domain);
    const result = await runner.start(brief).result;

    expect(result.status).toBe('ready');
    expect(result.missing).toEqual([]);
    const offers = seedOffers(domain);
    expect(result.collection?.match.slots.map((slot) => slot.selectedOfferId)).toEqual(
      offers.map((offer) => offer.id),
    );
    expect(result.offers.map((offer) => offer.id)).toEqual(offers.map((offer) => offer.id));
    expect(result.queries).toHaveLength(brief.slots.length * 2);
    expect(result.usage.catalog_query).toBe(brief.slots.length * 2);

    const explanation = result.collection!.explanation;
    expect(checkExplanation(explanation, { match: result.collection!.match, offers })).toEqual([]);
    for (const [index, slot] of explanation.slots.entries()) {
      const fact = slot.lines.find((line) => line.basis === 'product_fact');
      expect(fact?.evidenceIds).toEqual([offers[index]!.evidence[0]!.id]);
    }
    expect(explanation.summary.map((line) => line.text).join(' ')).toMatch(
      /CAD 300\.00; excludes shipping and tax/,
    );

    expect(catalog.stats).toMatchObject({ opened: 1, closed: 1 });
    expect(events.at(-1)).toMatchObject({ type: 'result', briefRevision: 1 });
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
    expect(
      events.filter((event) => event.type === 'stage').map((e) => `${e.stage}:${e.status}`),
    ).toEqual([
      'plan:completed',
      'discover:running',
      'discover:completed',
      'match:running',
      'match:completed',
      'explain:running',
      'explain:completed',
    ]);
  });

  it('enforces the confirmation barrier before any provider call', () => {
    const { brief, catalog, matcher, events, runner } = harness(domain);
    expect(() => runner.start(draft(brief))).toThrow(
      expect.objectContaining({ kind: 'not_confirmed' }),
    );
    expect(() => runner.start({ ...brief, slots: [] })).toThrow(
      expect.objectContaining({ kind: 'invalid_brief' }),
    );
    expect(catalog.stats.searches).toHaveLength(0);
    expect(catalog.stats.opened).toBe(0);
    expect(matcher.calls).toHaveLength(0);
    expect(events).toEqual([]);
  });

  it('returns a partial result naming the exact slot after a provider failure, then retries only that slot', async () => {
    const failSlots = new Set<string>();
    const { brief, catalog, events, runner, slot } = harness(domain, { catalog: { failSlots } });
    failSlots.add(slot(1).id);
    const result = await runner.start(brief).result;

    expect(result.status).toBe('partial');
    expect(result.collection?.match.slots[0]?.selectedOfferId).toBe(seedOffers(domain)[0]!.id);
    expect(result.missing).toEqual([
      {
        kind: 'slot',
        slotId: slot(1).id,
        category: slot(1).category,
        required: true,
        reason: 'provider_failed',
      },
    ]);
    expect(result.queries.filter((q) => q.status === 'provider_failed')).toHaveLength(2);
    expect(result.warnings).toContain('query_failed');
    expect(result.stages).toContainEqual({ stage: 'discover', status: 'partial' });
    expect(JSON.stringify({ result, events })).not.toContain('PROVIDER-BODY-SECRET');

    // Provider recovers: the same revision reruns only the failed slot's queries.
    failSlots.clear();
    const before = catalog.stats.searches.length;
    const retried = await runner.start(brief).result;
    expect(retried.status).toBe('ready');
    const newSearches = catalog.stats.searches.slice(before);
    expect(newSearches).toHaveLength(2);
    expect(new Set(newSearches.map((query) => query.slotId))).toEqual(new Set([slot(1).id]));
  });

  it('names an unverified hard constraint instead of calling the collection ready', async () => {
    const offers = seedOffers(domain).map((offer, index) =>
      index === 0 ? { ...offer, attributes: {} } : offer,
    );
    const { brief, runner, slot } = harness(domain, { catalog: { offers } });
    const result = await runner.start(brief).result;

    expect(result.status).toBe('partial');
    expect(result.missing).toEqual([
      {
        kind: 'constraint',
        slotId: slot(0).id,
        offerId: offers[0]!.id,
        key: domain === 'outfit' ? 'size' : 'dimension:width',
        status: 'unknown',
      },
    ]);
    const explained = result.collection!.explanation.slots[0]!;
    expect(explained.state).toBe('needs_verification');
    expect(explained.lines.map((line) => line.text).join(' ')).toMatch(/Needs verification/);
  });

  it('cancellation closes the catalog session and starts no queued work', async () => {
    const { brief, catalog, matcher, events, runner } = harness(domain, {
      catalog: { hang: () => true },
      runner: { concurrency: 1 },
    });
    const handle = runner.start(brief);
    await vi.waitFor(() => expect(catalog.stats.searches).toHaveLength(1));
    handle.cancel();
    const result = await handle.result;

    expect(result.status).toBe('cancelled');
    expect(catalog.stats).toMatchObject({ opened: 1, closed: 1, settled: 1 });
    expect(catalog.stats.searches).toHaveLength(1);
    expect(matcher.calls).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: 'result', result: { status: 'cancelled' } });
  });

  it('cancellation settles and closes even when the provider ignores the signal', async () => {
    const { brief, catalog, runner } = harness(domain, {
      catalog: { hang: () => true, ignoreSignal: true },
    });
    const controller = new AbortController();
    const handle = runner.start(brief, { signal: controller.signal });
    await vi.waitFor(() => expect(catalog.stats.searches.length).toBeGreaterThan(0));
    controller.abort();
    await expect(handle.result).resolves.toMatchObject({ status: 'cancelled' });
    expect(catalog.stats.closed).toBe(1);
  });

  it('shares one hard deadline across discovery and matching', async () => {
    const { brief, runner } = harness(domain, {
      catalog: { delayMs: 100 },
      matcher: 'hang',
      runner: { timeoutMs: 250 },
    });
    const started = performance.now();
    const result = await runner.start(brief).result;
    const elapsed = performance.now() - started;

    // A per-stage timeout would take >= 100 + 250 ms.
    expect(elapsed).toBeGreaterThanOrEqual(240);
    expect(elapsed).toBeLessThan(330);
    expect(result.status).toBe('partial');
    expect(result.stages).toContainEqual({ stage: 'match', status: 'failed' });
    expect(result.missing.map((item) => item.kind === 'slot' && item.reason)).toEqual(
      brief.slots.map(() => 'deadline'),
    );
    expect(result.candidates.every((c) => c.offerIds.length === 1)).toBe(true);
  });

  it('stops discovery at the soft deadline and matches what was found', async () => {
    const { brief, runner, slot } = harness(domain, {
      catalog: { hang: (query) => query.slotId === brief.slots[1]!.id },
      runner: { discoveryTimeoutMs: 50 },
    });
    const result = await runner.start(brief).result;

    expect(result.status).toBe('partial');
    expect(result.collection?.match.slots[0]?.selectedOfferId).toBe(seedOffers(domain)[0]!.id);
    expect(result.missing).toEqual([
      expect.objectContaining({ kind: 'slot', slotId: slot(1).id, reason: 'deadline' }),
    ]);
  });

  it('a budget change mid-run supersedes the old revision, which never updates the UI', async () => {
    let hang = true;
    const { brief, catalog, events, runner, slot } = harness(domain, {
      catalog: { hang: () => hang },
    });
    const first = runner.start(brief);
    await vi.waitFor(() => expect(catalog.stats.searches.length).toBeGreaterThan(0));

    hang = false;
    const cheaper = revise(brief, { itemBudget: { amount: 10_000, currency: brief.currency } });
    const cutoff = events.length;
    const second = runner.start(cheaper);
    const [old, current] = await Promise.all([first.result, second.result]);

    expect(old).toMatchObject({ status: 'superseded', collection: null, briefRevision: 1 });
    expect(events.slice(cutoff).every((event) => event.briefRevision === 2)).toBe(true);
    expect(events.some((event) => event.type === 'result' && event.briefRevision === 1)).toBe(
      false,
    );
    expect(catalog.stats.opened).toBe(catalog.stats.closed);

    expect(current.briefRevision).toBe(2);
    expect(current.status).toBe('partial');
    expect(current.missing).toEqual([
      expect.objectContaining({ kind: 'slot', slotId: slot(1).id, reason: 'no_eligible_offer' }),
    ]);
    expect(() => runner.start(brief)).toThrow(expect.objectContaining({ kind: 'stale_revision' }));
  });

  it('invalidate() after a brief edit silences the running revision', async () => {
    const { brief, catalog, events, runner } = harness(domain, { catalog: { hang: () => true } });
    const handle = runner.start(brief);
    await vi.waitFor(() => expect(catalog.stats.searches.length).toBeGreaterThan(0));
    const cutoff = events.length;
    runner.invalidate(brief.id, 2);

    await expect(handle.result).resolves.toMatchObject({ status: 'superseded' });
    expect(events.slice(cutoff)).toEqual([]);
    expect(runner.latestRevision(brief.id)).toBe(2);
    expect(catalog.stats.closed).toBe(catalog.stats.opened);
  });

  it('a budget-only revision reuses discovery checkpoints and reruns only match and explain', async () => {
    const { brief, catalog, matcher, runner, slot } = harness(domain);
    await runner.start(brief).result;
    const fetched = catalog.stats.searches.length;

    const cheaper = revise(brief, { itemBudget: { amount: 10_000, currency: brief.currency } });
    const result = await runner.start(cheaper).result;
    expect(catalog.stats.searches).toHaveLength(fetched);
    expect(result.queries.every((query) => query.status === 'reused')).toBe(true);
    expect(result.stages).toContainEqual({ stage: 'discover', status: 'reused' });
    expect(matcher.calls.map((call) => call.revision)).toEqual([1, 2]);
    expect(result.collection?.match.briefRevision).toBe(2);
    expect(result.missing).toEqual([
      expect.objectContaining({ slotId: slot(1).id, reason: 'no_eligible_offer' }),
    ]);

    // Editing one slot refetches only that slot's changed queries.
    const edited = revise(cheaper, {
      slots: cheaper.slots.map((s, index) =>
        index === 0 ? { ...s, visualAttributes: ['charcoal'] } : s,
      ),
    });
    await runner.start(edited).result;
    const newSearches = catalog.stats.searches.slice(fetched);
    expect(newSearches.length).toBeGreaterThan(0);
    expect(newSearches.every((query) => query.slotId === slot(0).id)).toBe(true);
  });

  describe('match checkpoint after a discovery refresh', () => {
    const PAST_FACT_TTL_MS = 16 * 60_000;

    function refreshHarness() {
      let now = NOW;
      const offers = seedOffers(domain);
      const parts = harness(domain, { catalog: { offers }, runner: { clock: () => now } });
      return {
        ...parts,
        offers,
        expireFacts: () => {
          now = new Date(NOW.getTime() + PAST_FACT_TTL_MS);
        },
      };
    }

    it('rematches when a refreshed offer keeps its ID but changes its listed facts', async () => {
      const { brief, offers, matcher, runner, expireFacts } = refreshHarness();
      const first = await runner.start(brief).result;
      expect(first.stages).toContainEqual({ stage: 'match', status: 'completed' });

      // The seller relists the same offer as a different size; the catalog refetch returns it.
      const target = offers[0]!;
      target.attributes = { ...target.attributes, size: 'L' };
      expireFacts();

      const second = await runner.start(brief).result;
      expect(second.queries.every((query) => query.status === 'fetched')).toBe(true);
      expect(second.offers.find((offer) => offer.id === target.id)?.attributes.size).toBe('L');
      expect(second.stages).toContainEqual({ stage: 'match', status: 'completed' });
      expect(matcher.calls).toHaveLength(2);
    });

    it('still reuses the match when the refetch returns identical offers', async () => {
      const { brief, matcher, runner, expireFacts } = refreshHarness();
      await runner.start(brief).result;
      expireFacts();

      const second = await runner.start(brief).result;
      expect(second.queries.every((query) => query.status === 'fetched')).toBe(true);
      expect(second.stages).toContainEqual({ stage: 'match', status: 'reused' });
      expect(matcher.calls).toHaveLength(1);
    });
  });

  it('spends the catalog-query budget on each slot first query before any second query', async () => {
    const two = harness(domain, { runner: { caps: { catalog_query: 2 } } });
    const covered = await two.runner.start(two.brief).result;
    expect(two.catalog.stats.searches.map((q) => q.slotId)).toEqual(
      two.brief.slots.map((s) => s.id),
    );
    expect(covered.status).toBe('ready');
    expect(covered.queries.filter((q) => q.status === 'budget_exhausted')).toHaveLength(2);

    const one = harness(domain, { runner: { caps: { catalog_query: 1 } } });
    const short = await one.runner.start(one.brief).result;
    expect(short.status).toBe('partial');
    expect(short.missing).toEqual([
      expect.objectContaining({ slotId: one.slot(1).id, reason: 'budget_exhausted' }),
    ]);
  });

  describe('catalog adapters that also charge the budget', () => {
    it('charges each planned query once, not once by the runner and again by the adapter', async () => {
      const { brief, runner } = harness(domain, { catalog: { chargesBudget: 1 } });
      const result = await runner.start(brief).result;
      expect(result.queries).toHaveLength(brief.slots.length * 2);
      expect(result.usage.catalog_query).toBe(result.queries.length);
    });

    it('lets a cap equal to the planned query count fetch every query', async () => {
      const cap = seedBrief(domain).slots.length * 2;
      const { brief, runner } = harness(domain, {
        catalog: { chargesBudget: 1 },
        runner: { caps: { catalog_query: cap } },
      });
      const result = await runner.start(brief).result;
      expect(result.queries.every((query) => query.status === 'fetched')).toBe(true);
      expect(result.status).toBe('ready');
    });

    it('still charges an adapter for upstream calls beyond the one the runner paid for', async () => {
      const { brief, runner } = harness(domain, { catalog: { chargesBudget: 2 } });
      const result = await runner.start(brief).result;
      expect(result.usage.catalog_query).toBe(result.queries.length * 2);
    });

    it('does not let an adapter overspend past the cap', async () => {
      const { brief, runner } = harness(domain, {
        catalog: { chargesBudget: 2 },
        runner: { caps: { catalog_query: seedBrief(domain).slots.length } },
      });
      const result = await runner.start(brief).result;
      expect(result.usage.catalog_query).toBeLessThanOrEqual(brief.slots.length);
      expect(result.queries.some((query) => query.status === 'budget_exhausted')).toBe(true);
    });
  });

  it('rejects matcher output with a wrong revision, unknown offer or bad subtotal', async () => {
    const { brief, runner } = harness(domain, { matcher: 'invalid' });
    const result = await runner.start(brief).result;
    expect(result.collection).toBeNull();
    expect(result.warnings).toContain('matcher_output_invalid');
    expect(result.status).toBe('partial');
    expect(result.missing.map((item) => item.kind === 'slot' && item.reason)).toEqual(
      brief.slots.map(() => 'no_eligible_offer'),
    );
    expect(result.candidates.every((c) => c.offerIds.length > 0)).toBe(true);
  });

  it('keeps candidates and names the failure when the matcher throws', async () => {
    const { brief, runner } = harness(domain, { matcher: 'throw' });
    const result = await runner.start(brief).result;
    expect(result.status).toBe('partial');
    expect(result.missing.map((item) => item.kind === 'slot' && item.reason)).toEqual(
      brief.slots.map(() => 'matcher_failed'),
    );
    expect(JSON.stringify(result)).not.toContain('PROVIDER-BODY-SECRET');
  });

  it('fails only when every slot failed and nothing was found', async () => {
    const { brief, runner } = harness(domain, {
      catalog: { failSlots: new Set(seedBrief(domain).slots.map((s) => s.id)) },
    });
    const result = await runner.start(brief).result;
    expect(result.status).toBe('failed');
    expect(result.collection).toBeNull();
    expect(
      result.missing.every((item) => item.kind === 'slot' && item.reason === 'provider_failed'),
    ).toBe(true);
  });

  it('deduplicates seller variants and drops malformed or foreign-origin offers', async () => {
    const base = seedOffers(domain)[0]!;
    const { brief, runner } = harness(domain, {
      catalog: {
        extra: [
          extraOffer(base, 'offer_dup_listing'),
          extraOffer(base, 'offer_live_row', { variantId: 'variant-other', sampleOrigin: 'live' }),
          { id: 'offer_broken' },
        ],
      },
    });
    const result = await runner.start(brief).result;
    expect(result.offers.map((offer) => offer.id)).toEqual(seedOffers(domain).map((o) => o.id));
    expect(result.warnings).toEqual(
      expect.arrayContaining(['invalid_offers_dropped', 'foreign_sample_origin_dropped']),
    );
  });

  it('uses a model explanation only when every line is bounded by the evidence', async () => {
    const withLine = (text: string, evidenceId?: string): CollectionExplainer => ({
      async explain(input) {
        const base = explainCollection(input);
        const cite = evidenceId ?? input.offers[0]!.evidence[0]!.id;
        return {
          ...base,
          summary: [...base.summary, { text, basis: 'model_summary', evidenceIds: [cite] }],
        };
      },
    });
    const good = harness(domain, {
      runner: { explainer: withLine('A coordinated neutral pair from two stores.') },
    });
    const accepted = await good.runner.start(good.brief).result;
    expect(accepted.collection?.explanation.summary.at(-1)?.basis).toBe('model_summary');
    expect(accepted.warnings).not.toContain('explanation_rejected');

    for (const explainer of [
      withLine('Saves 40 compared with buying elsewhere.'),
      withLine('A coordinated pair.', 'ev_not_this_offer'),
      withLine('Free shipping included on both items.'),
    ]) {
      const bad = harness(domain, { runner: { explainer } });
      const result = await bad.runner.start(bad.brief).result;
      expect(result.warnings).toContain('explanation_rejected');
      expect(result.collection?.explanation.summary.some((l) => l.basis === 'model_summary')).toBe(
        false,
      );
    }
  });
});

describe.each(DOMAINS)('%s matcher boundary checks', (domain) => {
  const brief = seedBrief(domain);
  const offers = seedOffers(domain);
  const index = new Map(offers.map((offer) => [offer.id, offer]));
  const valid = async () => (await fakeMatcher().match(brief, offers, {} as never))[0]!;

  it('accepts a well-formed match for the current revision', async () => {
    expect(matchIssues(await valid(), brief, index)).toEqual([]);
  });

  it.each([
    [
      'unknown_offer',
      (m: CollectionMatch) => withSlot(m, 0, { alternativeOfferIds: ['offer_ghost'] }),
    ],
    [
      'duplicate_offer',
      (m: CollectionMatch) =>
        withSlot(m, 0, { alternativeOfferIds: [m.slots[0]!.selectedOfferId!] }),
    ],
    [
      'foreign_evidence',
      (m: CollectionMatch) =>
        withSlot(m, 0, {
          checks: [
            {
              key: 'size',
              status: 'pass',
              evidenceIds: [offers[1]!.evidence[0]!.id],
              explanation: 'x',
            },
          ],
        }),
    ],
    ['revision', (m: CollectionMatch) => ({ ...m, briefRevision: brief.revision + 1 })],
    ['sample_origin', (m: CollectionMatch) => ({ ...m, sampleOrigin: 'live' as const })],
    ['slots', (m: CollectionMatch) => withSlot(m, 0, { required: false })],
    [
      'subtotal',
      (m: CollectionMatch) => ({ ...m, itemSubtotal: { amount: 1, currency: brief.currency } }),
    ],
  ] as const)('rejects %s', async (issue, change) => {
    expect(matchIssues(change(await valid()), brief, index)).toContain(issue);
  });

  it('rejects mixed currencies and a ready collection with an unavailable offer', async () => {
    const usd = new Map(index);
    const first = offers[0]!;
    usd.set(first.id, { ...first, price: { amount: first.price!.amount, currency: 'USD' } });
    expect(matchIssues(await valid(), brief, usd)).toContain('mixed_currency');
    const unavailable = new Map(index);
    unavailable.set(first.id, { ...first, availability: 'unknown' });
    expect(matchIssues(await valid(), brief, unavailable)).toContain('ready_unavailable');
  });
});

function withSlot(
  match: CollectionMatch,
  slotIndex: number,
  changes: Partial<CollectionMatch['slots'][number]>,
): CollectionMatch {
  return {
    ...match,
    slots: match.slots.map((slot, i) => (i === slotIndex ? { ...slot, ...changes } : slot)),
  };
}
