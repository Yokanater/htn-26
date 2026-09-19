/** Product offer tile. Owner: L1 (S2-L1-2 C1). */
import type { ProductOffer } from '@sei/contracts';
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

  const size = offer.attributes.size;
  const width = offer.attributes.width_cm;
  const ships =
    offer.shipsTo === null
      ? 'Shipping eligibility unknown'
      : offer.shipsTo.length === 0
        ? 'Does not list destination countries'
        : `Ships to ${offer.shipsTo.join(', ')}`;

  return (
    <article
      className="flex flex-col gap-2 border p-3"
      data-offer-id={offer.id}
      data-selected={selected}
    >
      <header className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">{offer.title}</h3>
        <p className="text-sm">
          {offer.merchant.name} · {offer.merchant.domain}
        </p>
        <p className="text-xs text-muted-foreground">Provenance: {offer.sampleOrigin}</p>
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
        <p className="text-sm text-muted-foreground" role="status">
          {offer.imageUrl ? 'Product image unavailable' : 'No exact variant image available'}
        </p>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt>Price</dt>
        <dd>{formatMoney(offer.price)}</dd>
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

      <div className="flex flex-wrap gap-2">
        <a href={offer.productUrl} target="_blank" rel="noreferrer">
          View at merchant
        </a>
        {onSelect ? (
          <button type="button" aria-pressed={selected} onClick={() => onSelect(offer.id)}>
            {selected ? 'Selected' : 'Select'}
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
