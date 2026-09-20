/**
 * Syntax-only merchant URL parse. Owner: L4 (S4-L4-1).
 * Seed `.example` hosts cannot pass real DNS checks; this rejects unsafe URLs before L1.
 */
import { isIP } from 'node:net';

export type MerchantCatalogMode = 'fake' | 'live';

const BLOCKED_NAMES = /(^localhost$|\.localhost$|\.local$|\.internal$)/i;

export class MerchantUrlError extends Error {
  readonly code = 'INVALID_URL';
  constructor() {
    super('Enter a public store domain or HTTPS URL without credentials or private hosts.');
    this.name = 'MerchantUrlError';
  }
}

export type MerchantHostKind = 'seed' | 'synthetic_example' | 'public' | 'rejected';

export class MerchantCatalogDisabledError extends Error {
  constructor() {
    super(
      'Live store analysis is disabled on this server. Enable the live merchant catalog or use a demo store.',
    );
    this.name = 'MerchantCatalogDisabledError';
  }
}

export function parseMerchantUrl(raw: string): { href: string; host: string } {
  const input = raw.trim();
  const href = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    throw new MerchantUrlError();
  }
  if (url.protocol !== 'https:') throw new MerchantUrlError();
  if (url.username || url.password) throw new MerchantUrlError();
  if (url.search || url.hash) throw new MerchantUrlError();
  const host = url.hostname.trim().toLowerCase();
  if (!host.includes('.') || BLOCKED_NAMES.test(host)) throw new MerchantUrlError();
  if (isIP(host)) throw new MerchantUrlError();
  if (host.startsWith('.') || host.endsWith('.') || host.includes('..'))
    throw new MerchantUrlError();
  return { href: url.href, host };
}

export function parseMerchantHost(raw: string): string {
  return parseMerchantUrl(raw).host;
}

export function classifyMerchantHost(
  host: string,
  seedDomains: ReadonlySet<string>,
  newcomerHosts: ReadonlySet<string>,
  mode: MerchantCatalogMode,
): MerchantHostKind {
  if (seedDomains.has(host)) return 'seed';
  if (newcomerHosts.has(host)) return 'synthetic_example';
  if (host.endsWith('.example')) return 'rejected';
  if (mode === 'live') return 'public';
  return 'rejected';
}
