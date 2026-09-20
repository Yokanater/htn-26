import { describe, expect, it } from 'vitest';
import { featureFlags, MILESTONE_PRESETS, resolveMilestones } from '../src/index';

describe('resolveMilestones', () => {
  it('m1 → collaborators only, no flags', () => {
    expect(resolveMilestones('m1')).toEqual({
      milestones: ['m1'],
      sections: ['collaborators'],
      flags: [],
    });
  });

  it('defaults to s1 when missing or blank', () => {
    expect(resolveMilestones()).toEqual(resolveMilestones('s1'));
    expect(resolveMilestones(undefined)).toEqual(resolveMilestones('s1'));
    expect(resolveMilestones('  ')).toEqual(resolveMilestones('s1'));
  });

  it('m1,m2,m4 → union of sections and flags', () => {
    expect(resolveMilestones('m1,m2,m4')).toEqual({
      milestones: ['m1', 'm2', 'm4'],
      sections: ['collaborators', 'competitors', 'discourse', 'swot', 'actions'],
      flags: ['FEATURE_FULL_REPORT', 'FEATURE_ACTIONS', 'FEATURE_BUNDLE_STUDIO'],
    });
  });

  it('ignores order, case, whitespace, and duplicates', () => {
    expect(resolveMilestones(' M4 ,m1,, m2,m1 ')).toEqual(resolveMilestones('m1,m2,m4'));
  });

  it('throws when a required milestone is missing', () => {
    expect(() => resolveMilestones('m5')).toThrow(/m5 requires m4/);
    expect(() => resolveMilestones('m1,m5')).toThrow(/m5 requires m4/);
    expect(() => resolveMilestones('m4,m5')).toThrow(/m4 requires m1/);
    expect(() => resolveMilestones('m2')).toThrow(/m2 requires m1/);
  });

  it('throws on an unknown milestone', () => {
    expect(() => resolveMilestones('m1,m9')).toThrow(/unknown milestone\(s\) m9/);
  });

  it.each(['m1', 'm1,m4', 'm1,m2', 'm1,m2,m3', 'm1,m2,m3,m4', 'm1,m2,m3,m4,m5'])(
    'accepts the shippable combination %s (README §1)',
    (value) => {
      expect(() => resolveMilestones(value)).not.toThrow();
    },
  );

  it('every preset requirement names a real milestone', () => {
    for (const preset of Object.values(MILESTONE_PRESETS)) {
      for (const req of preset.requires) expect(MILESTONE_PRESETS).toHaveProperty(req);
    }
  });
});

describe('featureFlags', () => {
  it('lists every preset flag, all off for m1', () => {
    expect(featureFlags({ MILESTONES: 'm1' })).toEqual({
      FEATURE_FULL_REPORT: false,
      FEATURE_MAP: false,
      FEATURE_MISSION_CONTROL: false,
      FEATURE_PARTNER_VIEW: false,
      FEATURE_ACTIONS: false,
      FEATURE_BUNDLE_STUDIO: false,
      FEATURE_SHOPIFY_WRITEBACK: false,
      FEATURE_DRAFT_ACTIVATION: false,
    });
  });

  it('defaults to s1 when MILESTONES is unset', () => {
    expect(featureFlags({})).toEqual(featureFlags({ MILESTONES: 's1' }));
  });

  it('turns on the flags of enabled milestones', () => {
    const flags = featureFlags({ MILESTONES: 'm1,m2,m4' });
    expect(flags.FEATURE_FULL_REPORT).toBe(true);
    expect(flags.FEATURE_ACTIONS).toBe(true);
    expect(flags.FEATURE_BUNDLE_STUDIO).toBe(true);
    expect(flags.FEATURE_MAP).toBe(false);
  });

  it('explicit FEATURE_*=false overrides the preset', () => {
    const flags = featureFlags({ MILESTONES: 'm1,m2', FEATURE_FULL_REPORT: 'false' });
    expect(flags.FEATURE_FULL_REPORT).toBe(false);
  });

  it('explicit FEATURE_*=true overrides the preset and enables slot flags', () => {
    const flags = featureFlags({ MILESTONES: 'm1', FEATURE_MAP: 'TRUE', FEATURE_ASK: '1' });
    expect(flags.FEATURE_MAP).toBe(true);
    expect(flags.FEATURE_ASK).toBe(true);
  });

  it('empty FEATURE_* values follow the preset (as in .env.example)', () => {
    const flags = featureFlags({ MILESTONES: 'm1,m2', FEATURE_FULL_REPORT: '', FEATURE_ASK: '' });
    expect(flags.FEATURE_FULL_REPORT).toBe(true);
    expect(flags).not.toHaveProperty('FEATURE_ASK');
  });

  it('throws on a value that is not a boolean (typo guard)', () => {
    expect(() => featureFlags({ FEATURE_MAP: 'ture' })).toThrow(/FEATURE_MAP="ture"/);
  });

  it('propagates invalid MILESTONES errors', () => {
    expect(() => featureFlags({ MILESTONES: 'm5' })).toThrow(/m5 requires m4/);
  });
});

describe('active intent milestones', () => {
  it('retains planning sections without runtime prerequisites', () => {
    expect(resolveMilestones('s4,s2,s1,s3').sections).toEqual([
      'intent',
      'collections',
      'demand',
      'opportunities',
    ]);
    expect(() => resolveMilestones('s1,s4')).not.toThrow();
    expect(() => resolveMilestones('s1,s3,s4')).not.toThrow();
    expect(() => resolveMilestones('s1,s2,s3,s5')).not.toThrow();
  });
  it('does not reinterpret legacy settings or mix the two plans', () => {
    expect(resolveMilestones('m1').sections).toEqual(['collaborators']);
    expect(() => resolveMilestones('m1,s1')).toThrow(/cannot mix/);
    expect(() => resolveMilestones(', ,')).toThrow(/at least one/);
  });
  it('ignores removed S1–S4 flags', () => {
    const flags = featureFlags({
      MILESTONES: 's1',
      FEATURE_INTENT_CAPTURE: 'false',
      FEATURE_COLLECTION_MATCHING: 'false',
      FEATURE_DEMAND_LEDGER: 'true',
      FEATURE_MERCHANT_OPPORTUNITIES: 'false',
    });
    for (const name of [
      'INTENT_CAPTURE',
      'COLLECTION_MATCHING',
      'DEMAND_LEDGER',
      'MERCHANT_OPPORTUNITIES',
    ])
      expect(flags).not.toHaveProperty(`FEATURE_${name}`);
  });
});
