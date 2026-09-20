import Browserbase from '@browserbasehq/sdk';
import { browserbase, Stagehand } from '@browserbasehq/stagehand';
import { MerchantScanError } from '@sei/core';
import type { DnsLookup } from '../url-safety';
import { assertPublicHttpsUrl } from '../url-safety';
import { browserFailure } from './errors';

export interface MerchantCapture {
  url: string;
  text: string;
  productUrls: string[];
}
export type MerchantBrowser = (input: {
  url: string;
  signal: AbortSignal;
  liveView: (url: string | null) => void;
  progress?: (message: string) => void;
}) => Promise<MerchantCapture>;

/** Stagehand v4 driver only; extraction is assigned to Baseten, not a second LLM. */
export function createMerchantBrowser(options: {
  apiKey: string;
  projectId: string;
  lookup: DnsLookup;
}): MerchantBrowser {
  return async ({ url, signal, liveView, progress }) => {
    const target = await assertPublicHttpsUrl(url, options.lookup);
    signal.throwIfAborted();
    const hosts = [
      target.hostname,
      target.hostname.startsWith('www.') ? target.hostname.slice(4) : `www.${target.hostname}`,
    ];
    // Validate canonical aliases before permitting a storefront redirect.
    const allowedHosts = [target.hostname];
    try {
      await assertPublicHttpsUrl(`https://${hosts[1]}`, options.lookup);
      allowedHosts.push(hosts[1]);
    } catch {
      signal.throwIfAborted();
    }
    progress?.('Starting Browserbase and loading its Stagehand browser extension.');
    const browser = await browserbase
      .launch({
        apiKey: options.apiKey,
        projectId: options.projectId,
        api_timeout: 180,
        keepAlive: false,
        browserSettings: {
          recordSession: false,
          logSession: false,
          allowedDomains: allowedHosts,
        },
      })
      .catch((error: unknown) => {
        throw browserFailure(error, 'launch');
      });
    let closing: Promise<void> | undefined;
    const close = () => (closing ??= browser.close());
    const abort = () => {
      void close().catch(() => undefined);
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      // v4 launch returns an unattached handle. Context methods are unavailable until create.
      await Stagehand.create({ browser });
      signal.throwIfAborted();
      // Network policy is installed before navigation, including redirects/subresources.
      await browser.context.setDomainPolicy({
        allowedDomains: [...allowedHosts, 'cdn.shopify.com'],
      });
      const page = (await browser.context.pages())[0] ?? (await browser.context.newPage());
      if (browser.sessionId) {
        try {
          const client = new Browserbase({ apiKey: options.apiKey, maxRetries: 0 });
          const debug = await client.sessions.debug(browser.sessionId, { signal, timeout: 10000 });
          const view = new URL(debug.debuggerFullscreenUrl);
          if (view.protocol === 'https:' && view.hostname.endsWith('.browserbase.com')) {
            view.searchParams.set('readOnly', 'true');
            liveView(view.href);
          }
        } catch {
          signal.throwIfAborted();
        }
      }
      progress?.('Browserbase is connected. Reading the storefront and its product links.');
      // Preserve market/language routes such as /en-ca and collection URLs supplied by the merchant.
      const prefix = target.pathname.match(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/|$)/i)?.[0] ?? '';
      const collection = /\/(collections|products)\//.test(target.pathname)
        ? target.href
        : new URL(`${prefix}/collections/all`, target).href;
      await page.goto(collection, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      try {
        await page.waitForSelector('a[href*="/products/"]', { timeout: 12000 });
      } catch {
        signal.throwIfAborted();
        progress?.(
          'The all-products collection is unavailable. Checking the supplied storefront page.',
        );
        await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('a[href*="/products/"]', { timeout: 12000 });
      }
      signal.throwIfAborted();
      const final = await assertPublicHttpsUrl(await page.url(), options.lookup);
      if (!allowedHosts.includes(final.hostname))
        throw new MerchantScanError(
          'STOREFRONT_REDIRECT',
          'The store redirected to another merchant domain. Enter its canonical public storefront URL.',
        );
      const capture = await page.evaluate<{ text: string; links: string[] }>(`(() => ({
        text: (document.body?.innerText || '').slice(0, 24000),
        links: [...document.querySelectorAll('a[href]')].map(a => a.href).filter(u => u.includes('/products/')).slice(0, 100)
      }))()`);
      const productUrls = [
        ...new Set(
          capture.links.flatMap((raw) => {
            try {
              const candidate = new URL(raw);
              const match = candidate.pathname.match(/\/products\/([^/]+)/);
              if (
                candidate.origin !== final.origin ||
                !match ||
                candidate.username ||
                candidate.password
              )
                return [];
              const locale =
                candidate.pathname.match(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/i)?.[0] ?? '';
              return [new URL(`${locale}/products/${match[1]}`, final).href];
            } catch {
              return [];
            }
          }),
        ),
      ].slice(0, 8);
      if (!productUrls.length)
        throw new MerchantScanError(
          'NO_PRODUCT_LINKS',
          'No public product links were found. Enter a public Shopify collection URL; password-protected or unsupported storefronts cannot be scanned.',
        );
      return { url: final.href, text: capture.text, productUrls };
    } catch (error) {
      signal.throwIfAborted();
      throw browserFailure(error, 'navigation');
    } finally {
      signal.removeEventListener('abort', abort);
      liveView(null);
      await close().catch(() => {
        progress?.('Browserbase cleanup was not acknowledged; the session has a bounded expiry.');
      });
    }
  };
}
