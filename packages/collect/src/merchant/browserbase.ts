import Browserbase from '@browserbasehq/sdk';
import { browserbase } from '@browserbasehq/stagehand';
import type { DnsLookup } from '../url-safety';
import { assertPublicHttpsUrl } from '../url-safety';

export interface MerchantCapture {
  url: string;
  text: string;
  productUrls: string[];
}
export type MerchantBrowser = (input: {
  url: string;
  signal: AbortSignal;
  liveView: (url: string | null) => void;
}) => Promise<MerchantCapture>;

/** Stagehand v4 driver only; extraction is assigned to Baseten, not a second LLM. */
export function createMerchantBrowser(options: {
  apiKey: string;
  projectId: string;
  lookup: DnsLookup;
}): MerchantBrowser {
  return async ({ url, signal, liveView }) => {
    const target = await assertPublicHttpsUrl(url, options.lookup);
    signal.throwIfAborted();
    const browser = await browserbase.launch({
      apiKey: options.apiKey,
      projectId: options.projectId,
      api_timeout: 180,
      keepAlive: false,
      browserSettings: {
        recordSession: false,
        logSession: false,
        allowedDomains: [target.hostname],
      },
    });
    let closing: Promise<void> | undefined;
    const close = () => (closing ??= browser.close());
    const abort = () => {
      void close().catch(() => undefined);
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      // Network policy is installed before navigation, including redirects/subresources.
      await browser.context.setDomainPolicy({
        allowedDomains: [target.hostname, 'cdn.shopify.com'],
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
      await page.goto(new URL('/collections/all', target).href, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForSelector('a[href*="/products/"]', { timeout: 12000 });
      signal.throwIfAborted();
      const final = await assertPublicHttpsUrl(await page.url(), options.lookup);
      if (final.hostname !== target.hostname)
        throw new Error('Store redirected outside its allowed domain');
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
                candidate.origin !== target.origin ||
                !match ||
                candidate.username ||
                candidate.password
              )
                return [];
              return [new URL(`/products/${match[1]}`, target).href];
            } catch {
              return [];
            }
          }),
        ),
      ].slice(0, 8);
      return { url: final.href, text: capture.text, productUrls };
    } finally {
      signal.removeEventListener('abort', abort);
      liveView(null);
      await close();
    }
  };
}
