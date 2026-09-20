import { readFileSync } from 'node:fs';
import { MerchantProfileSchema } from '@sei/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createMerchantDiscovery } from '../src/merchant/discovery';

const lookup = async () => [{ address: '93.184.216.34' }];
describe.each(['outfit', 'setup'])('%s automatic merchant search', (domain) => {
  const profile = MerchantProfileSchema.parse(
    JSON.parse(
      readFileSync(
        new URL(`../../../fixtures/seed/${domain}/merchant-profile.json`, import.meta.url),
        'utf8',
      ),
    ),
  );
  it('sends only fixed categories, rejects unsafe/nonproduct/self results and bounds distinct stores', async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        results: [
          `https://${profile.merchant.domain}/products/self`,
          'http://unsafe.example/products/item',
          'https://127.0.0.1/products/item',
          'https://one.example/about',
          'https://one.example:444/products/item',
          'https://one.example/products/item',
          'https://www.one.example/products/other',
          'https://two.example/products/item',
          'https://three.example/products/item',
          'https://four.example/products/item',
        ].map((url) => ({ url })),
      }),
    );
    const discovery = createMerchantDiscovery({ apiKey: 'test', lookup, fetch });
    expect(await discovery.discover(profile, new AbortController().signal)).toEqual([
      'https://one.example',
      'https://two.example',
      'https://three.example',
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const sent = JSON.stringify(fetch.mock.calls);
    expect(sent).not.toContain(profile.merchant.domain);
    for (const offer of profile.offers) expect(sent).not.toContain(offer.title);
  });
  it('returns empty after at most two searches and propagates outages', async () => {
    const fetch = vi.fn(async () => Response.json({ results: [] }));
    expect(
      await createMerchantDiscovery({ apiKey: 'test', lookup, fetch }).discover(
        profile,
        new AbortController().signal,
      ),
    ).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
    await expect(
      createMerchantDiscovery({
        apiKey: 'test',
        lookup,
        fetch: async () => new Response('', { status: 403 }),
      }).discover(profile, new AbortController().signal),
    ).rejects.toThrow('Merchant search unavailable');
  });
  it('stops before searching when cancelled', async () => {
    const fetch = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(
      createMerchantDiscovery({ apiKey: 'test', lookup, fetch }).discover(
        profile,
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
