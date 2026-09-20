import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConsentRecordSchema, DemandEventSchema, IntentBriefSchema } from '@sei/contracts';
import { createDemandAggregator } from '@sei/enrich';
import { expect, it } from 'vitest';
import briefFixture from '../../../fixtures/seed/outfit/brief.json';
import consents from '../../../fixtures/seed/outfit/consents.json';
import events from '../../../fixtures/seed/outfit/demand-events.json';
import setupBrief from '../../../fixtures/seed/setup/brief.json';
import { PrivateDemandLedger } from '../src/services/demand';
import { DemandProjectionService } from '../src/services/demand-projection';
import { IntakeStore } from '../src/services/intake';
import { PrivateDatabase } from '../src/services/persistence';
import { OwnerSessions } from '../src/services/session';

it.each([briefFixture, setupBrief])(
  'publishes confirmed, consented $domain demand after restart and withdraws immediately',
  async (fixture) => {
    const dir = mkdtempSync(join(tmpdir(), 'demand-loop-'));
    const path = join(dir, 'private.sqlite');
    let db = new PrivateDatabase(path);
    try {
      const intake = new IntakeStore(db);
      const ledger = new PrivateDemandLedger(db);
      for (let i = 0; i < 5; i++) {
        const owner = `sess_test_${i}`;
        const brief = IntentBriefSchema.parse({
          ...fixture,
          id: `brief_test_${i}`,
          sampleOrigin: 'live',
        });
        intake.saveBrief(owner, brief, null);
        await ledger.setConsent(
          ConsentRecordSchema.parse({ ...consents[0], sessionId: owner, state: 'granted' }),
          null,
        );
        await ledger.append(
          DemandEventSchema.parse({
            ...events[0],
            id: `evt_test_${i}`,
            sessionId: owner,
            briefId: brief.id,
            sampleOrigin: 'live',
            kind: 'brief_confirmed',
            matchId: null,
            selections: [],
          }),
          `confirmed-${i}`,
        );
      }
      db.db.close();
      db = new PrivateDatabase(path);
      const restored = new PrivateDemandLedger(db);
      const briefs = new IntakeStore(db);
      const projection = new DemandProjectionService({
        ledger: restored,
        briefs: (ids) => briefs.findBriefs(ids),
        aggregator: createDemandAggregator(),
        minimumSessions: 5,
        retentionDays: 30,
        snapshotMinutes: 15,
        now: () => new Date('2026-09-19T13:01:00Z'),
      });
      const summaries = await projection.merchantSummaries();
      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.eligibleSessions?.min).toBe(5);
      expect(JSON.stringify(summaries)).not.toMatch(/sess_test|brief_test|evt_test/);
      await restored.deleteSession('sess_test_0');
      expect(await projection.merchantSummaries()).toEqual([]);
    } finally {
      db.db.close();
      rmSync(dir, { recursive: true });
    }
  },
);

it('restores private intent, consent and idempotency after restart, and erases them durably', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'intent-storage-'));
  const path = join(dir, 'private.sqlite');
  let db = new PrivateDatabase(path);
  try {
    let sessions = new OwnerSessions(db);
    const owner = sessions.create();
    let intake = new IntakeStore(db);
    let ledger = new PrivateDemandLedger(db);
    const brief = IntentBriefSchema.parse(briefFixture);
    intake.saveBrief(owner, brief, null);
    const consent = ConsentRecordSchema.parse({ ...consents[0], sessionId: owner });
    await ledger.setConsent(consent, null);
    const event = DemandEventSchema.parse({ ...events[0], sessionId: owner });
    await ledger.append(event, 'retry-key');
    db.db.close();
    db = new PrivateDatabase(path);
    sessions = new OwnerSessions(db);
    intake = new IntakeStore(db);
    ledger = new PrivateDemandLedger(db);
    expect(sessions.valid(owner)).toBe(true);
    expect(intake.getBrief(owner, brief.id)).toEqual(brief);
    expect(intake.getBrief('someone-else', brief.id)).toBeNull();
    expect(await ledger.getConsent(owner)).toEqual(consent);
    expect(await ledger.append(event, 'retry-key')).toBe('duplicate');
    sessions.revoke(owner);
    intake.deleteOwner(owner);
    await ledger.deleteSession(owner);
    db.db.close();
    db = new PrivateDatabase(path);
    expect(new OwnerSessions(db).valid(owner)).toBe(false);
    expect(new IntakeStore(db).findBriefs([brief.id])).toEqual([]);
    expect(await new PrivateDemandLedger(db).getConsent(owner)).toBeNull();
  } finally {
    db.db.close();
    rmSync(dir, { recursive: true });
  }
});
