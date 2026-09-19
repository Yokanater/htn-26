/**
 * Validates every JSON fixture under fixtures/ against its @sei/contracts schema
 * (design §4 rules; run alone with `pnpm fixtures:check`).
 *
 * HOW LANES REGISTER A SCHEMA (additive, one line per file type, in the same PR as the schema):
 *   Add an entry to SCHEMAS below. Keys are matched in this order:
 *     1. '<parent-dir>/*.json'  e.g. 'sections/*.json' → ReportSectionSchema
 *     2. '<file-name>'          e.g. 'collect.json'    → CollectionBatchSchema
 *   Run-directory file names are fixed by design §10.3 (run.json, raw-signals.json, profile.json,
 *   plan.json, discover.json, collect.json, enrich.json, resolve.json, score.json, verify.json,
 *   report.json, sections/<key>.json, actions/<id>.json, events.jsonl).
 *   `.jsonl` files are validated line by line (e.g. 'events.jsonl' → PipelineEventSchema).
 *
 * Files with no registered schema are reported as SKIPPED (visible in the test output), never
 * failed, so a lane can commit fixtures before its schema lands. fixtures/spikes/** holds raw
 * vendor responses (not our contracts) and is never validated here.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURES_DIR = join(REPO_ROOT, 'fixtures');
const IGNORED_DIRS = new Set(['spikes', 'node_modules']);

/** filename → schema registry (see header). Empty until lanes transcribe design §4 in Step 0. */
const SCHEMAS: Record<string, ZodType> = {
  // L1: 'raw-signals.json': RawStoreSignalsSchema, 'discover.json': DiscoveryResultSchema,
  //     'collect.json': CollectionBatchSchema,
  // L2: 'enrich.json': z.array(EnrichmentSchema), 'resolve.json': ResolveResultSchema,
  //     'score.json': z.array(CandidateScoreSchema),
  // L3: 'profile.json': StoreProfileSchema, 'plan.json': ResearchPlanSchema,
  //     'report.json': ReportSchema, 'sections/*.json': ReportSectionSchema,
  //     'verify.json': z.array(VerificationResultSchema),
  // L4: 'run.json': ReportRunSchema, 'events.jsonl': PipelineEventSchema,
};

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return IGNORED_DIRS.has(entry.name) ? [] : walk(full);
    return /\.jsonl?$/.test(entry.name) ? [full] : [];
  });
}

function schemaFor(file: string): ZodType | undefined {
  const ext = file.endsWith('.jsonl') ? 'jsonl' : 'json';
  return SCHEMAS[`${basename(dirname(file))}/*.${ext}`] ?? SCHEMAS[basename(file)];
}

function parseRecords(file: string): unknown[] {
  const text = readFileSync(file, 'utf8');
  if (!file.endsWith('.jsonl')) return [JSON.parse(text)];
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

const files = walk(FIXTURES_DIR);

describe('fixtures validate against @sei/contracts', () => {
  it('finds the fixtures directory', () => {
    expect(existsSync(FIXTURES_DIR)).toBe(true);
  });

  for (const file of files) {
    const name = relative(REPO_ROOT, file).replaceAll('\\', '/');
    const schema = schemaFor(file);
    if (!schema) {
      it.skip(`${name} (no schema registered in SCHEMAS)`, () => {});
      continue;
    }
    it(name, () => {
      parseRecords(file).forEach((record, index) => {
        const result = schema.safeParse(record);
        const where = file.endsWith('.jsonl') ? `${name}:${index + 1}` : name;
        expect(result.success, `${where}\n${result.error?.message ?? ''}`).toBe(true);
      });
    });
  }
});
