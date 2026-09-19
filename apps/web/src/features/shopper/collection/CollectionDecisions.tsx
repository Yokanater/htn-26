/** Accept / replace / reject, save and request-offer controls. Owner: L3 (S3-L3-1a). Design v3 §2, §6.1, §8.
 * Rendered only when FEATURE_DEMAND_LEDGER is effective and a handler is wired. One request is in
 * flight at a time and repeating the recorded choice sends nothing. The latest explicit choice per
 * slot wins; a rejected item stays listed and can be undone. A stale-revision 409 keeps the choice
 * so the shopper can re-apply it once the latest revision's collection is shown, and only if that
 * offer is still displayed. Consent is deliberately absent: decisions look and work the same either way.
 */
import { useEffect, useRef, useState } from 'react';
import {
  type CollectionIntent,
  collectionDecision,
  type DecisionHandler,
  type DecisionIntent,
  type DecisionResult,
  type DemandDecisionDto,
  type DisplayedCollection,
  type ItemIntent,
  isItemIntent,
  itemDecision,
  REJECTION_REASON_LABEL,
  REJECTION_REASONS,
  type RejectionReason,
  type SlotChoice,
  selectionKey,
} from './decisions';

interface StaleDecision {
  intent: DecisionIntent;
  /** Revision the refused decision was made against. */
  revision: number;
  title: string | null;
}

interface DecisionState {
  key: string | null;
  choices: Record<string, SlotChoice>;
  undone: Record<string, true>;
  /** Selection last recorded per collection action, so an identical repeat sends nothing. */
  recorded: Partial<Record<CollectionIntent['kind'], string>>;
  errorStatus: number | null;
}

const fresh = (key: string | null): DecisionState => ({
  key,
  choices: {},
  undone: {},
  recorded: {},
  errorStatus: null,
});

export interface DecisionController {
  enabled: boolean;
  shown: DisplayedCollection | null;
  choices: Readonly<Record<string, SlotChoice>>;
  undone: Readonly<Record<string, true>>;
  recorded: DecisionState['recorded'];
  errorStatus: number | null;
  stale: StaleDecision | null;
  pending: boolean;
  /** Resolves true once the server recorded the decision. */
  send: (intent: DecisionIntent) => Promise<boolean>;
  undoRejection: (slotId: string) => void;
  dismissStale: () => void;
}

function buildDto(
  shown: DisplayedCollection,
  intent: DecisionIntent,
  choices: Record<string, SlotChoice>,
): DemandDecisionDto | null {
  return isItemIntent(intent)
    ? itemDecision(shown, intent)
    : collectionDecision(shown, intent, choices);
}

function alreadyRecorded(state: DecisionState, intent: DecisionIntent, dto: DemandDecisionDto) {
  if (isItemIntent(intent)) {
    const choice = state.choices[intent.slotId];
    if (!choice || choice.offerId !== intent.offerId) return false;
    return intent.kind === 'item_accepted'
      ? choice.kind === 'accepted'
      : choice.kind === 'rejected' && choice.reason === intent.reason;
  }
  return state.recorded[intent.kind] === selectionKey(dto.selections);
}

function applyRecorded(
  state: DecisionState,
  intent: DecisionIntent,
  dto: DemandDecisionDto,
): DecisionState {
  if (!isItemIntent(intent)) {
    return {
      ...state,
      recorded: { ...state.recorded, [intent.kind]: selectionKey(dto.selections) },
    };
  }
  const choice: SlotChoice =
    intent.kind === 'item_accepted'
      ? { kind: 'accepted', offerId: intent.offerId }
      : { kind: 'rejected', offerId: intent.offerId, reason: intent.reason };
  const { [intent.slotId]: _undone, ...undone } = state.undone;
  return { ...state, choices: { ...state.choices, [intent.slotId]: choice }, undone };
}

