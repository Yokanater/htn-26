/** S2-L2-1 constrained collection engine. Both domains, offline seed fixtures only. */
import { readFileSync } from 'node:fs';
import {
  type CollectionMatch,
  CollectionMatchSchema,
  type IntentBrief,
  IntentBriefSchema,
  type ProductOffer,
  ProductOfferSchema,
  type SampleOrigin,
  type ShoppingDomain,
} from '@sei/contracts';
import type { ShoppingContext } from '@sei/core';
import { describe, expect, it } from 'vitest';
import {
  createCollectionMatcher,
  evaluateOffer,
  MATCHING_LIMITS,
  type MatchOptions,
  matchCollections,
  normalizeOfferAttributes,
  type SlotCandidates,
} from '../src/index';

const DOMAINS: readonly ShoppingDomain[] = ['outfit', 'setup'];

it('prefers the described blue button-up over a red shirt with more complete shipping data', () => {
  const target = brief('outfit', (value) => {
    value.slots = [value.slots[0]!];
    value.slots[0]!.description = 'Mens pale blue plain long sleeve button up shirt';
    value.slots[0]!.visualAttributes = ['pale blue', 'plain'];
  });
  const blue = offer('outfit', 0, 'blue', (value) => {
    value.title = 'Mens Pale Blue Plain Long Sleeve Button Up Shirt';
    value.shipsTo = null;
  });
  const red = offer('outfit', 0, 'red', (value) => {
    value.title = 'Mens Red Shirt';
    value.shipsTo = ['CA'];
  });
  const results = matchCollections(
    target,
    { [target.slots[0]!.id]: [red, blue] },
    { sampleOrigin: 'seed' },
  );
  expect(results[0]?.slots[0]?.selectedOfferId).toBe(blue.id);
  expect(results[0]?.slots[0]?.checks.some((check) => check.status === 'unknown')).toBe(true);
});

/** Seed slot 0 is constrained (outfit size M / setup width <= 120 cm); slot 1 is not. */
const CONSTRAINED = {
  outfit: { key: 'size', violating: { size: 'L' } },
  setup: { key: 'dimension:width', violating: { width_cm: 130 } },
} as const;

