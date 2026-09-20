/** Shopper collection workspace. Owner: L3 (S2-L3-1). Design v3 §2, §5.2–5.3.
 * Shows the collection for the current brief revision only: selected offers via the injected
 * product tile, alternatives, cited explanations, exact missing items and unverified constraints.
 * No cart, combined checkout or shipping total: each store sets its own prices and fulfillment.
 * With a decision handler, explicit choices are added (S3-L3-1a).
 */
import type { IntentBrief, ProductOffer } from '@sei/contracts';
import { useMemo } from 'react';
import {
  CollectionDecisionBar,
  ReplaceButton,
  SlotDecisionControls,
  useCollectionDecisions,
} from './CollectionDecisions';
import { type DecisionHandler, displayedCollection } from './decisions';
import { deriveRunView } from './runState';
import type {
  CollectionRunEvent,
  CollectionRunResult,
  ExplanationBasis,
  MissingItem,
  MissingSlotReason,
  OfferTileRenderer,
  RunStage,
  StageStatus,
} from './types';

const MISSING_REASON: Record<MissingSlotReason, string> = {
  no_query: 'No search terms could be built for this item. Edit its category or description.',
  no_candidates: 'No products were found for this item.',
  provider_failed: 'The product search failed for this item. Try again later.',
  deadline: 'The search ran out of time before this item was found.',
  budget_exhausted: 'The search limit was reached before this item was searched.',
  no_eligible_offer: 'Products were found, but not every requirement could be verified.',
  matcher_failed: 'Products were found, but a collection could not be assembled.',
};

const BASIS_LABEL: Record<ExplanationBasis, string> = {
  product_fact: 'Product fact',
  computed_check: 'Checked',
  computed_summary: 'Calculated',
  model_summary: 'AI summary',
  missing: 'Gap',
};

const STAGE_LABEL: Record<RunStage, string> = {
  plan: 'Planning searches',
  discover: 'Finding products',
  match: 'Assembling the collection',
  explain: 'Explaining the choices',
};

const STATUS_TEXT: Record<CollectionRunResult['status'], string> = {
  ready: 'Collection ready. Every required item is covered and checked.',
  partial: 'Partial collection. Some items are missing or still need verification.',
  failed: 'No collection could be assembled.',
  cancelled: 'Search cancelled.',
  superseded: 'This search was replaced by a newer version of your brief.',
};

export function formatPrice(offer: ProductOffer): string {
  if (!offer.price) return 'Price unknown';
  const format = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: offer.price.currency,
  });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(offer.price.amount / 10 ** digits);
}

/** Temporary tile until S2-L1-2 exports the product tile from features/shopper/products. */
export function FallbackOfferTile({ offer }: { offer: ProductOffer }) {
  return (
    <article aria-label={offer.title}>
      <h4>{offer.title}</h4>
      <p>
        {offer.merchant.name} · {offer.merchant.domain}
      </p>
      <p>{formatPrice(offer)}</p>
      <p>
        {offer.availability === 'available'
          ? 'Listed as available'
          : offer.availability === 'unavailable'
            ? 'Listed as unavailable'
            : 'Availability unknown'}
      </p>
      <a href={offer.productUrl} rel="noopener noreferrer" target="_blank">
        View on {offer.merchant.domain}
      </a>
    </article>
  );
}

const fallbackRenderer: OfferTileRenderer = (offer) => <FallbackOfferTile offer={offer} />;

function missingConstraintText(item: Extract<MissingItem, { kind: 'constraint' }>): string {
  return item.status === 'unknown'
    ? `${item.key}: needs verification with the store`
    : `${item.key}: not met`;
}

export interface CollectionWorkspaceProps {
  brief: IntentBrief;
  /** Run ID the shopper started for this revision, or null before a run. */
  runId: string | null;
  /** Server events in delivery order; foreign or stale events are ignored. */
  events: readonly CollectionRunEvent[];
  renderOffer?: OfferTileRenderer;
  onCancel?: () => void;
  /** Records an explicit decision. Without it, or with the flag off, no decision control renders. */
  onDecision?: DecisionHandler;
  /** Reloads the latest brief revision after a stale-revision 409. */
  onRefreshBrief?: () => void;
}

