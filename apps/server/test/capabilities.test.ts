import { CapabilitiesSchema } from '@sei/contracts';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

describe('bootstrap capability metadata', () => {
  it('advertises both domains and explicitly labels implementation status', async () => {
    const app = createApp({ MILESTONES: 's1,s2,s3,s4', OPENAI_API_KEY: 'do-not-expose' });
    const response = await app.request('/api/capabilities');
    const raw = await response.json();
    const capabilities = CapabilitiesSchema.parse(raw);
    expect(capabilities.domains).toEqual(['outfit', 'setup']);
    expect(capabilities.sections).toEqual(['intent', 'collections', 'demand', 'opportunities']);
    expect(capabilities.implementation).toBe('bootstrap');
    expect(capabilities.milestoneFamily).toBe('intent');
    expect(JSON.stringify(raw)).not.toContain('do-not-expose');
    expect((await app.request('/api/briefs', { method: 'POST' })).status).toBe(401);
  });
  it('ignores obsolete milestone locks and exposes all implemented sections', async () => {
    const response = await createApp({
      MILESTONES: 's1,s2',
      FEATURE_COLLECTION_MATCHING: 'false',
      FEATURE_INTENT_CAPTURE: 'false',
      FEATURE_DEMAND_LEDGER: 'false',
      FEATURE_MERCHANT_OPPORTUNITIES: 'false',
    }).request('/api/capabilities');
    expect(CapabilitiesSchema.parse(await response.json()).sections).toEqual([
      'intent',
      'collections',
      'demand',
      'opportunities',
    ]);
    expect(() => createApp({ MILESTONES: 's1,s2', FEATURE_INTENT_CAPTURE: 'false' })).not.toThrow();
  });
  it('does not let legacy configuration lock the current app', async () => {
    const response = await createApp({ MILESTONES: 'm1' }).request('/api/capabilities');
    expect(CapabilitiesSchema.parse(await response.json()).milestoneFamily).toBe('intent');
  });
});
