import type { MerchantProfile, ShoppingDomain } from '@sei/contracts';
import type { MerchantDiscovery, MerchantProfiler } from '@sei/core';
import { createOpportunityMapper } from '@sei/enrich';
import { createCollaborationComposer } from '@sei/reason';
import { describe, expect, it, vi } from 'vitest';
import { defaultProviders } from '../src/providers';
import { createSeedMerchantProfiler, MerchantWorkspaceService } from '../src/services/merchant';

function harness(
  domain: ShoppingDomain,
  discovery: MerchantDiscovery,
  override?: MerchantProfiler,
  hardMs?: number,
) {
  const base = defaultProviders({});
  const seed = createSeedMerchantProfiler();
  // Offline fixtures exercise the live branch without network or actual observed demand.
  const profile: MerchantProfiler['profile'] = async (input) => {
    const value = await seed.profile(input);
    return {
      ...value,
      sampleOrigin: 'live',
      offers: value.offers.map((offer) => ({ ...offer, sampleOrigin: 'live' })),
    };
  };
  const profiler = override ?? { origin: 'live' as const, profile: vi.fn(profile) };
  const service = new MerchantWorkspaceService({
    profiler,
    discovery,
    composer: createCollaborationComposer(),
    mapper: createOpportunityMapper(),
    projection: base.demandProjection,
    ledger: base.demand,
    sessions: base.sessions,
    now: base.now,
    hardMs,
  });
  const owner = base.sessions.create();
  const start = () => service.start(owner, `https://${domain}-brand-1.example`, domain);
  return { service, owner, start, profile, base, profiler };
}

describe.each(['outfit', 'setup'] as const)('%s exploration lifecycle', (domain) => {
  it('automatically verifies partners without confirmation or whitelist and returns supply fit with no demand', async () => {
    const h = harness(domain, {
      discover: async () => [
        `https://${domain}-brand-2.example`,
        `https://${domain}-brand-2.example`,
        'https://missing.example',
      ],
    });
    const run = h.start();
    await expect.poll(() => h.service.run(h.owner, run.id).status).toBe('ready');
    const primary = h.service.run(h.owner, run.id).profile!;
    h.service.confirm(
      h.owner,
      primary.id,
      primary.offers.map((o) => ({ offerId: o.id, category: o.category })),
    );
    const comparison = await h.service.opportunities(h.owner, primary.id);
    expect(comparison.opportunities).toEqual([]);
    expect(comparison.candidates).toHaveLength(1);
    expect(comparison.candidates[0].profile.confirmed).toBe(false);
    expect(comparison.candidates[0].complementaryCategories.length).toBeGreaterThan(0);
    expect(h.service.profiles(h.base.sessions.create())).toEqual([]);
    expect(h.service.run(h.owner, run.id).events.some((e) => e.message.includes('skipped'))).toBe(
      true,
    );
  });
  it('retains the primary catalog and a visible warning when search fails', async () => {
    const h = harness(domain, {
      discover: async () => {
        throw new Error('outage');
      },
    });
    const run = h.start();
    await expect.poll(() => h.service.run(h.owner, run.id).status).toBe('ready');
    const result = h.service.run(h.owner, run.id);
    expect(result.profile?.warnings.join(' ')).toContain('search unavailable');
    expect(h.service.profiles(h.owner)).toHaveLength(1);
  });
  it.each(['cancel', 'deadline', 'delete'] as const)(
    'suppresses late partner results after %s and retains completed work where allowed',
    async (action) => {
      let finish: ((p: MerchantProfile) => void) | undefined;
      let partner: MerchantProfile | undefined;
      let signal: AbortSignal | undefined;
      const h = harness(
        domain,
        { discover: async () => [`https://${domain}-brand-2.example`] },
        {
          origin: 'live',
          profile: async (input) => {
            const p = await h.profile(input);
            if (input.url.includes('brand-1')) return p;
            partner = p;
            signal = input.signal;
            return new Promise((resolve) => {
              finish = resolve;
            });
          },
        },
        action === 'deadline' ? 150 : undefined,
      );
      const run = h.start();
      await expect.poll(() => Boolean(finish), { interval: 5 }).toBe(true);
      if (action === 'cancel') h.service.cancel(h.owner, run.id);
      if (action === 'delete') {
        h.base.sessions.revoke(h.owner);
        h.service.deleteOwner(h.owner);
      }
      if (action === 'deadline')
        await expect
          .poll(() => h.service.run(h.owner, run.id).status, { interval: 5 })
          .toBe('failed');
      expect(signal?.aborted).toBe(true);
      finish!(partner!);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(h.service.profiles(h.owner)).toHaveLength(action === 'delete' ? 0 : 1);
      if (action !== 'delete') {
        expect(h.service.run(h.owner, run.id).profile).not.toBeNull();
        expect(h.service.run(h.owner, run.id).status).toBe(
          action === 'cancel' ? 'cancelled' : 'failed',
        );
      }
    },
  );
});
