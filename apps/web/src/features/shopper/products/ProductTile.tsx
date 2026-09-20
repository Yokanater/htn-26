/** Product offer tile. Owner: L1 (S2-L1-2 C1). */
import type { ProductOffer } from '@sei/contracts';
import { ArrowUpRight, ImageOff } from 'lucide-react';
import { useState } from 'react';
import { formatMoney, isStaleEvidence } from './freshness';

export type ProductTileProps = {
  offer: ProductOffer;
  /** Injected clock for deterministic stale presentation. */
  now?: Date;
  /** Evidence older than this TTL is shown as stale. Default 24h. */
  evidenceTtlMs?: number;
  /** Explicit presentation override; when set, skips TTL math. */
  stale?: boolean;
  selected?: boolean;
  onSelect?: (offerId: string) => void;
  onOpenEvidence?: (offerId: string) => void;
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function ProductTile({
  offer,
  now = new Date(),
  evidenceTtlMs = DEFAULT_TTL_MS,
  stale: staleProp,
  selected = false,
  onSelect,
  onOpenEvidence,
}: ProductTileProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [lastImageUrl, setLastImageUrl] = useState(offer.imageUrl);
  if (lastImageUrl !== offer.imageUrl) {
    setLastImageUrl(offer.imageUrl);
    setImageFailed(false);
  }

  const stale =
    staleProp ??
    offer.evidence.some((ev) =>
      isStaleEvidence({ capturedAt: ev.capturedAt, now, ttlMs: evidenceTtlMs }),
    );

  const rawSize = offer.attributes.size;
  const labels: Record<string, string> = {
    XS: 'Extra small',
    S: 'Small',
    M: 'Medium',
    L: 'Large',
    XL: 'Extra large',
    XXL: '2XL',
    XXXL: '3XL',
  };
  const size =
    rawSize === undefined ? undefined : (labels[String(rawSize).toUpperCase()] ?? String(rawSize));
  const width = offer.attributes.width_cm;
  const ships =
    offer.shipsTo === null
      ? 'Shipping eligibility unknown'
      : offer.shipsTo.length === 0
        ? 'Does not list destination countries'
        : `Ships to ${offer.shipsTo.join(', ')}`;

  return (
    <article className="product-card" data-offer-id={offer.id} data-selected={selected}>
      <header className="product-heading">
        <h3 className="text-base font-semibold">{offer.title}</h3>
        <p className="text-sm">
          {offer.merchant.name} · {offer.merchant.domain}
        </p>
        <strong className="product-price">{formatMoney(offer.price)}</strong>
        {offer.sampleOrigin !== 'live' && (
          <p className="product-origin">Provenance: {offer.sampleOrigin}</p>
        )}
      </header>

      {offer.imageUrl && !imageFailed ? (
        <img
          src={offer.imageUrl}
          alt={offer.title}
          loading="lazy"
          className="max-h-40 object-contain"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="product-image-placeholder" role="status">
          <ImageOff aria-hidden="true" />
          <p>{offer.imageUrl ? 'Product image unavailable' : 'No exact variant image available'}</p>
        </div>
      )}
      <p className="product-availability">
        {offer.availability === 'available'
          ? 'Listed as available'
          : offer.availability === 'unavailable'
            ? 'Currently unavailable'
            : 'Availability unverified'}
        {offer.shipsTo === null ? ' · Check shipping' : ''}
        {stale ? ' · Recheck latest details' : ''}
      </p>
      <details className="product-facts">
        <summary>Product details</summary>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt>Availability</dt>
          <dd>{offer.availability}</dd>
          <dt>Shipping</dt>
          <dd>{ships}</dd>
          <dt>Size</dt>
          <dd>{size === undefined ? 'Size unknown' : String(size)}</dd>
          <dt>Dimensions</dt>
          <dd>{width === undefined ? 'Dimensions unknown' : `width ${width} cm`}</dd>
          <dt>Variant</dt>
          <dd>
            product {offer.productId} / variant {offer.variantId}
          </dd>
          <dt>Freshness</dt>
          <dd>{stale ? 'Facts may be stale' : 'Within freshness window'}</dd>
        </dl>
      </details>
      <div className="product-actions">
        <a href={offer.productUrl} target="_blank" rel="noreferrer">
          View at merchant <ArrowUpRight aria-hidden="true" />
        </a>
        {onSelect ? (
          <button type="button" aria-pressed={selected} onClick={() => onSelect(offer.id)}>
            {selected ? 'Remove from shortlist' : 'Shortlist'}
          </button>
        ) : null}
        {onOpenEvidence ? (
          <button type="button" onClick={() => onOpenEvidence(offer.id)}>
            Evidence
          </button>
        ) : null}
      </div>
    </article>
  );
}
