/** Injected catalog hit → ProductOffer[]. Owner: L1 (S2-L1-1 B2/B3).
 * Does not guess undocumented provider fields.
 * Real Global Catalog parsing remains blocked on redacted human spike output under fixtures/spikes/.
 * Synthetic/provider hits are injected shapes — not recorded provider output.
 */
import {
  newId,
  type ProductEvidence,
  ProductEvidenceSchema,
  type ProductOffer,
  ProductOfferSchema,
  PublicHttpsUrlSchema,
  type SampleOrigin,
} from '@sei/contracts';
import { z } from 'zod';
import { MAX_OFFERS_PER_SLOT } from './limits';
import { CatalogIdentityRegistry, normalizeMerchantDomain, offerIdentityKey } from './stable-id';

/** Synthetic/provider catalog hit. Fields are explicit; missing facts stay unknown. */
export const CatalogHitSchema = z.strictObject({
  merchant: z.strictObject({
    id: z.string().min(1).optional(),
    name: z.string().min(1),
    domain: z.string().min(1),
  }),
  productId: z.string().min(1),
  variantId: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  productUrl: z.string().min(1),
  imageUrl: z.string().nullable().optional(),
  price: z
    .strictObject({
      amount: z.number().int().nonnegative(),
      currency: z.string().regex(/^[A-Z]{3}$/),
    })
    .nullable()
    .optional(),
  availability: z.enum(['available', 'unavailable', 'unknown']).optional(),
  shipsTo: z
    .array(z.string().regex(/^[A-Z]{2}$/))
    .nullable()
    .optional(),
  attributes: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  /** Discovery hint only — never promotes unknown hard facts. */
  searchSnippet: z.string().optional(),
  capturedAt: z.iso.datetime().optional(),
  evidenceUrl: z.string().optional(),
  evidenceMethod: z.enum(['catalog', 'fetch', 'browser']).optional(),
});

export type CatalogHit = z.infer<typeof CatalogHitSchema>;

export type NormalizeCatalogOptions = {
  sampleOrigin: SampleOrigin;
  capturedAt?: string;
  /**
   * Max offers to emit. Defaults to MAX_OFFERS_PER_SLOT (bounded query-shaped API).
   * Pass Number.POSITIVE_INFINITY for uncapped inventory normalization.
   * Negative or zero yields an empty offer list.
   */
  limit?: number;
  /** Shared registry so repeated normalizations keep stable merchant/offer/evidence IDs. */
  identity?: CatalogIdentityRegistry;
};

export type NormalizeCatalogResult = {
  offers: ProductOffer[];
  diagnostics: string[];
};

/**
 * Build evidence for a fact field. Search snippets may only create discovery provenance,
 * not price/availability/size/dimensions/material/shipping facts.
 * Callers that normalize batches must validate URLs before calling, or catch failures.
 */
export function buildProductEvidence(input: {
  id?: `ev_${string}`;
  field: string;
  value: string;
  url: string;
  capturedAt: string;
  method: ProductEvidence['method'];
}): ProductEvidence {
  return ProductEvidenceSchema.parse({
    id: input.id ?? newId('ev_'),
    field: input.field,
    value: input.value,
    url: PublicHttpsUrlSchema.parse(input.url),
    capturedAt: input.capturedAt,
    method: input.method,
  });
}

function resolveLimit(limit: number | undefined): number {
  if (limit === undefined) return MAX_OFFERS_PER_SLOT;
  if (!Number.isFinite(limit)) return Number.POSITIVE_INFINITY;
  if (limit <= 0) return 0;
  return limit;
}

function tryBuildEvidence(
  input: {
    id: `ev_${string}`;
    field: string;
    value: string;
    url: string;
    capturedAt: string;
    method: ProductEvidence['method'];
  },
  hitIndex: number,
  diagnostics: string[],
): ProductEvidence | null {
  const urlCheck = PublicHttpsUrlSchema.safeParse(input.url);
  if (!urlCheck.success) {
    diagnostics.push(`hit[${hitIndex}]: evidence URL is not a public HTTPS URL; hit omitted`);
    return null;
  }
  const capturedCheck = z.iso.datetime().safeParse(input.capturedAt);
  if (!capturedCheck.success) {
    diagnostics.push(`hit[${hitIndex}]: invalid capturedAt; hit omitted`);
    return null;
  }
  try {
    return buildProductEvidence({ ...input, url: urlCheck.data, capturedAt: capturedCheck.data });
  } catch {
    diagnostics.push(`hit[${hitIndex}]: evidence construction failed; hit omitted`);
    return null;
  }
}

/**
 * Normalize injected catalog hits into ProductOffer[].
 * Default limit is MAX_OFFERS_PER_SLOT. Use limit: Infinity for full inventory builds.
 */