export function useCollectionDecisions({
  enabled,
  shown,
  onDecision,
}: {
  enabled: boolean;
  shown: DisplayedCollection | null;
  onDecision: DecisionHandler | undefined;
}): DecisionController {
  const active = enabled && onDecision !== undefined;
  const key = active && shown ? `${shown.briefId}:${shown.briefRevision}:${shown.matchId}` : null;
  const [stored, setStored] = useState(() => fresh(key));
  // Choices belong to one displayed revision and match; a new one starts clean.
  const state = stored.key === key ? stored : fresh(key);
  if (stored.key !== key) setStored(state);
  const [stale, setStale] = useState<StaleDecision | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  }, [key]);

  const send = async (intent: DecisionIntent): Promise<boolean> => {
    if (!active || !shown || inFlight.current) return false;
    const dto = buildDto(shown, intent, state.choices);
    if (!dto || alreadyRecorded(state, intent, dto)) return false;
    const title = isItemIntent(intent)
      ? (shown.slots.get(intent.slotId)?.offers.get(intent.offerId)?.title ?? null)
      : null;
    inFlight.current = true;
    setPending(true);
    setStored((s) => (s.key === key ? { ...s, errorStatus: null } : s));
    let result: DecisionResult;
    try {
      result = await onDecision(dto);
    } catch {
      result = { ok: false, status: 0 };
    }
    inFlight.current = false;
    setPending(false);
    // A response for a collection that is no longer displayed must not change the current one.
    if (keyRef.current !== key) return false;
    if (result.ok) {
      setStale(null);
      setStored((s) => (s.key === key ? applyRecorded(s, intent, dto) : s));
      return true;
    }
    if (result.status === 409) setStale({ intent, revision: dto.briefRevision, title });
    else setStored((s) => (s.key === key ? { ...s, errorStatus: result.status } : s));
    return false;
  };

  const undoRejection = (slotId: string) =>
    setStored((s) => {
      if (s.key !== key || s.choices[slotId]?.kind !== 'rejected') return s;
      const { [slotId]: _rejected, ...choices } = s.choices;
      return { ...s, choices, undone: { ...s.undone, [slotId]: true } };
    });

  return {
    enabled: active,
    shown: active ? shown : null,
    choices: state.choices,
    undone: state.undone,
    recorded: state.recorded,
    errorStatus: state.errorStatus,
    stale: active ? stale : null,
    pending,
    send,
    undoRejection,
    dismissStale: () => setStale(null),
  };
}

