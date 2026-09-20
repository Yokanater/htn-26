/**
 * @sei/collect — Catalog, public product evidence, URL safety, browser verify, merchant profiles.
 * Owner: L1. Design v3 §§3–6, §8–9.
 *
 * ## Partial-failure contract gate (S2-L1-1 B6)
 * `ShoppingCatalog.search()` in `@sei/core` currently returns `ProductOffer[]` only.
 * L1 will not invent a private incompatible catalog interface.
 * Pending coordinator decision:
 * 1. typed thrown provider errors with separately bounded successful offer calls, or
 * 2. an additive result envelope (offers + warnings/failures) via an authorized core change.
 * Until then, adapters return successful offers and throw typed errors for hard failures;
 * normalize diagnostics stay local to parser results (`NormalizeCatalogResult.diagnostics`).
 *
 * ## L4 wiring
 * Prefer `createInjectedShoppingCatalog({ offers, hits?, hitSource? })` as the stable
 * offline composition root. Do not read repository JSON from production code.
 */

export {
  type BrowserPage,
  type BrowserSessionFactory,
  type BrowserSessionHandle,
  type BrowserVerifyDeps,
  type BrowserVerifyOptions,
  type BrowserVerifyResult,
  createFakeBrowserSessionFactory,
  verifyProductWithBrowser,
} from './browser-verify';
export {
  type BrowserbaseProductSearch,
  type BrowserbaseProductSearchResult,
  searchBrowserbaseProducts,
} from './browserbase-search';
export {
  type CatalogHitSource,
  type CreateInjectedShoppingCatalogOptions,
  createFixtureShoppingCatalog,
  createInjectedShoppingCatalog,
  MAX_OFFERS_PER_SLOT,
} from './injected-catalog';
export {
  type MerchantProfileDeps,
  type MerchantProfileResult,
  profileMerchantCatalog,
} from './merchant/profile';
export {
  assertSnippetDoesNotProveHardFacts,
  buildProductEvidence,
  type CatalogHit,
  CatalogHitSchema,
  CatalogIdentityRegistry,
  type NormalizeCatalogOptions,
  type NormalizeCatalogResult,
  normalizeCatalogHits,
  normalizeCatalogInventory,
  normalizeMerchantDomain,
  offerIdentityKey,
} from './normalize';
export {
  evidenceIdentityKey,
  stablePrefixedId,
} from './stable-id';
export {
  assertPublicHttpsUrl,
  type DnsLookup,
  fetchPublicHttps,
  isBlockedIp,
  type SafeFetchDeps,
  type SafeFetchOptions,
  type SafeFetchResult,
  UrlSafetyError,
} from './url-safety';
