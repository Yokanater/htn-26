/** Required v3 fixtures fail closed on missing files or unknown schema registration. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type ZodType, z } from 'zod';
import {
  CollectionMatchSchema,
  ConsentRecordSchema,
  DemandAggregateSchema,
  DemandEventSchema,
  IntentBriefSchema,
  MerchantOpportunitySchema,
  MerchantResearchSchema,
  ProductOfferSchema,
} from '../src/index';

const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const SCHEMAS: Record<string, ZodType> = {
  'brief.json': IntentBriefSchema,
  'briefs.json': z.array(IntentBriefSchema).min(1),
  'offers.json': z.array(ProductOfferSchema).min(1),
  'matches.json': z.array(CollectionMatchSchema).min(1),
  'consents.json': z.array(ConsentRecordSchema).min(1),
  'demand-events.json': z.array(DemandEventSchema).min(1),
  'aggregate.json': DemandAggregateSchema,
  'opportunity.json': MerchantOpportunitySchema,
  'merchant-research.json': MerchantResearchSchema,
};

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'spikes' ? [] : walk(path);
    return /\.jsonl?$/.test(entry.name) ? [path] : [];
  });
}

describe('v3 fixture coverage', () => {
  it.each(['outfit', 'setup'])('%s has every required fixture', (domain) => {
    for (const name of Object.keys(SCHEMAS)) {
      expect(existsSync(join(FIXTURES_DIR, 'seed', domain, name)), `${domain}/${name}`).toBe(true);
    }
  });
  for (const file of walk(FIXTURES_DIR)) {
    it(relative(FIXTURES_DIR, file), () => {
      const schema = SCHEMAS[basename(file)];
      expect(
        schema,
        'Register every domain fixture schema; raw vendor responses belong in spikes/',
      ).toBeDefined();
      const text = readFileSync(file, 'utf8');
      const records = file.endsWith('.jsonl')
        ? text
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        : [JSON.parse(text)];
      for (const record of records) {
        const result = schema.safeParse(record);
        expect(result.success, result.error?.message).toBe(true);
      }
    });
  }
});
