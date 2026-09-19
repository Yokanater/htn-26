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
}: BrowseOptions): Promise<BrowserbasePage> {
  const target = new URL(url);
  if (!["http:", "https:"].includes(target.protocol))
    throw new Error("Browserbase only accepts HTTP or HTTPS URLs.");

  return withBrowserbaseSession(
    { allowedDomains: [target.hostname], timeoutMs },
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
  }: { allowedDomains: string[]; timeoutMs?: number },
  run: (session: BrowserbaseSession) => Promise<T>,
) {
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
  try {
    browser = await chromium.connectOverCDP(session.connectUrl, {
      timeout: timeoutMs,
    });
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    return await run({ sessionId: session.id, page });
  } finally {
    if (browser)
      await Promise.race([
        browser.close().catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ]);
  }
}
