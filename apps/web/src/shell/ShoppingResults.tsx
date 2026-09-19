import type { IntentBrief, ProductOffer } from '@sei/contracts';
import { useState } from 'react';
import { type CollectionRunEvent, CollectionWorkspace } from '../features/shopper/collection';
import { deriveRunView } from '../features/shopper/collection/runState';
import { EvidenceDrawer, ProductTile } from '../features/shopper/products';

export function ShoppingResults({
  brief,
  runId,
  events,
  onEdit,
  onCancel,
  onRetry,
}: {
  brief: IntentBrief;
  runId: string;
  events: readonly CollectionRunEvent[];
  onEdit?: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const [saved, setSaved] = useState<ProductOffer[]>([]);
  const [evidence, setEvidence] = useState<ProductOffer | null>(null);
  const current = deriveRunView(brief, runId, events).result;
  const result =
    current && current.status !== 'superseded' && current.status !== 'cancelled'
      ? { type: 'result' as const, result: current }
      : null;
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
      onSelect={() => toggle(offer)}
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
            {brief.sampleOrigin === 'seed' ? 'Synthetic demo products' : 'Store-sourced products'}{' '}
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
      />
      {current && (
        <button type="button" onClick={onRetry}>
          Search again
        </button>
      )}
      {result?.type === 'result' && result.result.offers.length > 0 && (
        <section className="candidate-section">
          <h2>Explore the finds</h2>
          <p>
            These products were found for your items. Check the listed requirements before choosing;
            shipping and unverified facts need confirmation at the store.
          </p>
          <div className="candidate-grid">
            {result.result.offers.map((offer) => (
              <div key={offer.id}>{tile(offer)}</div>
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
          <h2>Your shortlist · {saved.length}</h2>
          <p>Saved for this visit. Download your list to keep it.</p>
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
              a.download = 'common-ground-shortlist.txt';
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
