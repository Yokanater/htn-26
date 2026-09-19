/** Bootstrap routes only. Owner: L4. Feature services land on active S1–S5 cards. */
import { CapabilitiesSchema, SCHEMA_VERSION } from '@sei/contracts';
import {
  type EnvLike,
  featureFlags,
  MILESTONE_PRESETS,
  resolveMilestones,
  SHOPPING_DOMAINS,
} from '@sei/core';
import { Hono } from 'hono';

/** Pure factory: no listeners, environment reads or provider calls. */
export function createApp(env: EnvLike = {}): Hono {
  const resolved = resolveMilestones(env.MILESTONES);
  const flags = featureFlags(env);
  const sections = resolved.milestones.flatMap((id) => {
    const preset = MILESTONE_PRESETS[id];
    return preset.flags.every((flag) => flags[flag]) ? preset.sections : [];
  });
  const capabilities = CapabilitiesSchema.parse({
    planVersion: '3.0',
    schemaVersion: SCHEMA_VERSION,
    milestoneFamily: resolved.milestones[0]?.startsWith('s') ? 'intent' : 'legacy',
    milestones: resolved.milestones,
    sections: [...new Set(sections)],
    domains: Object.keys(SHOPPING_DOMAINS),
    flags,
    implementation: 'bootstrap',
  });
  const app = new Hono();
  app.get('/healthz', (c) => c.json({ ok: true }));
  app.get('/api/healthz', (c) => c.json({ ok: true }));
  app.get('/api/capabilities', (c) => c.json(capabilities));
  return app;
}
