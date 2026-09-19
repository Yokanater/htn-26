/** Public HTTPS URL safety and bounded fetch. Owner: L1 (S2-L1-1 B4).
 * Selectively adapted from legacy apps/api/src/url-safety.ts @ 453afe1.
 * HTTPS-only for product verification (stricter than the legacy HTTP allow).
 */
import { isIP } from 'node:net';

const BLOCKED_NAMES = /(^localhost$|\.localhost$|\.local$|\.internal$)/i;

export type DnsLookup = (hostname: string) => Promise<Array<{ address: string; family?: number }>>;

export type SafeFetchDeps = {
  fetch: typeof fetch;
  lookup: DnsLookup;
  now?: () => number;
};

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
  acceptContentTypes?: readonly string[];
};

export type SafeFetchResult = {
  url: URL;
  body: Uint8Array;
  contentType: string;
  status: number;
};

export class UrlSafetyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'UrlSafetyError';
    this.code = code;
  }
}

function blockedIpv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b !== undefined && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a !== undefined && a >= 224)
  );
}

export function isBlockedIp(address: string): boolean {
  if (isIP(address) === 4) return blockedIpv4(address);
  const value = address.toLowerCase().split('%')[0] ?? address.toLowerCase();
  if (value.startsWith('::ffff:')) return blockedIpv4(value.slice(7));
  return (
    value === '::' ||
    value === '::1' ||
    value.startsWith('fc') ||
    value.startsWith('fd') ||
    /^fe[89ab]/.test(value) ||
    value.startsWith('2001:db8:')
  );
}

export async function assertPublicHttpsUrl(input: string, lookup: DnsLookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UrlSafetyError('invalid_url', 'Enter a valid public HTTPS URL.');
  }
  if (url.protocol !== 'https:') {
    throw new UrlSafetyError('https_required', 'Only HTTPS URLs are allowed.');
  }
  if (url.username || url.password) {
    throw new UrlSafetyError('credentials_forbidden', 'URLs must not include credentials.');
  }
  if (BLOCKED_NAMES.test(url.hostname) || !url.hostname.includes('.')) {
    throw new UrlSafetyError('hostname_blocked', 'The hostname is not a public domain.');
  }

  const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname);
  if (!addresses.length || addresses.some(({ address }) => isBlockedIp(address))) {
    throw new UrlSafetyError(
      'private_address',
      'The URL resolves to a private or reserved address.',
    );
  }
  return url;
}

async function readBodyCapped(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) {
    throw new UrlSafetyError('body_too_large', 'Response is larger than the byte cap.');
  }
  if (!response.body) {
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      throw new UrlSafetyError('body_too_large', 'Response is larger than the byte cap.');
    }
    return buf;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (signal?.aborted) {
        throw signal.reason ?? new UrlSafetyError('aborted', 'Fetch was cancelled.');
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new UrlSafetyError('body_too_large', 'Response is larger than the byte cap.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Fetch a public HTTPS resource with redirect revalidation and a streamed byte cap.
 * DNS is re-checked on every hop. Connection-level DNS rebinding protection depends on
 * the runtime TLS stack; we document and test hostname/DNS checks as far as injected deps allow.
 */
export async function fetchPublicHttps(
  input: string,
  deps: SafeFetchDeps,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const maxBytes = options.maxBytes ?? 256_000;
  const maxRedirects = options.maxRedirects ?? 3;
  const accept = options.acceptContentTypes;

  let url = await assertPublicHttpsUrl(input, deps.lookup);
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (signal.aborted) {
      throw signal.reason ?? new UrlSafetyError('aborted', 'Fetch was cancelled.');
    }
    const response = await deps.fetch(url, {
      redirect: 'manual',
      signal,
      headers: { 'User-Agent': 'ShopifyIntentStudioBot/0.1' },
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || hop === maxRedirects) {
        throw new UrlSafetyError('redirect_limit', 'Too many redirects.');
      }
      url = await assertPublicHttpsUrl(new URL(location, url).href, deps.lookup);
      continue;
    }

    if (!response.ok) {
      throw new UrlSafetyError('http_error', `Fetch failed with HTTP ${response.status}.`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (
      accept &&
      accept.length > 0 &&
      !accept.some((type) => contentType.toLowerCase().includes(type.toLowerCase()))
    ) {
      throw new UrlSafetyError(
        'content_type',
        'Unsupported content type for product verification.',
      );
    }

    const body = await readBodyCapped(response, maxBytes, signal);
    return { url, body, contentType, status: response.status };
  }

  throw new UrlSafetyError('redirect_limit', 'Could not fetch the URL.');
}
