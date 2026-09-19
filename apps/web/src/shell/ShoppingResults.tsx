import type { IntentBrief, ProductOffer } from '@sei/contracts';
import { useEffect, useRef, useState } from 'react';
import { type CollectionRunEvent, CollectionWorkspace } from '../features/shopper/collection';
import { EvidenceDrawer, ProductTile } from '../features/shopper/products';

async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Search could not be completed.');
  return data;
}
export function ShoppingResults({ brief, onEdit }: { brief: IntentBrief; onEdit: () => void }) {
  const [runId, setRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<CollectionRunEvent[]>([]);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [cancelled, setCancelled] = useState(false);
  const [saved, setSaved] = useState<ProductOffer[]>([]);
  const [evidence, setEvidence] = useState<ProductOffer | null>(null);
  const stopPolling = useRef(() => {});
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let currentId: string | null = null;
    stopPolling.current = () => {
      stopped = true;
      clearTimeout(timer);
    };
    setRunId(null);
    setEvents([]);
    setError('');
    setCancelled(false);
    setSaved([]);
    async function poll(id: string) {
      try {
        const data = await api(`/api/search/${id}`);
        if (stopped) return;
        setEvents(data.events);
        if (!data.events.some((e: CollectionRunEvent) => e.type === 'result'))
          timer = setTimeout(() => void poll(id), 1200);
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : 'Search failed.');
      }
    }
    void Promise.resolve()
      .then(() =>
        stopped
          ? null
          : api(`/api/briefs/${brief.id}/search`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ revision: brief.revision, attempt }),
            }),
      )
      .then((data) => {
        if (!data) return;
        currentId = data.runId;
        if (stopped) {
          void api(`/api/search/${data.runId}`, { method: 'DELETE' }).catch(() => {});
          return;
        }
        setRunId(data.runId);
        void poll(data.runId);
      })
      .catch((e) => {
        if (!stopped) setError(e.message);
      });
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (currentId) void api(`/api/search/${currentId}`, { method: 'DELETE' }).catch(() => {});
    };
  }, [brief.id, brief.revision, attempt]);
  const result = events.findLast((e) => e.type === 'result');
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
            Store-sourced products for your confirmed brief. Search is limited to three minutes.
          </p>
        </div>
        <button type="button" onClick={onEdit}>
          Edit requirements
        </button>
      </div>
      {!runId && !error && <p role="status">Starting your product search…</p>}
      {error && <p role="alert">{error}</p>}
      {cancelled ? (
        <p role="status">Search cancelled.</p>
      ) : (
        <CollectionWorkspace
          brief={brief}
          runId={runId}
          events={events}
          renderOffer={tile}
          onCancel={() => {
            stopPolling.current();
            setCancelled(true);
            if (runId) void api(`/api/search/${runId}`, { method: 'DELETE' }).catch(() => {});
          }}
        />
      )}
      {(error || cancelled || result) && (
        <button type="button" onClick={() => setAttempt((n) => n + 1)}>
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
