/** S2-L3-1 query planning and evidence-bounded explanations. Offline, synthetic seeds. Owner: L3. */
import { readFileSync } from 'node:fs';
import {
  type CollectionMatch,
  CollectionMatchSchema,
  type IntentBrief,
  IntentBriefSchema,
  type ProductOffer,
  ProductOfferSchema,
  type ShoppingDomain,
} from '@sei/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  boundExplanation,
  type CollectionExplanation,
  checkExplanation,
  explainCollection,
  formatMoney,
  planSlotQueries,
} from '.';

const DOMAINS: ShoppingDomain[] = ['outfit', 'setup'];

function seed(domain: ShoppingDomain, name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../../../fixtures/seed/${domain}/${name}.json`, import.meta.url),
      'utf8',
    ),
  );
}
const brief = (domain: ShoppingDomain): IntentBrief =>
  IntentBriefSchema.parse(seed(domain, 'brief'));
const offers = (domain: ShoppingDomain): ProductOffer[] =>
  z.array(ProductOfferSchema).parse(seed(domain, 'offers'));
const match = (domain: ShoppingDomain): CollectionMatch =>
  z.array(CollectionMatchSchema).parse(seed(domain, 'matches'))[0]!;

describe.each(DOMAINS)('%s query planning', (domain) => {
  it('plans two bounded queries per slot from category and confirmed terms only', () => {
    const base = brief(domain);
    const secret = 'PRIVATE shopper note about my apartment';
    const withNotes: IntentBrief = {
      ...base,
      input: { kind: 'text', text: secret },
      slots: base.slots.map((slot, index) =>
        index === 0
          ? {
              ...slot,
              description: `Oversized chunky ${slot.category} with ribbed texture`,
              visualAttributes: ['cream', 'wool', 'cream '],
            }
          : slot,
      ),
    };
    const plan = planSlotQueries(withNotes);
    const first = plan.queries.filter((query) => query.slotId === base.slots[0]!.id);
    expect(first.map((query) => query.text)).toEqual([
      `${base.slots[0]!.category} cream wool`,
      `${base.slots[0]!.category} oversized chunky with ribbed texture`.replace(' with', ''),
    ]);
    for (const query of plan.queries) {
      expect(query).toMatchObject({ country: base.country, currency: base.currency, limit: 8 });
      expect(query.text.length).toBeLessThanOrEqual(120);
      expect(query.text).not.toMatch(/private|apartment|\bM\b|120/i);
    }
    expect(plan.deferred).toEqual([]);
  });

  it('under a query cap, covers every required slot before any second query', () => {
    const base = brief(domain);
    const optionalFirst: IntentBrief = {
      ...base,
      slots: base.slots.map((slot, index) => ({ ...slot, required: index !== 0 })),
    };
    const plan = planSlotQueries(optionalFirst, 2);
    expect(plan.queries.map((query) => [query.slotId, query.variant])).toEqual([
      [base.slots[1]!.id, 1],
      [base.slots[0]!.id, 1],
    ]);
    expect(plan.deferred.every((query) => query.variant === 2)).toBe(true);
  });
});

describe.each(DOMAINS)('%s explanations', (domain) => {
  it('the template cites only the selected offer evidence and passes validation', () => {
    const input = { brief: brief(domain), match: match(domain), offers: offers(domain) };
    const explanation = explainCollection(input);
    expect(checkExplanation(explanation, input)).toEqual([]);
    expect(explanation.slots.map((slot) => slot.state)).toEqual(['selected', 'selected']);
    const text = explanation.summary.map((line) => line.text).join(' ');
    expect(text).toContain('2 of 2 items selected across 2 store(s)');
    expect(text).toContain(`Known item subtotal ${formatMoney(30_000, 'CAD')}`);
    expect(text).toContain('excludes shipping and tax');
  });

  it('says a price or availability needs verification instead of inventing it', () => {
    const unknownPrice = offers(domain).map((offer, index) =>
      index === 0 ? { ...offer, price: null, availability: 'unknown' as const } : offer,
    );
    const base = match(domain);
    const partial: CollectionMatch = { ...base, status: 'partial', itemSubtotal: null };
    const explanation = explainCollection({
      brief: brief(domain),
      match: partial,
      offers: unknownPrice,
    });
    const lines = explanation.slots[0]!.lines.map((line) => line.text);
    expect(lines.join(' ')).toMatch(/price needs verification/);
    expect(lines).toContain('Availability needs verification.');
    expect(explanation.summary.at(-1)?.text).toMatch(/subtotal unavailable/i);
    expect(checkExplanation(explanation, { match: partial, offers: unknownPrice })).toEqual([]);
  });

  it('rejects foreign evidence, uncited facts, unsupported numbers and forbidden claims', () => {
    const input = { match: match(domain), offers: offers(domain) };
    const base = explainCollection({ brief: brief(domain), ...input });
    const otherEvidence = offers(domain)[1]!.evidence[0]!.id;
    const withSlotLine = (line: CollectionExplanation['slots'][number]['lines'][number]) => ({
      ...base,
      slots: base.slots.map((slot, index) =>
        index === 0 ? { ...slot, lines: [...slot.lines, line] } : slot,
      ),
    });
    const cases: [CollectionExplanation, RegExp][] = [
      [
        withSlotLine({
          text: 'Matches the look.',
          basis: 'model_summary',
          evidenceIds: [otherEvidence],
        }),
        /outside the selected offer/,
      ],
      [
        withSlotLine({ text: 'In stock.', basis: 'product_fact', evidenceIds: [] }),
        /cites no evidence/,
      ],
      [
        withSlotLine({
          text: 'Rated 4.9 by 1200 buyers.',
          basis: 'model_summary',
          evidenceIds: [offers(domain)[0]!.evidence[0]!.id],
        }),
        /unsupported quantity/,
      ],
      [
        withSlotLine({
          text: 'Tax included at checkout.',
          basis: 'computed_summary',
          evidenceIds: [],
        }),
        /shipping\/tax is included/,
      ],
      [
        withSlotLine({ text: 'An exact replica of the photo.', basis: 'missing', evidenceIds: [] }),
        /exact replica/,
      ],
      [{ ...base, matchId: 'match_other' }, /matchId/],
      [{ ...base, slots: base.slots.slice(1) }, /missing explanation/],
    ];
    for (const [explanation, issue] of cases) {
      expect(checkExplanation(explanation, input).join('\n')).toMatch(issue);
    }
  });

  it('bounds the template by dropping a matcher check line that overclaims', () => {
    const base = match(domain);
    const overclaiming: CollectionMatch = {
      ...base,
      slots: base.slots.map((slot, index) =>
        index === 0
          ? {
              ...slot,
              checks: [
                ...slot.checks,
                { key: 'fit', status: 'pass', evidenceIds: [], explanation: 'This will fit you' },
              ],
            }
          : slot,
      ),
    };
    const input = { match: overclaiming, offers: offers(domain) };
    const raw = explainCollection({ brief: brief(domain), ...input });
    expect(checkExplanation(raw, input).join('\n')).toMatch(/unsupported guarantee/);
    const { explanation, dropped } = boundExplanation(raw, input);
    expect(dropped).toBe(1);
    expect(checkExplanation(explanation, input)).toEqual([]);
  });
});

describe('formatMoney', () => {
  it('uses the currency fraction digits and never converts', () => {
    expect(formatMoney(30_000, 'CAD')).toBe('CAD 300.00');
    expect(formatMoney(1_500, 'JPY')).toBe('JPY 1500');
  });
});
