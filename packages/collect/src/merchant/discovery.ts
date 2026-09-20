import type { MerchantDiscovery } from '@sei/core';
import { getDomain } from 'tldts';
import { z } from 'zod';
import { assertPublicHttpsUrl, type DnsLookup } from '../url-safety';

/** Searches fixed taxonomy categories only: no product titles, shopper facts or private data. */
export function createMerchantDiscovery(options: {
  apiKey: string;
  lookup: DnsLookup;
  fetch?: typeof fetch;
}): MerchantDiscovery {
  return {
    async discover(profile, signal) {
      const own = new Set(profile.offers.map((offer) => offer.category.toLowerCase()));
      const taxonomy =
        profile.domain === 'outfit'
          ? ['bag', 'footwear', 'top', 'outerwear']
          : ['lighting', 'storage', 'chair', 'desk'];
      const complements = taxonomy.filter((category) => !own.has(category)).slice(0, 2);
      const sourceDomain = getDomain(profile.merchant.domain) ?? profile.merchant.domain;
      const domains = new Set<string>([sourceDomain]);
      const urls: string[] = [];
      for (const category of complements.length ? complements : taxonomy.slice(0, 2)) {
        signal.throwIfAborted();
        const response = await (options.fetch ?? fetch)('https://api.browserbase.com/v1/search', {
          method: 'POST',
          signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
          headers: { 'x-bb-api-key': options.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `${category} Shopify independent store inurl:products`,
            numResults: 6,
          }),
        });
        if (!response.ok) throw new Error('Merchant search unavailable');
        const data = z
          .object({ results: z.array(z.object({ url: z.string() })).max(25) })
          .parse(await response.json());
        for (const result of data.results) {
          signal.throwIfAborted();
          try {
            const url = await assertPublicHttpsUrl(result.url, options.lookup);
            if (!/\/products\/[^/]+/.test(url.pathname) || (url.port && url.port !== '443'))
              continue;
            const domain = getDomain(url.hostname) ?? url.hostname;
            if (domains.has(domain)) continue;
            domains.add(domain);
            urls.push(url.origin);
            if (urls.length === 3) return urls;
          } catch {
            signal.throwIfAborted();
          }
        }
      }
      return urls;
    },
  };
}
