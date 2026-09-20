import { browserbase, Stagehand } from '@browserbasehq/stagehand';

export type BrowserbasePageText = {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  text: string;
  /** Serialized document, so JSON-LD, embedded state and meta tags can be read deterministically. */
  html: string;
  sessionId: string;
};

const MAX_PAGE_CHARS = 750_000;

/** Preserve product data before applying the payload cap. Theme CSS/SVG/navigation can exceed
 * the old 750 KB cap before the actual Product JSON-LD even appears in the document. */
export const PRODUCT_DOCUMENT_SCRIPT = `(() => {
  const meta = [...document.querySelectorAll('title,meta,link[rel="canonical"]')].map(n => n.outerHTML);
  const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map(n => n.outerHTML);
  const state = [...document.querySelectorAll('script')].filter(n => n.type !== 'application/ld+json' &&
    (n.type === 'application/json' || /Shopify\\.currency|ShopifyAnalytics\\s*\\.\\s*meta|var\\s+meta\\s*=|window\\.__pdp|shop_currency/.test(n.textContent || '')))
    .filter(n => n.outerHTML.length < 400000).map(n => n.outerHTML);
  const shopify = document.querySelector('script[src*="cdn.shopify.com"]')?.outerHTML || '';
  return {finalUrl:location.href, title:document.title, text:document.body?.innerText || '',
    html:[...meta,...ld,...state,shopify].join('\\n')};
})()`;

export type BrowserbaseCatalogBrowser = {
  sessionId: string;
  readPage(url: string, signal: AbortSignal): Promise<BrowserbasePageText>;
  close(): Promise<void>;
};

export type BrowserbaseCatalogBrowserFactory = (input: {
  apiKey: string;
  signal: AbortSignal;
}) => Promise<BrowserbaseCatalogBrowser>;

/**
 * Opens a real Browserbase cloud browser. A catalog run reuses this session across slot queries,
 * while each product fact page gets its own tab so concurrent verification cannot race navigation.
 */
export const openBrowserbaseCatalogBrowser: BrowserbaseCatalogBrowserFactory = async ({
  apiKey,
  signal,
}) => {
  signal.throwIfAborted();
  const browser = await browserbase.launch({ apiKey });
  let stagehand: Stagehand;
  try {
    stagehand = await Stagehand.create({ browser });
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
  const attachedBrowser = stagehand.browser;
  const sessionId = attachedBrowser.sessionId ?? browser.sessionId ?? 'browserbase-session';
  let closed = false;

  const close = async () => {
    if (closed) return;
    closed = true;
    await stagehand.close();
  };

  signal.addEventListener('abort', () => void close().catch(() => undefined), { once: true });

  return {
    sessionId,
    async readPage(url, readSignal) {
      if (closed) throw new Error('Browserbase catalog session is closed.');
      readSignal.throwIfAborted();
      const page = await attachedBrowser.context.newPage();
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12_000 });
        readSignal.throwIfAborted();
        // One DOM snapshot avoids mixing fields across a redirect/hydration navigation.
        const { finalUrl, title, text, html } = await page.evaluate<{
          finalUrl: string;
          title: string;
          text: string;
          html: string;
        }>(PRODUCT_DOCUMENT_SCRIPT);
        return {
          requestedUrl: url,
          finalUrl,
          title,
          text: String(text).slice(0, MAX_PAGE_CHARS),
          html: String(html).slice(0, MAX_PAGE_CHARS),
          sessionId,
        };
      } finally {
        await page.close().catch(() => undefined);
      }
    },
    close,
  };
};