function readSeed(domain: ShoppingDomain, name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../../fixtures/seed/${domain}/${name}.json`, import.meta.url), 'utf8'),
  );
}

function seed(domain: ShoppingDomain) {
  return {
    briefs: IntentBriefSchema.array().parse(readSeed(domain, 'briefs')),
    offers: ProductOfferSchema.array().parse(readSeed(domain, 'offers')),
    matches: CollectionMatchSchema.array().parse(readSeed(domain, 'matches')),
  };
}

function brief(domain: ShoppingDomain, edit?: (brief: IntentBrief) => void): IntentBrief {
  const draft = structuredClone(seed(domain).briefs[0]);
  edit?.(draft);
  return IntentBriefSchema.parse(draft);
}

/** A distinct variant cloned from the seed offer for slot 0 or 1. */
function offer(
  domain: ShoppingDomain,
  slotIndex: 0 | 1,
  suffix: string,
  edit?: (offer: ProductOffer) => void,
): ProductOffer {
  const draft = structuredClone(seed(domain).offers[slotIndex]);
  draft.id = `offer_${domain}_${suffix}`;
  draft.variantId = `variant-${suffix}`;
  draft.evidence = draft.evidence.map((item, index) => ({
    ...item,
    id: `ev_${domain}_${suffix}_${index}`,
  }));
  edit?.(draft);
  return ProductOfferSchema.parse(draft);
}

function slots(
  target: IntentBrief,
  first: readonly ProductOffer[],
  second: readonly ProductOffer[],
): SlotCandidates {
  return { [target.slots[0].id]: first, [target.slots[1].id]: second };
}

function run(
  target: IntentBrief,
  candidates: SlotCandidates,
  options: Partial<MatchOptions> = {},
): CollectionMatch[] {
  const results = matchCollections(target, candidates, { sampleOrigin: 'seed', ...options });
  for (const result of results) CollectionMatchSchema.parse(result);
  return results;
}

function context(sampleOrigin: SampleOrigin, signal = new AbortController().signal) {
  return { signal, sampleOrigin, consume() {} } satisfies ShoppingContext;
}

const selectedIds = (match: CollectionMatch) => match.slots.map((slot) => slot.selectedOfferId);
const checkStatus = (match: CollectionMatch, slotIndex: number, key: string) =>
  match.slots[slotIndex].checks.find((check) => check.key === key)?.status;

describe.each(DOMAINS)('%s collection matching', (domain) => {
  const { key, violating } = CONSTRAINED[domain];
  const id = (suffix: string) => `offer_${domain}_${suffix}`;

  it('reproduces the committed seed match for every seed brief', () => {
    const { briefs, offers, matches } = seed(domain);
    for (const seedBrief of briefs) {
      const expected = matches.find((match) => match.briefId === seedBrief.id);
      expect(expected, seedBrief.id).toBeDefined();
      const results = run(seedBrief, slots(seedBrief, [offers[0]], [offers[1]]), {
        newMatchId: () => expected?.id ?? 'match_missing',
      });
      expect(results).toEqual([expected]);
    }
  });

  it('excludes an offer that violates a hard constraint and says which check failed', () => {
    const target = brief(domain);
    const bad = offer(domain, 0, 'bad', (o) => {
      o.attributes = { ...violating };
    });
    const [match] = run(target, slots(target, [bad], [offer(domain, 1, 'ok')]));
    expect(match.status).toBe('partial');
    expect(match.slots[0].selectedOfferId).toBeNull();
    expect(match.slots[0].alternativeOfferIds).toEqual([]);
    expect(match.warnings.join('\n')).toContain(key);
  });

  it('keeps an unverified hard constraint visible and never calls it ready', () => {
    const target = brief(domain);
    const unverified = offer(domain, 0, 'unknown', (o) => {
      o.attributes = {};
    });
    const [match] = run(target, slots(target, [unverified], [offer(domain, 1, 'ok')]));
    expect(match.slots[0].selectedOfferId).toBe(unverified.id);
    expect(checkStatus(match, 0, key)).toBe('unknown');
    expect(match.status).toBe('partial');
  });

  it('prefers a verified offer over an unverified one', () => {
    const target = brief(domain);
    const unverified = offer(domain, 0, 'a', (o) => {
      o.attributes = {};
    });
    const verified = offer(domain, 0, 'b');
    const [match] = run(target, slots(target, [unverified, verified], [offer(domain, 1, 'ok')]));
    expect(match.slots[0].selectedOfferId).toBe(verified.id);
    expect(match.slots[0].alternativeOfferIds).toEqual([unverified.id]);
    expect(match.status).toBe('ready');
  });

  it('excludes other-currency offers instead of converting them', () => {
    const target = brief(domain);
    const usd = offer(domain, 0, 'usd', (o) => {
      o.price = { amount: 1000, currency: 'USD' };
    });
    const [match] = run(target, slots(target, [usd], [offer(domain, 1, 'ok')]));
    expect(match.slots[0].selectedOfferId).toBeNull();
    expect(match.itemSubtotal).toEqual({ amount: 20000, currency: 'CAD' });
    expect(match.warnings.join('\n')).toContain('price');
  });

  it('treats a missing price as unknown, never as zero', () => {
    const target = brief(domain);
    const unpriced = offer(domain, 0, 'unpriced', (o) => {
      o.price = null;
    });
    const [match] = run(target, slots(target, [unpriced], [offer(domain, 1, 'ok')]));
    expect(match.slots[0].selectedOfferId).toBe(unpriced.id);
    expect(checkStatus(match, 0, 'price')).toBe('unknown');
    expect(match.itemSubtotal).toBeNull();
    expect(match.status).toBe('partial');
  });

  it('excludes unavailable or non-shipping offers and flags unverified ones', () => {
    const target = brief(domain);
    const unavailable = offer(domain, 0, 'gone', (o) => {
      o.availability = 'unavailable';
    });
    const elsewhere = offer(domain, 0, 'us', (o) => {
      o.shipsTo = ['US'];
    });
    const unverified = offer(domain, 0, 'maybe', (o) => {
      o.availability = 'unknown';
      o.shipsTo = null;
    });
    const [match] = run(
      target,
      slots(target, [unavailable, elsewhere, unverified], [offer(domain, 1, 'ok')]),
    );
    expect(match.slots[0].selectedOfferId).toBe(unverified.id);
    expect(match.slots[0].alternativeOfferIds).toEqual([]);
    expect([checkStatus(match, 0, 'availability'), checkStatus(match, 0, 'ships_to')]).toEqual([
      'unknown',
      'unknown',
    ]);
    expect(match.status).toBe('partial');
  });

  it('returns an explicit missing slot, or no_match when nothing is eligible', () => {
    const target = brief(domain);
    const [partial] = run(target, slots(target, [], [offer(domain, 1, 'ok')]));
    expect(partial.status).toBe('partial');
    expect(selectedIds(partial)).toEqual([null, id('ok')]);
    expect(partial.warnings.join('\n')).toContain(target.slots[0].category);

    const [none] = run(target, {});
    expect(none.status).toBe('no_match');
    expect(none.itemSubtotal).toBeNull();
    expect(selectedIds(none)).toEqual([null, null]);
  });

  it('reports an impossible budget instead of dropping required items', () => {
    const target = brief(domain, (b) => {
      b.itemBudget = { amount: 100, currency: 'CAD' };
    });
    const [match] = run(target, slots(target, [offer(domain, 0, 'a')], [offer(domain, 1, 'b')]));
    expect(match.status).toBe('partial');
    expect(selectedIds(match)).toEqual([id('a'), id('b')]);
    expect(match.itemSubtotal).toEqual({ amount: 30000, currency: 'CAD' });
    expect(match.warnings.join('\n')).toMatch(/budget/i);
  });

  it('chooses a combination within budget before a more relevant one', () => {
    const target = brief(domain);
    const relevantButPricey = offer(domain, 0, 'a', (o) => {
      o.title = `${o.title} neutral`;
      o.price = { amount: 25000, currency: 'CAD' };
    });
    const affordable = offer(domain, 0, 'b', (o) => {
      o.price = { amount: 5000, currency: 'CAD' };
    });
    const results = run(
      target,
      slots(target, [relevantButPricey, affordable], [offer(domain, 1, 'ok')]),
    );
    const [match] = results;
    // An over-budget combination is not offered as an extra collection beside one that fits.
    expect(results.map((r) => r.status)).toEqual(['ready']);
    expect(match.slots[0].selectedOfferId).toBe(affordable.id);
    expect(match.slots[0].alternativeOfferIds).toContain(relevantButPricey.id);
    expect(match.itemSubtotal).toEqual({ amount: 25000, currency: 'CAD' });
  });

  it('deduplicates one seller variant but keeps other sellers of the same product', () => {
    const target = brief(domain);
    const original = offer(domain, 0, 'a');
    const duplicate = offer(domain, 0, 'b', (o) => {
      o.variantId = original.variantId;
    });
    const otherSeller = offer(domain, 0, 'c', (o) => {
      o.variantId = original.variantId;
      o.merchant = { id: `mer_${domain}_other`, name: 'Other seller', domain: 'other.example' };
    });
    const results = run(
      target,
      slots(target, [duplicate, original, otherSeller], [offer(domain, 1, 'ok')]),
    );
    const [match] = results;
    expect([match.slots[0].selectedOfferId, ...match.slots[0].alternativeOfferIds]).toEqual([
      original.id,
      otherSeller.id,
    ]);
    // A duplicate listing must not reappear as a separate "alternative collection" either.
    expect(results.map((r) => r.slots[0].selectedOfferId)).toEqual([original.id, otherSeller.id]);
  });

  it('does not add a merchant when one store can cover the collection', () => {
    const target = brief(domain);
    const first = offer(domain, 0, 'first');
    const otherStore = offer(domain, 1, 'a');
    const sameStore = offer(domain, 1, 'z', (o) => {
      o.merchant = structuredClone(first.merchant);
    });
    const [match] = run(target, slots(target, [first], [otherStore, sameStore]));
    expect(match.slots[1].selectedOfferId).toBe(sameStore.id);
  });

  it('is deterministic: input order never changes the result', () => {
    const target = brief(domain);
    const firstSlot = ['d', 'a', 'c', 'b'].map((s) => offer(domain, 0, s));
    const secondSlot = ['y', 'x'].map((s) => offer(domain, 1, s));
    const options = { newMatchId: () => 'match_fixed' };
    const forward = run(target, slots(target, firstSlot, secondSlot), options);
    const reversed = run(
      target,
      slots(target, [...firstSlot].reverse(), [...secondSlot].reverse()),
      options,
    );
    expect(reversed).toEqual(forward);
    expect(selectedIds(forward[0])).toEqual([id('a'), id('x')]);
  });

  it('never uses one offer for two slots', () => {
    const target = brief(domain, (b) => {
      b.slots[1].category = b.slots[0].category;
    });
    const only = offer(domain, 0, 'only');
    const [match] = run(target, slots(target, [only], [only]));
    expect(selectedIds(match).filter((selected) => selected === only.id)).toHaveLength(1);
  });

  it('excludes offers from another provenance and labels results with the run origin', () => {
    const target = brief(domain);
    const live = offer(domain, 0, 'live', (o) => {
      o.sampleOrigin = 'live';
    });
    const [seedRun] = run(target, slots(target, [live], [offer(domain, 1, 'ok')]));
    expect(seedRun.slots[0].selectedOfferId).toBeNull();
    expect(seedRun.sampleOrigin).toBe('seed');

    const replayed = [0, 1].map((index) =>
      offer(domain, index as 0 | 1, `replay${index}`, (o) => {
        o.sampleOrigin = 'replay';
      }),
    );
    const [replayRun] = run(target, slots(target, [replayed[0]], [replayed[1]]), {
      sampleOrigin: 'replay',
    });
    expect(replayRun.sampleOrigin).toBe('replay');
    expect(selectedIds(replayRun)).toEqual(replayed.map((o) => o.id));
    expect(replayRun.warnings.join('\n')).toMatch(/replay/i);
  });

  it('returns up to three distinct collections, best first, without padded subsets', () => {
    const target = brief(domain);
    const results = run(
      target,
      slots(
        target,
        ['a', 'b', 'c', 'd'].map((s) => offer(domain, 0, s)),
        ['x', 'y'].map((s) => offer(domain, 1, s)),
      ),
    );
    expect(results).toHaveLength(MATCHING_LIMITS.maxCollections);
    expect(selectedIds(results[0])).toEqual([id('a'), id('x')]);
    expect(results.every((r) => r.slots.every((s) => s.selectedOfferId !== null))).toBe(true);
    expect(new Set(results.map((r) => selectedIds(r).join('|'))).size).toBe(results.length);
    expect(new Set(results.map((r) => r.id)).size).toBe(results.length);
  });

  it('lists only eligible alternatives, in rank order, within the candidate cap', () => {
    const target = brief(domain);
    const many = Array.from({ length: 10 }, (_, i) => offer(domain, 0, `c${i}`));
    const bad = offer(domain, 0, 'bad', (o) => {
      o.attributes = { ...violating };
    });
    const [match] = run(target, slots(target, [bad, ...many], [offer(domain, 1, 'ok')]));
    expect(match.slots[0].selectedOfferId).toBe(many[0].id);
    expect(match.slots[0].alternativeOfferIds).toEqual(
      many.slice(1, MATCHING_LIMITS.candidatesPerSlot).map((o) => o.id),
    );
  });

  it('leaves an optional slot empty without blocking a ready collection', () => {
    const target = brief(domain, (b) => {
      b.slots[1].required = false;
    });
    const [match] = run(target, slots(target, [offer(domain, 0, 'a')], []));
    expect(match.status).toBe('ready');
    expect(match.slots[1]).toMatchObject({ selectedOfferId: null, required: false, checks: [] });
    expect(match.itemSubtotal).toEqual({ amount: 10000, currency: 'CAD' });
  });
});

describe('matching guards and catalog adapter', () => {
  it('refuses to match an unconfirmed brief', () => {
    const draft = brief('outfit', (b) => {
      b.status = 'draft';
    });
    expect(() => run(draft, {})).toThrow(/confirmed/);
  });

  it('labels results with the brief revision it matched', () => {
    const revised = brief('setup', (b) => {
      b.revision = 3;
    });
    const [match] = run(revised, {});
    expect(match).toMatchObject({ briefId: revised.id, briefRevision: 3 });
  });

  it('uses an injected normalizer in place of the deterministic fallback', () => {
    const target = brief('outfit');
    const unlabeled = offer('outfit', 0, 'model', (o) => {
      o.attributes = { note: 'fits like a medium' };
    });
    const [match] = run(target, slots(target, [unlabeled], [offer('outfit', 1, 'ok')]), {
      normalize: (o) => ({
        ...normalizeOfferAttributes(o),
        size: o.id === unlabeled.id ? 'M' : null,
      }),
    });
    expect(checkStatus(match, 0, 'size')).toBe('pass');
  });

  it.each(DOMAINS)('%s: assigns flat catalog offers to slots by category', async (domain) => {
    const matcher = createCollectionMatcher({ newMatchId: () => 'match_adapter' });
    const target = brief(domain);
    const unrelated = offer(domain, 0, 'unrelated', (o) => {
      o.category = 'unrelated';
    });
    const [match] = await matcher.match(
      target,
      [unrelated, ...seed(domain).offers],
      context('seed'),
    );
    expect(selectedIds(match)).toEqual(seed(domain).offers.map((o) => o.id));
  });

  it('rejects a cancelled run', async () => {
    const controller = new AbortController();
    controller.abort();
    const matcher = createCollectionMatcher();
    await expect(
      matcher.match(brief('outfit'), seed('outfit').offers, context('seed', controller.signal)),
    ).rejects.toThrow();
  });
});

describe('deterministic attribute normalization', () => {
  function status(
    domain: ShoppingDomain,
    attributes: ProductOffer['attributes'],
    key: string,
    editBrief?: (brief: IntentBrief) => void,
  ) {
    const target = brief(domain, editBrief);
    const candidate = offer(domain, 0, 'n', (o) => {
      o.attributes = attributes;
    });
    return evaluateOffer(target, target.slots[0], candidate).find((check) => check.key === key)
      ?.status;
  }

  it.each([
    [{ size: 'Medium' }, 'pass'],
    [{ Size: 'm' }, 'pass'],
    [{ size: 'L' }, 'fail'],
    [{ size: 'US 8' }, 'unknown'],
    [{}, 'unknown'],
  ] as const)('outfit size M against %j is %s', (attributes, expected) => {
    expect(status('outfit', attributes, 'size')).toBe(expected);
  });

  it.each([
    [{ width_cm: 100 }, 'pass'],
    [{ width: '47 in' }, 'pass'],
    [{ width: '1300 mm' }, 'fail'],
    [{ width: 120 }, 'unknown'],
    [{ dimensions: '100 x 60 x 75 cm' }, 'unknown'],
  ] as const)('setup width <= 120 cm against %j is %s', (attributes, expected) => {
    expect(status('setup', attributes, 'dimension:width')).toBe(expected);
  });

  it.each([
    ['no_drilling', { mounting: 'Wall-mounted' }, 'fail'],
    ['no_drilling', { mounting: 'Clamp mount' }, 'pass'],
    ['no_drilling', { mounting: 'Freestanding or wall mount' }, 'pass'],
    ['freestanding', { mounting: 'clamp' }, 'unknown'],
    ['no_drilling', {}, 'unknown'],
    // "Plug-in" describes power, not placement: it must not outrank an explicit drilling need.
    ['no_drilling', { mounting: 'Plug-in wall-mounted, requires drilling' }, 'fail'],
    ['freestanding', { mounting: 'Plug-in wall-mounted, requires drilling' }, 'fail'],
    ['no_drilling', { mounting: 'Plug-in' }, 'unknown'],
    ['freestanding', { mounting: 'Plug-in' }, 'unknown'],
  ] as const)('setup mounting %s against %j is %s', (value, attributes, expected) => {
    expect(
      status('setup', attributes, 'mounting', (b) => {
        b.slots[0].constraints = [{ kind: 'mounting', value }];
      }),
    ).toBe(expected);
  });

  it.each(DOMAINS)('%s: excluded materials use listed product materials only', (domain) => {
    const excludeLeather = (b: IntentBrief) => {
      b.slots[0].constraints = [{ kind: 'exclude_material', value: 'Leather' }];
    };
    const key = 'exclude_material:leather';
    expect(status(domain, { material: '100% cotton' }, key, excludeLeather)).toBe('pass');
    expect(status(domain, { material: 'Oak, genuine leather trim' }, key, excludeLeather)).toBe(
      'fail',
    );
    expect(status(domain, { material: 'Faux leather' }, key, excludeLeather)).toBe('unknown');
    expect(status(domain, {}, key, excludeLeather)).toBe('unknown');
  });

  it('cites field evidence for decided checks and none for unverified ones', () => {
    const target = brief('outfit');
    const candidate = offer('outfit', 0, 'ev', (o) => {
      o.attributes = {};
      o.evidence = [
        { ...o.evidence[0], id: 'ev_outfit_price', field: 'price' },
        { ...o.evidence[0], id: 'ev_outfit_record', field: 'product_record' },
      ];
    });
    const checks = evaluateOffer(target, target.slots[0], candidate);
    expect(checks.map((check) => check.key)).toEqual(['price', 'availability', 'ships_to', 'size']);
    expect(checks[0].evidenceIds).toEqual(['ev_outfit_price']);
    expect(checks[1].evidenceIds).toEqual(['ev_outfit_record']);
    expect(checks[3]).toMatchObject({ status: 'unknown', evidenceIds: [] });
  });
});
