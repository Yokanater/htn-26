import { MerchantScanError } from '@sei/core';

/** Inspect structured status only; raw errors may contain keys, browser URLs or response bodies. */
export function browserFailure(error: unknown, phase: 'launch' | 'navigation'): MerchantScanError {
  if (error instanceof MerchantScanError) return error;
  let cause: unknown = error;
  for (let depth = 0; depth < 5 && cause && typeof cause === 'object'; depth++) {
    const item = cause as { status?: unknown; cause?: unknown };
    if (item.status === 401 || item.status === 403)
      return new MerchantScanError(
        'BROWSERBASE_ACCESS',
        'Browserbase denied access. Check the API key, project access and permission to upload the Stagehand extension.',
      );
    if (item.status === 429)
      return new MerchantScanError(
        'BROWSERBASE_LIMIT',
        'Browserbase reached its session or rate limit. Close unused sessions or wait before retrying.',
      );
    cause = item.cause;
  }
  return phase === 'launch'
    ? new MerchantScanError(
        'BROWSERBASE_START',
        'Browserbase could not start its browser. Check project access, available session quota and Stagehand extension support.',
      )
    : new MerchantScanError(
        'STOREFRONT_BROWSER',
        'The storefront could not be read in the browser. It may block automated access or require a different public collection URL.',
      );
}
