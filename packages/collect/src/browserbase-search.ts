import { browserbase } from '@browserbasehq/stagehand';

export type BrowserbaseProductSearchResult = {
  title: string;
  url: string;
};

export type BrowserbaseProductSearch = (input: {
  apiKey: string;
  query: string;
  limit: number;
  signal: AbortSignal;
}) => Promise<BrowserbaseProductSearchResult[]>;

/**
 * Browserbase Search does not launch a browser session. Keep this adapter small so tests can inject
 * a fake and live catalog discovery can remain bounded and cancellation-aware.
 */
export const searchBrowserbaseProducts: BrowserbaseProductSearch = async ({
  apiKey,
  query,
  limit,
  signal,
}) => {
  signal.throwIfAborted();
  const response = await browserbase.search({
    apiKey,
    query,
    numResults: Math.max(1, Math.min(limit, 8)),
  });
  signal.throwIfAborted();
  return response.results.map(({ title, url }) => ({ title, url }));
};