export function normalizeCatalogHits(
  rawHits: unknown[],
  options: NormalizeCatalogOptions,
): NormalizeCatalogResult {
  const diagnostics: string[] = [];
  const limit = resolveLimit(options.limit);
  const identity = options.identity ?? new CatalogIdentityRegistry();
  const seen = new Set<string>();
  const offers: ProductOffer[] = [];
  const fallbackCapturedAt = options.capturedAt ?? '1970-01-01T00:00:00.000Z';

  if (limit === 0) {
    return { offers: [], diagnostics };
  }

  for (const [index, raw] of rawHits.entries()) {
    const parsed = CatalogHitSchema.safeParse(raw);
    if (!parsed.success) {
      diagnostics.push(`hit[${index}]: invalid catalog hit (${parsed.error.issues[0]?.message})`);
      continue;
    }
    const hit = parsed.data;
    const domain = normalizeMerchantDomain(hit.merchant.domain);
    const key = offerIdentityKey(domain, hit.productId, hit.variantId);
    if (seen.has(key)) {
      diagnostics.push(`hit[${index}]: duplicate seller/product/variant omitted`);
      continue;
    }

    const urlCheck = PublicHttpsUrlSchema.safeParse(hit.productUrl);
    if (!urlCheck.success) {
      diagnostics.push(`hit[${index}]: productUrl is not a public HTTPS URL`);
      continue;
    }

    let imageUrl: string | null = hit.imageUrl ?? null;
    if (imageUrl !== null) {
      const imageCheck = PublicHttpsUrlSchema.safeParse(imageUrl);
      if (!imageCheck.success) {
        diagnostics.push(`hit[${index}]: imageUrl omitted (not public HTTPS)`);
        imageUrl = null;
      }
    }

    const capturedAt = hit.capturedAt ?? fallbackCapturedAt;
    const evidenceMethod = hit.evidenceMethod ?? 'catalog';

    // Prefer productUrl when evidenceUrl is absent. Invalid evidenceUrl omits the hit
    // (do not silently fall back — that would misrepresent the evidence source).
    if (hit.evidenceUrl !== undefined) {
      const evidenceUrlCheck = PublicHttpsUrlSchema.safeParse(hit.evidenceUrl);
      if (!evidenceUrlCheck.success) {
        diagnostics.push(
          `hit[${index}]: invalid evidenceUrl; hit omitted (no silent productUrl fallback)`,
        );
        continue;
      }
    }
    const evidenceUrl = hit.evidenceUrl ?? hit.productUrl;

    const recordValue = `${hit.title} (${hit.productId}/${hit.variantId})`;
    const productEvidence = tryBuildEvidence(
      {
        id: identity.evidenceId({
          offerKey: key,
          field: 'product_record',
          url: evidenceUrl,
          method: evidenceMethod,
          value: recordValue,
        }),
        field: 'product_record',
        value: recordValue,
        url: evidenceUrl,
        capturedAt,
        method: evidenceMethod,
      },
      index,
      diagnostics,
    );
    if (!productEvidence) {
      continue;
    }

    const evidence: ProductEvidence[] = [productEvidence];

    if (hit.searchSnippet) {
      const snippet = tryBuildEvidence(
        {
          id: identity.evidenceId({
            offerKey: key,
            field: 'discovery_snippet',
            url: evidenceUrl,
            method: 'catalog',
            value: hit.searchSnippet,
          }),
          field: 'discovery_snippet',
          value: hit.searchSnippet,
          url: evidenceUrl,
          capturedAt,
          method: 'catalog',
        },
        index,
        diagnostics,
      );
      if (!snippet) {
        continue;
      }
      evidence.push(snippet);
    }

    const attributes = { ...(hit.attributes ?? {}) };
    const merchantId = identity.merchantId(domain, hit.merchant.id, diagnostics, index);

    const offer = ProductOfferSchema.parse({
      id: identity.offerId(domain, hit.productId, hit.variantId),
      merchant: {
        id: merchantId,
        name: hit.merchant.name,
        domain,
      },
      productId: hit.productId,
      variantId: hit.variantId,
      title: hit.title,
      category: hit.category,
      productUrl: hit.productUrl,
      imageUrl,
      price: hit.price === undefined ? null : hit.price,
      availability: hit.availability ?? 'unknown',
      shipsTo: hit.shipsTo === undefined ? null : hit.shipsTo,
      attributes,
      evidence,
      sampleOrigin: options.sampleOrigin,
    });

    seen.add(key);
    offers.push(offer);
    if (offers.length >= limit) break;
  }

  return { offers, diagnostics };
}

/** Uncapped inventory normalization — search result caps apply after filtering. */
export function normalizeCatalogInventory(
  rawHits: unknown[],
  options: Omit<NormalizeCatalogOptions, 'limit'>,
): NormalizeCatalogResult {
  return normalizeCatalogHits(rawHits, {
    ...options,
    limit: Number.POSITIVE_INFINITY,
  });
}

/** Snippets must not be used to fill hard product facts. */
export function assertSnippetDoesNotProveHardFacts(offer: ProductOffer): void {
  const hardFields = new Set([
    'price',
    'availability',
    'size',
    'dimensions',
    'material',
    'shipsTo',
    'shipping',
  ]);
  for (const ev of offer.evidence) {
    if (ev.field === 'discovery_snippet' && hardFields.has(ev.field)) {
      throw new Error('Discovery snippet cannot prove hard product facts');
    }
  }
}

export { CatalogIdentityRegistry, normalizeMerchantDomain, offerIdentityKey };
