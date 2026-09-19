/** Offline fakes for collection-run tests. Owner: L3 (S2-L3-1). No provider calls. */
import { readFileSync } from 'node:fs';
import {
  type CollectionMatch,
  type ConstraintCheck,
  type IntentBrief,
  IntentBriefSchema,
  type ProductOffer,
  ProductOfferSchema,
  type ShoppingDomain,
  type SlotMatch,
} from '@sei/contracts';
import type { CollectionMatcher, ProductQuery, ShoppingContext } from '@sei/core';
import { z } from 'zod';
import type { CatalogSession, OpenCatalog } from '../src';

export const DOMAINS: ShoppingDomain[] = ['outfit', 'setup'];

function seed(domain: ShoppingDomain, name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../../fixtures/seed/${domain}/${name}.json`, import.meta.url), 'utf8'),
  );
}

/** Synthetic seed brief (already confirmed) and its offers. */
export function seedBrief(domain: ShoppingDomain): IntentBrief {
  return IntentBriefSchema.parse(seed(domain, 'brief'));
}
export function seedOffers(domain: ShoppingDomain): ProductOffer[] {
  return z.array(ProductOfferSchema).parse(seed(domain, 'offers'));
}

/** Extra synthetic offer for a slot, e.g. an alternative or a duplicate listing. */
export function extraOffer(base: ProductOffer, id: string, changes: Partial<ProductOffer> = {}) {
  return ProductOfferSchema.parse({
    ...structuredClone(base),
    id,
    evidence: base.evidence.map((ev) => ({ ...ev, id: `ev_${id.slice('offer_'.length)}` })),
    ...changes,
  });
}

export const PROVIDER_SECRET = 'PROVIDER-BODY-SECRET upstream said no';

export interface FakeCatalogOptions {
  offers: ProductOffer[];
  /** Slot IDs whose searches throw a provider error carrying PROVIDER_SECRET. */
  failSlots?: ReadonlySet<string>;
  /** Searches wait for the signal (or forever when `ignoreSignal`). */
  hang?: (query: ProductQuery) => boolean;
  ignoreSignal?: boolean;
  delayMs?: number;
  openDelayMs?: number;
  /** Extra items appended to every response (e.g. malformed or foreign-origin offers). */
  extra?: unknown[];
  /** Like L1's injected catalog, charge this many `catalog_query` units on every search. */
  chargesBudget?: number;
}

export interface CatalogStats {
  opened: number;
  closed: number;
  searches: ProductQuery[];
  settled: number;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Filters offers by the query's first term (the planner puts the category first). */
export function fakeCatalog(options: FakeCatalogOptions): {
  open: OpenCatalog;
  stats: CatalogStats;
} {
  const stats: CatalogStats = { opened: 0, closed: 0, searches: [], settled: 0 };
  const search = async (query: ProductQuery, context: ShoppingContext): Promise<ProductOffer[]> => {
    stats.searches.push(query);
    try {
      if (options.chargesBudget) context.consume('catalog_query', options.chargesBudget);
      if (options.hang?.(query)) {
        await new Promise<never>((_, reject) => {
          if (!options.ignoreSignal) {
            context.signal.addEventListener('abort', () => reject(context.signal.reason), {
              once: true,
            });
          }
        });
      }
      if (options.delayMs) await wait(options.delayMs);
      if (options.failSlots?.has(query.slotId)) throw new Error(PROVIDER_SECRET);
      const category = query.text.split(' ')[0];
      return [
        ...structuredClone(options.offers.filter((offer) => offer.category === category)),
        ...((options.extra ?? []) as ProductOffer[]),
      ];
    } finally {
      stats.settled += 1;
    }
  };
  const open: OpenCatalog = async () => {
    if (options.openDelayMs) await wait(options.openDelayMs);
    stats.opened += 1;
    const session: CatalogSession = {
      search,
      close: async () => {
        stats.closed += 1;
      },
    };
    return session;
  };
  return { open, stats };
}

function checkFor(
  constraint: IntentBrief['slots'][number]['constraints'][number],
  offer: ProductOffer,
): ConstraintCheck {
  const evidenceIds = [offer.evidence[0]!.id];
  if (constraint.kind === 'size') {
    const size = offer.attributes.size;
    return size === undefined
      ? { key: 'size', status: 'unknown', evidenceIds: [], explanation: 'Size not listed' }
      : {
          key: 'size',
          status: String(size) === constraint.value ? 'pass' : 'fail',
          evidenceIds,
          explanation: `Listed size ${size}`,
        };
  }
  if (constraint.kind === 'dimension') {
    const key = `dimension:${constraint.axis}`;
    const value = offer.attributes[`${constraint.axis}_cm`];
    return typeof value === 'number'
      ? {
          key,
          status: value <= constraint.maxCm ? 'pass' : 'fail',
          evidenceIds,
          explanation: `Listed ${constraint.axis} ${value} cm`,
        }
      : { key, status: 'unknown', evidenceIds: [], explanation: 'Dimension not listed' };
  }
  return {
    key: constraint.kind,
    status: 'unknown',
    evidenceIds: [],
    explanation: 'Not evaluated by the fake matcher',
  };
}

export type FakeMatcherMode = 'greedy' | 'throw' | 'hang' | 'invalid';

/** Greedy stand-in for the L2 engine: per slot, the first same-category, same-currency, available
 * offer that fits the remaining item budget and fails no hard check. */
export function fakeMatcher(mode: FakeMatcherMode = 'greedy'): CollectionMatcher & {
  calls: { revision: number; offerIds: string[] }[];
} {
  const calls: { revision: number; offerIds: string[] }[] = [];
  return {
    calls,
    async match(brief, offers, context) {
      calls.push({ revision: brief.revision, offerIds: offers.map((offer) => offer.id) });
      if (mode === 'throw') throw new Error(PROVIDER_SECRET);
      if (mode === 'hang') {
        await new Promise<never>((_, reject) =>
          context.signal.addEventListener('abort', () => reject(context.signal.reason), {
            once: true,
          }),
        );
      }
      let subtotal = 0;
      const slots: SlotMatch[] = brief.slots.map((slot) => {
        const eligible = offers
          .filter(
            (offer) =>
              offer.category === slot.category &&
              offer.availability === 'available' &&
              offer.price?.currency === brief.currency,
          )
          .sort((a, b) => a.id.localeCompare(b.id));
        const fits = eligible.filter((offer) => {
          const checks = slot.constraints.map((constraint) => checkFor(constraint, offer));
          const price = offer.price?.amount ?? 0;
          return (
            checks.every((check) => check.status !== 'fail') &&
            (!brief.itemBudget || subtotal + price <= brief.itemBudget.amount)
          );
        });
        const selected = fits[0] ?? null;
        if (selected?.price) subtotal += selected.price.amount;
        return {
          slotId: slot.id,
          selectedOfferId: selected?.id ?? null,
          alternativeOfferIds: fits.slice(1, 9).map((offer) => offer.id),
          required: slot.required,
          checks: selected
            ? [
                {
                  key: 'availability',
                  status: 'pass',
                  evidenceIds: [selected.evidence[0]!.id],
                  explanation: 'Listed as available',
                },
                ...slot.constraints.map((constraint) => checkFor(constraint, selected)),
              ]
            : [],
        };
      });
      const selectedCount = slots.filter((slot) => slot.selectedOfferId).length;
      const ready =
        slots.every((slot) => !slot.required || slot.selectedOfferId) &&
        slots.every((slot) => slot.checks.every((check) => check.status === 'pass'));
      const match: CollectionMatch = {
        id: `match_${brief.id}_r${brief.revision}`,
        briefId: brief.id,
        briefRevision: brief.revision,
        status: selectedCount === 0 ? 'no_match' : ready ? 'ready' : 'partial',
        slots,
        itemSubtotal: selectedCount ? { amount: subtotal, currency: brief.currency } : null,
        excludesShippingAndTax: true,
        warnings: [],
        sampleOrigin: brief.sampleOrigin,
      };
      if (mode === 'invalid') {
        return [
          { ...match, briefRevision: brief.revision + 1 },
          { ...match, itemSubtotal: { amount: subtotal + 1, currency: brief.currency } },
          {
            ...match,
            slots: match.slots.map((slot, index) =>
              index === 0 ? { ...slot, selectedOfferId: 'offer_not_discovered' } : slot,
            ),
          },
        ];
      }
      return [match];
    },
  };
}

/** Confirmed copy of a brief at a new revision with changes (e.g. a new item budget). */
export function revise(brief: IntentBrief, changes: Partial<IntentBrief>): IntentBrief {
  return IntentBriefSchema.parse({
    ...structuredClone(brief),
    ...changes,
    revision: brief.revision + 1,
  });
}