export function SlotDecisionControls({
  controller,
  slotId,
  category,
}: {
  controller: DecisionController;
  slotId: string;
  category: string;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<RejectionReason | null>(null);
  const slot = controller.shown?.slots.get(slotId);
  if (!controller.enabled || !slot) return null;
  const choice = controller.choices[slotId];
  const offerId = choice?.offerId ?? slot.proposedOfferId;
  const offer = offerId === null ? undefined : slot.offers.get(offerId);
  if (!offer) return null;
  const accepted = choice?.kind === 'accepted';

  const reject = async () => {
    if (!reason) return;
    const intent: ItemIntent = { kind: 'item_rejected', slotId, offerId: offer.id, reason };
    if (await controller.send(intent)) {
      setRejecting(false);
      setReason(null);
    }
  };

  return (
    <fieldset aria-label={`Your choice for ${category}`} data-decision={choice?.kind ?? 'none'}>
      <p aria-live="polite">
        {choice?.kind === 'accepted' && `Accepted: ${offer.title}.`}
        {choice?.kind === 'rejected' &&
          `Rejected: ${offer.title} (${REJECTION_REASON_LABEL[choice.reason]}). It stays listed so you can undo.`}
        {!choice &&
          (controller.undone[slotId]
            ? 'Rejection undone. Accept or replace this item to record a new choice.'
            : 'No choice yet.')}
      </p>
      {choice?.kind === 'rejected' ? (
        <button onClick={() => controller.undoRejection(slotId)} type="button">
          Undo rejection
        </button>
      ) : (
        <>
          <button
            aria-label={`Accept ${offer.title}`}
            aria-pressed={accepted}
            disabled={controller.pending || accepted}
            onClick={() =>
              void controller.send({ kind: 'item_accepted', slotId, offerId: offer.id })
            }
            type="button"
          >
            {accepted ? 'Accepted' : 'Accept'}
          </button>
          <button
            aria-expanded={rejecting}
            aria-label={`Reject ${offer.title}`}
            disabled={controller.pending}
            onClick={() => setRejecting((open) => !open)}
            type="button"
          >
            Reject
          </button>
        </>
      )}
      {rejecting && choice?.kind !== 'rejected' && (
        <fieldset>
          <legend>Why doesn't {offer.title} work?</legend>
          {REJECTION_REASONS.map((code) => (
            <label key={code}>
              <input
                checked={reason === code}
                name={`reject-${slotId}`}
                onChange={() => setReason(code)}
                type="radio"
                value={code}
              />
              {REJECTION_REASON_LABEL[code]}
            </label>
          ))}
          <button
            disabled={!reason || controller.pending}
            onClick={() => void reject()}
            type="button"
          >
            Confirm rejection
          </button>
          <button onClick={() => setRejecting(false)} type="button">
            Keep it
          </button>
        </fieldset>
      )}
    </fieldset>
  );
}

/** "Replace" for one displayed alternative: an explicit accept of that offer for the slot. */
export function ReplaceButton({
  controller,
  slotId,
  offerId,
}: {
  controller: DecisionController;
  slotId: string;
  offerId: string;
}) {
  const offer = controller.shown?.slots.get(slotId)?.offers.get(offerId);
  if (!controller.enabled || !offer) return null;
  const choice = controller.choices[slotId];
  const current = choice?.kind === 'accepted' && choice.offerId === offerId;
  return (
    <button
      aria-label={`Use ${offer.title} instead`}
      aria-pressed={current}
      disabled={controller.pending || current}
      onClick={() => void controller.send({ kind: 'item_accepted', slotId, offerId })}
      type="button"
    >
      {current ? 'Accepted' : 'Use this instead'}
    </button>
  );
}

function staleIntentText(stale: StaleDecision): string {
  switch (stale.intent.kind) {
    case 'item_accepted':
      return `Accept ${stale.title ?? 'item'}`;
    case 'item_rejected':
      return `Reject ${stale.title ?? 'item'} (${REJECTION_REASON_LABEL[stale.intent.reason]})`;
    case 'collection_saved':
      return 'Save selection';
    case 'offer_requested':
      return 'Request offer';
  }
}

function StaleRecovery({
  controller,
  stale,
  onRefreshBrief,
}: {
  controller: DecisionController;
  stale: StaleDecision;
  onRefreshBrief?: () => void;
}) {
  const shown = controller.shown;
  const action = staleIntentText(stale);
  if (!shown || shown.briefRevision === stale.revision) {
    return (
      <div role="alert">
        <p>Your brief changed after these results were shown, so “{action}” was not recorded.</p>
        {onRefreshBrief ? (
          <button onClick={onRefreshBrief} type="button">
            Load latest version
          </button>
        ) : (
          <p>Reload the page to see the latest version.</p>
        )}
      </div>
    );
  }
  const intent = stale.intent;
  const stillShown =
    !isItemIntent(intent) || shown.slots.get(intent.slotId)?.offers.has(intent.offerId) === true;
  return (
    <div role="alert">
      {stillShown ? (
        <>
          <p>You're now seeing revision {shown.briefRevision} of your brief.</p>
          <button
            disabled={controller.pending}
            onClick={() => void controller.send(intent)}
            type="button"
          >
            Re-apply: {action}
          </button>
        </>
      ) : (
        <p>
          {stale.title ?? 'That product'} isn't shown for this item in the updated results. Choose
          again below.
        </p>
      )}
      <button onClick={controller.dismissStale} type="button">
        Dismiss
      </button>
    </div>
  );
}

export function CollectionDecisionBar({
  controller,
  onRefreshBrief,
}: {
  controller: DecisionController;
  onRefreshBrief?: () => void;
}) {
  const { shown, stale } = controller;
  if (!controller.enabled || (!shown && !stale)) return null;
  const save = shown && collectionDecision(shown, { kind: 'collection_saved' }, controller.choices);
  const current = save ? selectionKey(save.selections) : null;
  const saved = current !== null && controller.recorded.collection_saved === current;
  const requested = current !== null && controller.recorded.offer_requested === current;
  return (
    <section aria-label="Save or request an offer">
      {stale && (
        <StaleRecovery controller={controller} onRefreshBrief={onRefreshBrief} stale={stale} />
      )}
      {controller.errorStatus !== null && (
        <p role="alert">
          {controller.errorStatus === 0
            ? "Couldn't reach the server. Your choice was not recorded; try again."
            : `Your choice was not recorded (error ${controller.errorStatus}). Try again.`}
        </p>
      )}
      {shown && (
        <>
          <p>
            {save
              ? `${save.selections.length} item${save.selections.length === 1 ? '' : 's'} picked. Rejected items are left out.`
              : 'Every item is rejected. Accept or replace an item to save a selection.'}
          </p>
          <button
            disabled={!save || saved || controller.pending}
            onClick={() => void controller.send({ kind: 'collection_saved' })}
            type="button"
          >
            {saved ? 'Selection saved' : 'Save selection'}
          </button>
          <button
            disabled={!save || requested || controller.pending}
            onClick={() => void controller.send({ kind: 'offer_requested' })}
            type="button"
          >
            {requested ? 'Offer requested' : 'Request offer'}
          </button>
          <p>
            Requesting an offer asks these stores to respond. It is not an order: nothing is bought
            here, and opening a product link is only a visit to that store.
          </p>
        </>
      )}
    </section>
  );
}