export function CollectionWorkspace({
  brief,
  runId,
  events,
  renderOffer = fallbackRenderer,
  onCancel,
  onDecision,
  onRefreshBrief,
}: CollectionWorkspaceProps) {
  const view = deriveRunView(brief, runId, events);
  const result = view.result;
  const offers = new Map(result?.offers.map((offer) => [offer.id, offer]));
  const collection = result?.collection ?? null;
  const slotMatches = new Map(collection?.match.slots.map((slot) => [slot.slotId, slot]));
  const explanations = new Map(
    collection?.explanation.slots.map((slot) => [slot.slotId, slot]) ?? [],
  );
  const missing = result?.missing ?? [];
  const showsCollection =
    result !== null && result.status !== 'cancelled' && result.status !== 'superseded';
  const shownMatch = showsCollection ? (collection?.match ?? null) : null;
  const shownOffers = result?.offers;
  const shown = useMemo(
    () => displayedCollection(brief, shownMatch, shownOffers ?? []),
    [brief, shownMatch, shownOffers],
  );
  const decisions = useCollectionDecisions({
    enabled: true,
    shown,
    onDecision,
  });

  return (
    <section aria-labelledby="collection-heading">
      <h2 id="collection-heading">Your collection</h2>
      <div aria-live="polite" role="status">
        {view.phase === 'idle' && <p>Confirm your brief to search for products.</p>}
        {view.phase === 'running' && (
          <>
            <p>Searching stores for revision {brief.revision} of your brief…</p>
            <ul aria-label="Search progress">
              {(Object.keys(STAGE_LABEL) as RunStage[]).map((stage) => (
                <li key={stage}>
                  {STAGE_LABEL[stage]}: {stageText(view.stages[stage])}
                </li>
              ))}
            </ul>
          </>
        )}
        {result && <p>{STATUS_TEXT[result.status]}</p>}
      </div>
      {view.phase === 'running' && onCancel && (
        <button onClick={onCancel} type="button">
          Cancel search
        </button>
      )}

      {showsCollection && (
        <>
          {brief.slots.map((slot) => {
            const matched = slotMatches.get(slot.id);
            const selected = matched?.selectedOfferId
              ? offers.get(matched.selectedOfferId)
              : undefined;
            const explanation = explanations.get(slot.id);
            const slotMissing = missing.filter((item) => item.slotId === slot.id);
            const alternatives = (matched?.alternativeOfferIds ?? [])
              .map((id) => offers.get(id))
              .filter((offer): offer is ProductOffer => offer !== undefined);
            const headingId = `slot-${slot.id}`;
            return (
              <section aria-labelledby={headingId} key={slot.id}>
                <h3 id={headingId}>
                  {slot.category} ({slot.required ? 'required' : 'optional'})
                </h3>
                {selected ? (
                  renderOffer(selected, { slotId: slot.id, selected: true })
                ) : (
                  <p>
                    {slotMissing.some(
                      (item) => item.kind === 'slot' && item.reason === 'no_eligible_offer',
                    )
                      ? 'Options found · verification needed.'
                      : 'Not found.'}
                  </p>
                )}
                <SlotDecisionControls
                  category={slot.category}
                  controller={decisions}
                  key={`${shown?.matchId}:${shown?.briefRevision}`}
                  slotId={slot.id}
                />
                {slotMissing.length > 0 && (
                  <ul aria-label={`${slot.category} gaps`}>
                    {slotMissing.map((item) => (
                      <li key={item.kind === 'slot' ? item.reason : item.key}>
                        {item.kind === 'slot'
                          ? MISSING_REASON[item.reason]
                          : missingConstraintText(item)}
                      </li>
                    ))}
                  </ul>
                )}
                {explanation && explanation.lines.length > 0 && (
                  <ul aria-label={`Why this ${slot.category}`}>
                    {explanation.lines.map((line) => (
                      <li key={`${line.basis}-${line.text}`}>
                        <span>{BASIS_LABEL[line.basis]}</span>: {line.text}
                      </li>
                    ))}
                  </ul>
                )}
                {alternatives.length > 0 && (
                  <details>
                    <summary>
                      {alternatives.length} alternative{alternatives.length === 1 ? '' : 's'}
                    </summary>
                    {alternatives.map((offer) => (
                      <div key={offer.id}>
                        {renderOffer(offer, { slotId: slot.id, selected: false })}
                        <ReplaceButton controller={decisions} offerId={offer.id} slotId={slot.id} />
                      </div>
                    ))}
                  </details>
                )}
              </section>
            );
          })}
          {collection && (
            <ul aria-label="Collection summary">
              {collection.explanation.summary.map((line) => (
                <li key={`${line.basis}-${line.text}`}>
                  <span>{BASIS_LABEL[line.basis]}</span>: {line.text}
                </li>
              ))}
            </ul>
          )}
          <p>
            Prices, availability, shipping and tax are set by each store. There is no combined
            checkout; open each product on its own store.
          </p>
        </>
      )}
      <CollectionDecisionBar controller={decisions} onRefreshBrief={onRefreshBrief} />
    </section>
  );
}

function stageText(status: StageStatus | undefined): string {
  switch (status) {
    case undefined:
      return 'waiting';
    case 'running':
      return 'in progress';
    case 'reused':
      return 'reused from the previous search';
    case 'partial':
      return 'partly done';
    default:
      return status;
  }
}
