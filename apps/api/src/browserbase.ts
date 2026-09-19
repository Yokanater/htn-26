import Browserbase from "@browserbasehq/sdk";
import { chromium, type Browser, type Page } from "playwright-core";

export type BrowserbasePage = {
  sessionId: string;
  requestedUrl: string;
  finalUrl: string;
  title: string;
  text: string;
};

export type BrowseOptions = {
  url: string;
  timeoutMs?: number;
  maxTextLength?: number;
  signal?: AbortSignal;
};

export type BrowserbaseSession = {
  sessionId: string;
  page: Page;
};

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to use Browserbase.`);
  return value;
}

/**
 * Open one public page in a short-lived Browserbase session and return its
 * rendered text. The Browserbase domain allowlist prevents the session from
 * navigating to unrelated hosts, and the browser is always closed.
 */
export async function browseWithBrowserbase({
  url,
  timeoutMs = 30_000,
  maxTextLength = 20_000,
  signal,
}: BrowseOptions): Promise<BrowserbasePage> {
  const target = new URL(url);
  if (!["http:", "https:"].includes(target.protocol))
    throw new Error("Browserbase only accepts HTTP or HTTPS URLs.");

  return withBrowserbaseSession(
    { allowedDomains: [target.hostname], timeoutMs, signal },
    async ({ page, sessionId }) => {
      await page.goto(target.href, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });
      const [title, body] = await Promise.all([
        page.title(),
        page.locator("body").innerText({ timeout: timeoutMs }),
      ]);
      return {
        sessionId,
        requestedUrl: target.href,
        finalUrl: page.url(),
        title,
        text: body.replace(/\s+/g, " ").trim().slice(0, maxTextLength),
      };
    },
  );
}

export async function withBrowserbaseSession<T>(
  {
    allowedDomains,
    timeoutMs = 30_000,
    signal,
  }: {
    allowedDomains: string[];
    timeoutMs?: number;
    signal?: AbortSignal;
  },
  run: (session: BrowserbaseSession) => Promise<T>,
) {
  if (signal?.aborted)
    throw signal.reason ?? new Error("Browserbase research was cancelled.");
  const apiKey = requiredEnvironment("BROWSERBASE_API_KEY");
  const projectId = process.env.BROWSERBASE_PROJECT_ID?.trim();
  const browserbase = new Browserbase({ apiKey, timeout: timeoutMs });
  const session = await browserbase.sessions.create({
    ...(projectId ? { projectId } : {}),
    keepAlive: false,
    api_timeout: Math.max(60, Math.ceil(timeoutMs / 1_000) + 15),
    browserSettings: { allowedDomains },
    userMetadata: { service: "grove", purpose: "storefront-research" },
  });
  let browser: Browser | undefined;
  const closeOnAbort = () => void browser?.close().catch(() => undefined);
  signal?.addEventListener("abort", closeOnAbort, { once: true });
  try {
    browser = await chromium.connectOverCDP(session.connectUrl, {
      timeout: timeoutMs,
    });
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    if (signal?.aborted)
      throw signal.reason ?? new Error("Browserbase research was cancelled.");
    return await Promise.race([
      run({ sessionId: session.id, page }),
      new Promise<never>((_, reject) =>
        signal?.addEventListener(
          "abort",
          () =>
            reject(
              signal.reason ?? new Error("Browserbase research was cancelled."),
            ),
          { once: true },
        ),
      ),
    ]);
  } finally {
    signal?.removeEventListener("abort", closeOnAbort);
    if (browser)
      await Promise.race([
        browser.close().catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ]);
  }
}
