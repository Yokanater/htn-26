/**
 * @sei/core: milestone presets and feature flags. Owner: L4 (card M1-L4-0).
 *
 * Spec: docs/milestones/README.md §2 rule 3 and §3.
 * - `MILESTONES=m1,m2,m4` enables the union of those milestones' report sections and flags.
 * - An explicit `FEATURE_*=true|false` env var overrides the preset.
 * A new milestone or flag is an additive edit to MILESTONE_PRESETS; never change an existing entry.
 */

export type MilestoneId = 'm1' | 'm2' | 'm3' | 'm4' | 'm5';

export interface MilestonePreset {
  /** Report section keys this milestone adds (SectionKey values, design §4.5). */
  sections: string[];
  /** FEATURE_* flags this milestone turns on. */
  flags: string[];
  /** Milestones that must also be enabled. */
  requires: MilestoneId[];
}

export const MILESTONE_PRESETS: Record<MilestoneId, MilestonePreset> = {
  m1: { sections: ['collaborators'], flags: [], requires: [] },
  m2: {
    sections: ['competitors', 'discourse', 'swot', 'actions'],
    flags: ['FEATURE_FULL_REPORT'],
    requires: ['m1'],
  },
  m3: {
    sections: ['ecosystem_map', 'partner_view'],
    flags: ['FEATURE_MAP', 'FEATURE_MISSION_CONTROL', 'FEATURE_PARTNER_VIEW'],
    requires: ['m1'],
  },
  m4: { sections: [], flags: ['FEATURE_ACTIONS', 'FEATURE_BUNDLE_STUDIO'], requires: ['m1'] },
  m5: { sections: [], flags: ['FEATURE_SHOPIFY_WRITEBACK'], requires: ['m4'] },
};

export const DEFAULT_MILESTONES = 'm1';

const MILESTONE_ORDER = Object.keys(MILESTONE_PRESETS) as MilestoneId[];

export interface ResolvedMilestones {
  /** Enabled milestones in canonical order (m1 → m5). */
  milestones: MilestoneId[];
  /** Union of enabled report sections, in preset order, deduplicated. */
  sections: string[];
  /** Union of preset flags, in preset order, deduplicated. */
  flags: string[];
}

function isMilestoneId(value: string): value is MilestoneId {
  return Object.hasOwn(MILESTONE_PRESETS, value);
}

/**
 * Parses a MILESTONES value such as `"m1,m2,m4"` (case- and whitespace-insensitive).
 * Empty or missing → `m1`. Throws on an unknown ID or a missing required milestone.
 */
export function resolveMilestones(
  value: string | undefined = DEFAULT_MILESTONES,
): ResolvedMilestones {
  const raw = value.trim() === '' ? DEFAULT_MILESTONES : value;
  const requested = raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '');

  const unknown = requested.filter((id) => !isMilestoneId(id));
  if (unknown.length > 0) {
    throw new Error(
      `MILESTONES="${value}": unknown milestone(s) ${unknown.join(', ')}; expected ${MILESTONE_ORDER.join(', ')}`,
    );
  }

  const enabled = new Set(requested as MilestoneId[]);
  const missing = [...enabled].flatMap((id) =>
    MILESTONE_PRESETS[id].requires
      .filter((req) => !enabled.has(req))
      .map((req) => `${id} requires ${req}`),
  );
  if (missing.length > 0) {
    throw new Error(`MILESTONES="${value}": ${missing.join('; ')}`);
  }

  const milestones = MILESTONE_ORDER.filter((id) => enabled.has(id));
  const union = (pick: (preset: MilestonePreset) => string[]) => [
    ...new Set(milestones.flatMap((id) => pick(MILESTONE_PRESETS[id]))),
  ];
  return { milestones, sections: union((p) => p.sections), flags: union((p) => p.flags) };
}

export type EnvLike = Record<string, string | undefined>;

/**
 * Feature flags for a process: every preset flag (on if its milestone is enabled via
 * `env.MILESTONES`), then explicit `FEATURE_*` env vars on top.
 * - `FEATURE_X=true|1` forces on, `FEATURE_X=false|0` forces off (case-insensitive).
 * - `FEATURE_X=` (empty) means "follow the preset"; any other value throws (catches typos).
 * Flags that no milestone enables (improvement slots, e.g. FEATURE_ASK) are present only when set.
 */
export function featureFlags(env: EnvLike): Record<string, boolean> {
  const { flags: enabled } = resolveMilestones(env.MILESTONES);
  const flags: Record<string, boolean> = {};
  for (const id of MILESTONE_ORDER) {
    for (const flag of MILESTONE_PRESETS[id].flags) flags[flag] = enabled.includes(flag);
  }
  for (const [key, rawValue] of Object.entries(env)) {
    if (!key.startsWith('FEATURE_') || rawValue === undefined) continue;
    const value = rawValue.trim().toLowerCase();
    if (value === '') continue;
    if (value === 'true' || value === '1') flags[key] = true;
    else if (value === 'false' || value === '0') flags[key] = false;
    else throw new Error(`${key}="${rawValue}": expected true, false, 1, 0, or empty`);
  }
  return flags;
}
