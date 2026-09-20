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
        const [finalUrl, title, text, html] = await Promise.all([
          page.url(),
          page.title(),
          page.evaluate<string>("document.body?.innerText ?? ''"),
          page.evaluate<string>("document.documentElement?.outerHTML ?? ''"),
        ]);
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
