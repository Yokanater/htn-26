/** Deterministic L1-owned IDs for catalog identities. Compatible with @sei/contracts id prefixes. */
import { createHash } from 'node:crypto';
import type { IdPrefix } from '@sei/contracts';

/** SHA-256 hex body (26 chars) after the prefix — stable, collision-resistant, schema-compatible. */
export function stablePrefixedId<P extends IdPrefix>(
  prefix: P,
  canonicalKey: string,
): `${P}${string}` {
  const body = createHash('sha256').update(canonicalKey).digest('hex').slice(0, 26);
  return `${prefix}${body}`;
}

export function normalizeMerchantDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

export function offerIdentityKey(domain: string, productId: string, variantId: string): string {
  return `${normalizeMerchantDomain(domain)}::${productId}::${variantId}`;
}

export function evidenceIdentityKey(input: {
  offerKey: string;
  field: string;
  url: string;
  method: string;
  value: string;
}): string {
  return `${input.offerKey}::${input.field}::${input.url}::${input.method}::${input.value}`;
}

/**
 * Maps one normalized merchant domain → one merchant ID for the factory/normalizer lifetime.
 * Explicit mer_* IDs are preserved on first sight; conflicts emit diagnostics and keep the first ID.
 */
export class CatalogIdentityRegistry {
  private readonly domainToMerchantId = new Map<string, `mer_${string}`>();

  merchantId(
    domain: string,
    explicit: string | undefined,
    diagnostics: string[],
    hitIndex?: number,
  ): `mer_${string}` {
    const normalized = normalizeMerchantDomain(domain);
    const existing = this.domainToMerchantId.get(normalized);
    const label = hitIndex === undefined ? normalized : `hit[${hitIndex}]`;

    if (existing) {
      if (explicit?.startsWith('mer_') && explicit !== existing) {
        diagnostics.push(
          `${label}: conflicting explicit merchant id for domain ${normalized}; keeping ${existing}`,
        );
      }
      return existing;
    }

    let assigned: `mer_${string}`;
    if (explicit?.startsWith('mer_')) {
      assigned = explicit as `mer_${string}`;
    } else {
      assigned = stablePrefixedId('mer_', normalized);
    }
    this.domainToMerchantId.set(normalized, assigned);
    return assigned;
  }

  offerId(domain: string, productId: string, variantId: string): `offer_${string}` {
    return stablePrefixedId('offer_', offerIdentityKey(domain, productId, variantId));
  }

  evidenceId(input: {
    offerKey: string;
    field: string;
    url: string;
    method: string;
    value: string;
  }): `ev_${string}` {
    return stablePrefixedId('ev_', evidenceIdentityKey(input));
  }
}
