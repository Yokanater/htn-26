import type { IntentBrief, ProductOffer } from '@sei/contracts';
import { type CSSProperties, useState } from 'react';
import { type CollectionRunEvent, CollectionWorkspace } from '../features/shopper/collection';
import type { DecisionHandler } from '../features/shopper/collection/decisions';
import { deriveRunView } from '../features/shopper/collection/runState';
import { EvidenceDrawer, ProductTile } from '../features/shopper/products';

export function ShoppingResults({
  brief,
  runId,
  events,
  onEdit,
  onCancel,
  onRetry,
  flags,
  onDecision,
  onRefreshBrief,
}: {
  brief: IntentBrief;
  runId: string;
  events: readonly CollectionRunEvent[];
  onEdit?: () => void;
  onCancel: () => void;
  onRetry: () => void;
  /** Effective capability flags; decision controls need FEATURE_DEMAND_LEDGER. */
  flags?: Record<string, boolean> | null;
  onDecision?: DecisionHandler;
  onRefreshBrief?: () => void;
}) {
  const [saved, setSaved] = useState<ProductOffer[]>([]);
  const [evidence, setEvidence] = useState<ProductOffer | null>(null);
  const recordedChoices = Boolean(flags?.FEATURE_DEMAND_LEDGER && onDecision);
  const current = deriveRunView(brief, runId, events).result;
  const result =
    current && current.status !== 'superseded' && current.status !== 'cancelled'
      ? { type: 'result' as const, result: current }
      : null;
  const selectedIds = new Set<string>();
  if (result) {
    const selectedBySlot = new Map(
      result.result.collection?.match.slots.map((slot) => [slot.slotId, slot.selectedOfferId]) ??
        [],
    );
    for (const selected of selectedBySlot.values()) {
      if (selected) selectedIds.add(selected);
    }
    for (const candidate of result.result.candidates) {
      const displayed = selectedBySlot.get(candidate.slotId) ?? candidate.offerIds[0];
      if (displayed) selectedIds.add(displayed);
    }
  }
  const productKey = (offer: ProductOffer) => `${offer.merchant.id}:${offer.productId}`;
  const shownProducts = new Set(
    result?.result.offers.filter((offer) => selectedIds.has(offer.id)).map(productKey),
  );
  const moreOffers =
    result?.result.offers.filter((offer) => {
      const key = productKey(offer);
      if (shownProducts.has(key)) return false;
      shownProducts.add(key);
      return true;
    }) ?? [];
  const toggle = (offer: ProductOffer) =>
    setSaved((items) =>
      items.some((i) => i.id === offer.id)
        ? items.filter((i) => i.id !== offer.id)
        : [...items, offer],
    );
  const tile = (offer: ProductOffer) => (
    <ProductTile
      offer={offer}
      selected={saved.some((i) => i.id === offer.id)}
      onSelect={recordedChoices ? undefined : () => toggle(offer)}
      onOpenEvidence={() => setEvidence(offer)}
    />
  );
  return (
    <div className="shopping-results">
      <div className="results-heading">
        <div>
          <p className="eyebrow">YOUR COLLECTION · STEP 3</p>
          <h1>
            From idea to <em>real finds.</em>
          </h1>
          <p>
            {brief.sampleOrigin === 'seed'
              ? 'Synthetic demo products'
              : brief.sampleOrigin === 'replay'
                ? 'Recorded Shopify products'
                : 'Store-sourced products'}{' '}
            for your confirmed brief. Search is limited to three minutes.
          </p>
        </div>
        <button type="button" disabled={!onEdit} onClick={onEdit}>
          Edit requirements
        </button>
      </div>

      <CollectionWorkspace
        brief={brief}
        runId={runId}
        events={events}
        renderOffer={tile}
        onCancel={onCancel}
        flags={flags}
        onDecision={
          onDecision
            ? async (dto) => {
                const response = await onDecision(dto);
                if (response.ok) {
                  const ids = new Set(dto.selections.map((s) => s.offerId));
                  const products = result?.result.offers.filter((p) => ids.has(p.id)) ?? [];
                  if (dto.kind === 'item_rejected')
                    setSaved((items) => items.filter((p) => !ids.has(p.id)));
                  else if (dto.kind === 'item_accepted') {
                    const slot = dto.selections[0]?.slotId;
                    const alternatives = new Set(
                      result?.result.candidates.find((c) => c.slotId === slot)?.offerIds ?? [],
                    );
                    setSaved((items) => [
                      ...items.filter((p) => !alternatives.has(p.id) && !ids.has(p.id)),
                      ...products,
                    ]);
                  } else setSaved(products);
                }
                return response;
              }
            : undefined
        }
        onRefreshBrief={onRefreshBrief}
      />
      {current && (
        <button type="button" onClick={onRetry}>
          Search again
        </button>
      )}
      {moreOffers.length > 0 && (
        <section className="candidate-section">
          <h2>Explore the finds</h2>
          <p>
            These products were found for your items. Check the listed requirements before choosing;
            shipping and unverified facts need confirmation at the store.
          </p>
          <div className="candidate-grid">
            {moreOffers.map((offer, index) => (
              <div
                className="find-reveal"
                style={{ '--find-index': Math.min(index, 7) } as CSSProperties}
                key={offer.id}
              >
                {tile(offer)}
              </div>
            ))}
          </div>
        </section>
      )}
      {result?.type === 'result' && result.result.offers.length === 0 && (
        <p>
          No verifiable storefront products were found. Try a more specific item name or fewer
          visual requirements.
        </p>
      )}
      {saved.length > 0 && (
        <section className="saved-collection">
          <h2>
            {recordedChoices ? 'Your selected items' : 'Your shortlist'} · {saved.length}
          </h2>
          <p>
            {recordedChoices
              ? 'Your choices are recorded. Download a copy for yourself.'
              : 'Saved for this visit. Download your list to keep it.'}
          </p>
          {saved.map((offer) => (
            <p key={offer.id}>
              <a href={offer.productUrl} target="_blank" rel="noreferrer">
                {offer.title} ↗
              </a>
            </p>
          ))}
          <button
            type="button"
            onClick={() => {
              const file = new Blob(
                [saved.map((o) => `${o.title}\n${o.productUrl}`).join('\n\n')],
                { type: 'text/plain' },
              );
              const url = URL.createObjectURL(file);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'rainforest-shortlist.txt';
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download shortlist
          </button>
        </section>
      )}
      <EvidenceDrawer
        open={evidence !== null}
        title={evidence?.title ?? 'Product evidence'}
        evidence={evidence?.evidence ?? []}
        sampleOrigin={evidence?.sampleOrigin}
        onClose={() => setEvidence(null)}
      />
    </div>
  );
}
