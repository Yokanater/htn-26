/** Explicit shopper decisions on a displayed collection. Owner: L3 (S3-L3-1a). Design v3 §2, §6.1, §8.
 * A decision names the current brief revision, the displayed match and an offer actually shown for
 * that slot; anything else is refused before it reaches the handler. The DTO is the shopper-supplied
 * part of `DemandEvent`: the server assigns id, session, time, origin and consent version, so this
 * module never reads or sends consent. An outbound store click is not a decision.
 */
import type { CollectionMatch, DemandEvent, IntentBrief, ProductOffer } from '@sei/contracts';

export type RejectionReason = NonNullable<DemandEvent['rejectionReason']>;
export type DemandSelection = DemandEvent['selections'][number];
export type DemandDecisionKind = Exclude<DemandEvent['kind'], 'brief_confirmed'>;

/** Body for POST /api/briefs/:id/decisions; completing it with server fields yields a `DemandEvent`. */
export type DemandDecisionDto = Pick<
  DemandEvent,
  'briefId' | 'briefRevision' | 'selections' | 'rejectionReason'
> & { kind: DemandDecisionKind; matchId: string };

/** 409 means the brief revision is stale; any other failure leaves the shopper's choice unchanged. */
export type DecisionResult = { ok: true } | { ok: false; status: number };
export type DecisionHandler = (dto: DemandDecisionDto) => Promise<DecisionResult>;

export const REJECTION_REASON_LABEL: Record<RejectionReason, string> = {
  price: 'Price',
  style: 'Style',
  size: 'Size',
  dimensions: 'Dimensions',
  material: 'Material',
  shipping: 'Shipping',
  availability: 'Availability',
  other: 'Other',
};
export const REJECTION_REASONS = Object.keys(REJECTION_REASON_LABEL) as RejectionReason[];

export interface DisplayedSlot {
  /** The collection's proposed offer, or null when the slot has only alternatives or nothing. */
  proposedOfferId: string | null;
  /** Proposed and alternative offers present in the result: the only IDs a decision may use. */
  offers: Map<string, ProductOffer>;
}

export interface DisplayedCollection {
  briefId: string;
  briefRevision: number;
  matchId: string;
  slots: Map<string, DisplayedSlot>;
}

/** What the shopper can see for this brief revision, or null when no current match is shown. */
export function displayedCollection(
  brief: Pick<IntentBrief, 'id' | 'revision' | 'slots'>,
  match: CollectionMatch | null,
  offers: readonly ProductOffer[],
): DisplayedCollection | null {
  if (!match || match.briefId !== brief.id || match.briefRevision !== brief.revision) return null;
  const byId = new Map(offers.map((offer) => [offer.id, offer]));
  const briefSlots = new Set(brief.slots.map((slot) => slot.id));
  const slots = new Map<string, DisplayedSlot>();
  for (const slot of match.slots) {
    if (!briefSlots.has(slot.slotId)) continue;
    const shown = new Map<string, ProductOffer>();
    for (const id of [slot.selectedOfferId, ...slot.alternativeOfferIds]) {
      const offer = id === null ? undefined : byId.get(id);
      if (offer) shown.set(offer.id, offer);
    }
    const proposed = slot.selectedOfferId !== null && shown.has(slot.selectedOfferId);
    slots.set(slot.slotId, {
      proposedOfferId: proposed ? slot.selectedOfferId : null,
      offers: shown,
    });
  }
  return { briefId: brief.id, briefRevision: brief.revision, matchId: match.id, slots };
}

export type SlotChoice =
  | { kind: 'accepted'; offerId: string }
  | { kind: 'rejected'; offerId: string; reason: RejectionReason };

export type ItemIntent =
  | { kind: 'item_accepted'; slotId: string; offerId: string }
  | { kind: 'item_rejected'; slotId: string; offerId: string; reason: RejectionReason };
export type CollectionIntent = { kind: 'collection_saved' | 'offer_requested' };
export type DecisionIntent = ItemIntent | CollectionIntent;

export function isItemIntent(intent: DecisionIntent): intent is ItemIntent {
  return intent.kind === 'item_accepted' || intent.kind === 'item_rejected';
}

function selection(shown: DisplayedCollection, slotId: string, offerId: string) {
  const offer = shown.slots.get(slotId)?.offers.get(offerId);
  return offer ? { slotId, offerId, merchantId: offer.merchant.id } : null;
}

/** An accept/replace/reject DTO, or null when the offer is not shown for that slot. */
export function itemDecision(
  shown: DisplayedCollection,
  intent: ItemIntent,
): DemandDecisionDto | null {
  const selected = selection(shown, intent.slotId, intent.offerId);
  if (!selected) return null;
  return {
    briefId: shown.briefId,
    briefRevision: shown.briefRevision,
    kind: intent.kind,
    matchId: shown.matchId,
    selections: [selected],
    rejectionReason: intent.kind === 'item_rejected' ? intent.reason : null,
  };
}

/** Each slot's current pick: the latest explicit choice, else the proposed offer; rejected slots are left out. */
export function currentSelections(
  shown: DisplayedCollection,
  choices: Readonly<Record<string, SlotChoice>>,
): DemandSelection[] {
  const picks: DemandSelection[] = [];
  for (const [slotId, slot] of shown.slots) {
    const choice = choices[slotId];
    if (choice?.kind === 'rejected') continue;
    const offerId = choice?.offerId ?? slot.proposedOfferId;
    const picked = offerId === null ? null : selection(shown, slotId, offerId);
    if (picked) picks.push(picked);
  }
  return picks;
}

/** A save/request-offer DTO over the current picks, or null when nothing is picked. */
export function collectionDecision(
  shown: DisplayedCollection,
  intent: CollectionIntent,
  choices: Readonly<Record<string, SlotChoice>>,
): DemandDecisionDto | null {
  const selections = currentSelections(shown, choices);
  if (selections.length === 0) return null;
  return {
    briefId: shown.briefId,
    briefRevision: shown.briefRevision,
    kind: intent.kind,
    matchId: shown.matchId,
    selections,
    rejectionReason: null,
  };
}

export function selectionKey(selections: readonly DemandSelection[]): string {
  return selections.map((s) => `${s.slotId}=${s.offerId}`).join('|');
}

/**
 * Body for POST /api/briefs/:id/decisions, mapped field by field.
 *
 * The server's schema is strict and derives identity, time, origin and each selection's
 * merchant from the offer it actually displayed. Spreading the DTO would send `briefId` and
 * a selection's `merchantId`, which the server rejects outright, so every decision would
 * fail. `idempotencyKey` must be fresh per action: deriving it from the choice makes a
 * later accept collide with an earlier one, leaving the ledger on the first outcome while
 * the shopper is told the new one was recorded.
 */
export function decisionRequestBody(
  dto: DemandDecisionDto,
  runId: string | null,
  idempotencyKey: string,
) {
  return {
    idempotencyKey,
    briefRevision: dto.briefRevision,
    runId,
    matchId: dto.matchId,
    kind: dto.kind,
    selections: dto.selections.map((selection) => ({
      slotId: selection.slotId,
      offerId: selection.offerId,
    })),
    rejectionReason: dto.rejectionReason,
  };
}
