/**
 * Dedicated merchant profiler port. Owner: L4 (S4 live catalog).
 * Not `@sei/core` ShoppingCatalog: this takes a normalized HTTPS URL, not a bare host.
 * Live mode wraps L1 `profileMerchantCatalog`; seed/newcomer inventory stays in-memory.
 */
import {
  createInjectedShoppingCatalog,
  type MerchantProfileDeps,
  profileMerchantCatalog,
  UrlSafetyError,
} from '@sei/collect';
import type { MerchantIdentity, ProductOffer } from '@sei/contracts';
import type { EnvLike, ShoppingContext } from '@sei/core';
import { loadMerchantCatalogOffers } from '../replay';
import type { MerchantCatalogMode } from './merchant-url';

export const MERCHANT_PROFILE_TIMEOUT_MS = 240_000;
const LIVE_FETCH_CAP = 4;

export type { MerchantCatalogMode };

export type MerchantProfiler = {
  profileMerchant(
    url: string,
    context: ShoppingContext,
  ): Promise<{ merchant: MerchantIdentity; offers: ProductOffer[] }>;
};

export class MerchantProfilerError extends Error {
  readonly status: 400 | 422 | 502 | 504;
  readonly code: string;
  constructor(status: 400 | 422 | 502 | 504, code: string, message: string) {
    super(message);
    this.name = 'MerchantProfilerError';
    this.status = status;
    this.code = code;
  }
}

export function merchantCatalogMode(env: EnvLike): MerchantCatalogMode {
  const provider = env.MERCHANT_CATALOG_PROVIDER?.trim().toLowerCase() || 'live';
  if (provider === 'fake' || provider === 'live') return provider;
  throw new Error(
    `Unsupported MERCHANT_CATALOG_PROVIDER "${provider}" (expected "fake" or "live")`,
  );
}

export function createFakeMerchantCatalog(): MerchantProfiler {
  const injected = createInjectedShoppingCatalog({
    offers: loadMerchantCatalogOffers(),
    sampleOrigin: 'seed',
  });
  return {
    async profileMerchant(url, context) {
      return injected.profileMerchant(new URL(url).hostname.toLowerCase(), context);
    },
  };
}

export function createLiveMerchantCatalog(
  deps: MerchantProfileDeps,
  options: { timeoutMs?: number } = {},
): MerchantProfiler {
  const timeoutMs = options.timeoutMs ?? MERCHANT_PROFILE_TIMEOUT_MS;
  return {
    async profileMerchant(url, context) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = AbortSignal.any([context.signal, timeout]);
      const consume = boundLiveConsume(context.consume);
      try {
        consume('catalog_query', 1);
        const result = await profileMerchantCatalog(
          url,
          { ...context, signal, sampleOrigin: 'live', consume },
          deps,
          { sampleOrigin: 'live' },
        );
        return { merchant: result.merchant, offers: result.offers };
      } catch (error) {
        // Record only fixed error categories, never page content, URLs or provider messages.
        console.warn(
          '[merchant-profile]',
          JSON.stringify({
            code:
              error instanceof UrlSafetyError ? error.code : (networkErrorCode(error) ?? 'unknown'),
            timedOut: timeout.aborted,
          }),
        );
        throw mapLiveProfilerError(error, {
          timedOut: timeout.aborted && !context.signal.aborted,
          callerAborted: context.signal.aborted,
        });
      }
    },
  };
}

function boundLiveConsume(inner: ShoppingContext['consume']): ShoppingContext['consume'] {
  const remaining: Record<string, number> = {
    catalog_query: 1,
    fetch: LIVE_FETCH_CAP,
    browser_session: 0,
    model_call: 0,
  };
  return (resource, amount) => {
    if (resource === 'browser_session') {
      throw new MerchantProfilerError(
        502,
        'MERCHANT_PROVIDER_ERROR',
        'The catalog provider is unreachable. Try again.',
      );
    }
    remaining[resource] = (remaining[resource] ?? 0) - amount;
    if (remaining[resource]! < 0) {
      throw new MerchantProfilerError(
        502,
        'MERCHANT_PROVIDER_ERROR',
        'The catalog provider is unreachable. Try again.',
      );
    }
    inner(resource, amount);
  };
}

function mapLiveProfilerError(
  error: unknown,
  flags: { timedOut: boolean; callerAborted: boolean },
): unknown {
  if (error instanceof MerchantProfilerError) return error;
  if (flags.timedOut || isTimeout(error)) {
    return new MerchantProfilerError(
      504,
      'MERCHANT_TIMEOUT',
      'Store profiling took too long. Try again.',
    );
  }
  if (flags.callerAborted || isAbort(error)) return error;
  if (error instanceof UrlSafetyError) {
    if (error.code === 'body_too_large') {
      return new MerchantProfilerError(
        422,
        'MERCHANT_RESPONSE_TOO_LARGE',
        'The store responded, but its page exceeded the inspection size limit.',
      );
    }
    if (error.code === 'http_error') {
      const status = /HTTP (\d{3})/.exec(error.message)?.[1];
      return new MerchantProfilerError(
        502,
        'MERCHANT_STORE_HTTP_ERROR',
        `The store returned HTTP ${status ?? 'error'} while reading its public catalog.`,
      );
    }
    if (error.code === 'redirect_limit') {
      return new MerchantProfilerError(
        502,
        'MERCHANT_REDIRECT_ERROR',
        'The store redirected too many times during catalog inspection.',
      );
    }
    if (
      error.code === 'invalid_url' ||
      error.code === 'https_required' ||
      error.code === 'credentials_forbidden' ||
      error.code === 'hostname_blocked' ||
      error.code === 'private_address'
    ) {
      return new MerchantProfilerError(
        400,
        'INVALID_REQUEST',
        'Check the store URL and try again.',
      );
    }
    if (error.code === 'catalog_unavailable' || error.code === 'content_type') {
      return new MerchantProfilerError(
        422,
        'CATALOG_UNAVAILABLE',
        'This store catalog is not available for profiling.',
      );
    }
    if (error.code === 'aborted') {
      return flags.timedOut
        ? new MerchantProfilerError(
            504,
            'MERCHANT_TIMEOUT',
            'Store profiling took too long. Try again.',
          )
        : error;
    }
    return new MerchantProfilerError(
      502,
      'MERCHANT_PROVIDER_ERROR',
      'The catalog provider is unreachable. Try again.',
    );
  }
  const networkCode = networkErrorCode(error);
  if (networkCode === 'ENOTFOUND' || networkCode === 'EAI_AGAIN') {
    return new MerchantProfilerError(
      502,
      'MERCHANT_DNS_ERROR',
      'The server could not resolve the store domain.',
    );
  }
  if (
    networkCode === 'CERT_HAS_EXPIRED' ||
    networkCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    networkCode === 'DEPTH_ZERO_SELF_SIGNED_CERT'
  ) {
    return new MerchantProfilerError(
      502,
      'MERCHANT_TLS_ERROR',
      'The server could not verify the store’s HTTPS certificate.',
    );
  }
  return new MerchantProfilerError(
    502,
    'MERCHANT_PROVIDER_ERROR',
    'The catalog provider is unreachable. Try again.',
  );
}

function networkErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const value = error as { code?: unknown; cause?: { code?: unknown } };
  const code = value.code ?? value.cause?.code;
  return typeof code === 'string' && /^[A-Z_0-9]{1,64}$/.test(code) ? code : null;
}

function isTimeout(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: string }).name === 'TimeoutError'
  );
}

function isAbort(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('name' in error)) return false;
  const name = (error as { name: string }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}
