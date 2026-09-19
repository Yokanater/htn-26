import { describe, expect, it } from 'vitest';
import {
  ID_PREFIXES,
  idSchema,
  MoneySchema,
  newId,
  SCHEMA_VERSION,
  SourceTypeSchema,
} from '../src/index';

const ULID_BODY = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('SCHEMA_VERSION', () => {
  it('starts at 1.0.0', () => {
    expect(SCHEMA_VERSION).toBe('1.0.0');
  });
});

describe('newId', () => {
  it('has exactly the ten design §4 prefixes', () => {
    expect(Object.values(ID_PREFIXES).sort()).toEqual(
      ['act_', 'cand_', 'clu_', 'ent_', 'ev_', 'item_', 'prof_', 'run_', 'src_', 'task_'].sort(),
    );
  });

  it.each(Object.values(ID_PREFIXES))('builds %s + a ULID body', (prefix) => {
    const id = newId(prefix);
    expect(id.startsWith(prefix)).toBe(true);
    expect(id.slice(prefix.length)).toMatch(ULID_BODY);
  });

  it('is unique across calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId('ev_')));
    expect(ids.size).toBe(1000);
  });
});

describe('idSchema', () => {
  it('accepts generated and hand-written seed IDs with the right prefix', () => {
    expect(idSchema('ev_').safeParse(newId('ev_')).success).toBe(true);
    expect(idSchema('ev_').safeParse('ev_seed_01').success).toBe(true);
  });

  it('rejects the wrong prefix or an empty body', () => {
    expect(idSchema('ev_').safeParse('src_seed_01').success).toBe(false);
    expect(idSchema('ev_').safeParse('ev_').success).toBe(false);
  });
});

describe('MoneySchema', () => {
  it('accepts integer minor units with an ISO currency', () => {
    expect(MoneySchema.parse({ amount: 2400, currency: 'CAD' })).toEqual({
      amount: 2400,
      currency: 'CAD',
    });
  });

  it.each([
    { amount: 24.5, currency: 'CAD' },
    { amount: 2400, currency: 'cad' },
    { amount: 2400, currency: 'CADX' },
    { amount: '2400', currency: 'CAD' },
    { amount: 2400 },
  ])('rejects %j', (value) => {
    expect(MoneySchema.safeParse(value).success).toBe(false);
  });
});

describe('SourceTypeSchema', () => {
  it('matches design §4.1 exactly', () => {
    expect(SourceTypeSchema.options).toEqual([
      'storefront',
      'shopify_catalog',
      'product_reviews',
      'editorial',
      'forum',
      'video',
      'social',
      'marketplace',
      'search_snippet',
    ]);
  });

  it('rejects unknown values', () => {
    expect(SourceTypeSchema.safeParse('tiktok').success).toBe(false);
  });
});
