/** Injected browser verification adapter. Owner: L1 (S2-L1-1 B5).
 * Cleanup structure adapted from legacy apps/api/src/browserbase.ts @ 453afe1.
 * No live Browserbase calls in tests — inject session factories.
 */
import { newId, type ProductEvidence } from '@sei/contracts';
import type { ShoppingContext } from '@sei/core';
import { buildProductEvidence } from './normalize';
import { assertPublicHttpsUrl, type DnsLookup } from './url-safety';

export type BrowserPage = {
  goto: (url: string, options?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
  url: () => string;
  title: () => Promise<string>;
  innerText: (selector?: string) => Promise<string>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  off?: (event: string, handler: (...args: unknown[]) => void) => void;
  close?: () => Promise<void>;
};

export type BrowserSessionHandle = {
  sessionId: string;
  page: BrowserPage;
  release: () => Promise<void>;
};

export type BrowserSessionFactory = (input: {
  allowedDomains: string[];
  signal: AbortSignal;
  timeoutMs: number;
}) => Promise<BrowserSessionHandle>;

export type BrowserVerifyDeps = {
  createSession: BrowserSessionFactory;
  lookup: DnsLookup;
};

export type BrowserVerifyOptions = {
  timeoutMs?: number;
  maxTextLength?: number;
  signal?: AbortSignal;
};

export type BrowserVerifyResult = {
  sessionId: string;
  requestedUrl: string;
  finalUrl: string;
  title: string;
  text: string;
  evidence: ProductEvidence[];
};

export async function verifyProductWithBrowser(
  productUrl: string,
  context: ShoppingContext,
  deps: BrowserVerifyDeps,
  options: BrowserVerifyOptions = {},
): Promise<BrowserVerifyResult> {
  if (context.signal.aborted || options.signal?.aborted) {
    throw new Error('Browser verification was cancelled before start.');
  }
  context.consume('browser_session', 1);

  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxTextLength = options.maxTextLength ?? 20_000;
  const signal = options.signal
    ? AbortSignal.any([context.signal, options.signal])
    : context.signal;

  const target = await assertPublicHttpsUrl(productUrl, deps.lookup);
  let session: BrowserSessionHandle | undefined;
  try {
    if (signal.aborted) throw new Error('Browser verification was cancelled.');
    session = await deps.createSession({
      allowedDomains: [target.hostname],
      signal,
      timeoutMs,
    });

    const onAbort = () => {
      void session?.release().catch(() => undefined);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      await session.page.goto(target.href, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });
      if (signal.aborted) throw new Error('Browser verification was cancelled.');
      const finalUrl = session.page.url();
      const final = await assertPublicHttpsUrl(finalUrl, deps.lookup);
      if (final.hostname !== target.hostname) {
        throw new Error('Browser navigation left the allowed product host.');
      }
      const title = await session.page.title();
      const text = (await session.page.innerText('body'))
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxTextLength);
      const capturedAt = new Date().toISOString();
      const evidence = [
        buildProductEvidence({
          field: 'browser_title',
          value: title || 'untitled',
          url: final.href,
          capturedAt,
          method: 'browser',
        }),
        buildProductEvidence({
          field: 'browser_text_excerpt',
          value: text.slice(0, 500) || 'empty',
          url: final.href,
          capturedAt,
          method: 'browser',
        }),
      ];
      return {
        sessionId: session.sessionId,
        requestedUrl: target.href,
        finalUrl: final.href,
        title,
        text,
        evidence,
      };
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  } finally {
    if (session) {
      await session.release().catch(() => undefined);
    }
  }
}

/** Test helper factory — never opens a real Browserbase session. */
export function createFakeBrowserSessionFactory(
  behavior: (url: string) => Promise<{ title: string; text: string; finalUrl?: string }>,
): BrowserSessionFactory {
  return async ({ signal }) => {
    if (signal.aborted) throw new Error('Browser verification was cancelled.');
    const sessionId = `bb_fake_${newId('run_').slice(4)}`;
    let currentUrl = 'https://example.invalid/';
    const page: BrowserPage = {
      goto: async (url) => {
        if (signal.aborted) throw new Error('Browser verification was cancelled.');
        const result = await behavior(url);
        currentUrl = result.finalUrl ?? url;
        (page as { _title?: string; _text?: string })._title = result.title;
        (page as { _text?: string })._text = result.text;
      },
      url: () => currentUrl,
      title: async () => (page as { _title?: string })._title ?? '',
      innerText: async () => (page as { _text?: string })._text ?? '',
    };
    return {
      sessionId,
      page,
      release: async () => undefined,
    };
  };
}
