/** Boundary checks on matcher output. Owner: L3 (S2-L3-1). Guide §4: parsing a schema does not
 * prove offer membership, revision, provenance or arithmetic, so each is checked here.
 */
import {
  type CollectionMatch,
  CollectionMatchSchema,
  type IntentBrief,
  type ProductOffer,
} from '@sei/contracts';

/** Returns issue codes; empty means the match may be shown for this brief revision. */
export function matchIssues(
  candidate: unknown,
  brief: IntentBrief,
  offers: ReadonlyMap<string, ProductOffer>,
): string[] {
  const parsed = CollectionMatchSchema.safeParse(candidate);
  if (!parsed.success) return ['schema'];
  const match: CollectionMatch = parsed.data;
  const issues: string[] = [];
  if (match.briefId !== brief.id || match.briefRevision !== brief.revision) issues.push('revision');
  if (match.sampleOrigin !== brief.sampleOrigin) issues.push('sample_origin');

  const briefSlots = new Map(brief.slots.map((slot) => [slot.id, slot]));
  if (
    match.slots.length !== brief.slots.length ||
    match.slots.some((slot) => briefSlots.get(slot.slotId)?.required !== slot.required)
  ) {
    issues.push('slots');
  }

  let subtotal = 0;
  let mixedCurrency = false;
  for (const slot of match.slots) {
    const referenced = [slot.selectedOfferId, ...slot.alternativeOfferIds].filter(
      (id): id is string => id !== null,
    );
    if (referenced.some((id) => !offers.has(id))) issues.push('unknown_offer');
    if (slot.selectedOfferId && slot.alternativeOfferIds.includes(slot.selectedOfferId)) {
      issues.push('duplicate_offer');
    }
    const slotEvidence = new Set(
      referenced.flatMap((id) => offers.get(id)?.evidence.map((ev) => ev.id) ?? []),
    );
    if (slot.checks.some((check) => check.evidenceIds.some((id) => !slotEvidence.has(id)))) {
      issues.push('foreign_evidence');
    }
    const selected = slot.selectedOfferId ? offers.get(slot.selectedOfferId) : undefined;
    if (!selected) continue;
    if (selected.sampleOrigin !== brief.sampleOrigin) issues.push('sample_origin');
    if (match.status === 'ready' && selected.availability !== 'available') {
      issues.push('ready_unavailable');
    }
    if (selected.price) {
      if (selected.price.currency !== brief.currency) mixedCurrency = true;
      else subtotal += selected.price.amount;
    }
  }
  if (mixedCurrency) issues.push('mixed_currency');
  if (
    match.itemSubtotal &&
    (match.itemSubtotal.currency !== brief.currency || match.itemSubtotal.amount !== subtotal)
  ) {
    issues.push('subtotal');
  }
  return [...new Set(issues)];
}
