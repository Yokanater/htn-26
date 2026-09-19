/** Constrained collection engine. Owner: L2 (S2-L2-1). Design v3 §§5.2–5.3.
 * Deterministic: checks, money and ranking are code; no model call and no demand-based ranking.
 * Ranking order: required coverage, budget, unverified checks, optional coverage, relevance,
 * item subtotal, fewer merchants, then offer IDs so replay is stable.
 */
import {
  type CollectionMatch,
  type ConstraintCheck,
  type IntentBrief,
  type IntentSlot,
  newId,
  type ProductOffer,
  type SampleOrigin,
} from '@sei/contracts';
import { evaluateOffer } from './checks';
import { type NormalizedAttributes, normalizeOfferAttributes } from './normalize';
import { relevance } from './relevance';

export const MATCHING_LIMITS = { beamWidth: 20, candidatesPerSlot: 8, maxCollections: 3 } as const;

/** Offers retrieved for each slot, keyed by slot ID. */
export type SlotCandidates = Readonly<Record<string, readonly ProductOffer[]>>;

export interface MatchOptions {
  /** Set by the server/runner; offers from any other origin are excluded. */
  sampleOrigin: SampleOrigin;
  newMatchId?: () => string;
  /** Injection point for recorded/model-backed normalization; defaults to deterministic rules. */
  normalize?: (offer: ProductOffer) => NormalizedAttributes;
}

interface Candidate {
  offer: ProductOffer;
  variantKey: string;
  checks: ConstraintCheck[];
  unknown: number;
  relevance: number;
}

interface SlotPlan {
  slot: IntentSlot;
  candidates: Candidate[];
  /** Offers excluded by each failed check key (or `provenance`). */
  excluded: Map<string, number>;
  excludedOffers: number;
}

interface State {
  picks: (Candidate | null)[];
  requiredCovered: number;
  optionalCovered: number;
  overBudget: boolean;
  unknown: number;
  relevance: number;
  priced: number;
  merchants: number;
  ids: string;
}

const byId = (a: ProductOffer, b: ProductOffer) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    a.unknown - b.unknown ||
    b.relevance - a.relevance ||
    (a.offer.price?.amount ?? Number.POSITIVE_INFINITY) -
      (b.offer.price?.amount ?? Number.POSITIVE_INFINITY) ||
    byId(a.offer, b.offer)
  );
}

function planSlot(
  brief: IntentBrief,
  slot: IntentSlot,
  offers: readonly ProductOffer[],
  options: MatchOptions,
): SlotPlan {
  const normalize = options.normalize ?? normalizeOfferAttributes;
  const excluded = new Map<string, number>();
  const exclude = (key: string) => excluded.set(key, (excluded.get(key) ?? 0) + 1);
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  let excludedOffers = 0;
  for (const offer of [...offers].sort(byId)) {
    // One seller variant is one candidate; other sellers of the same product stay separate.
    const variantKey = JSON.stringify([offer.merchant.id, offer.productId, offer.variantId]);
    if (seen.has(variantKey)) continue;
    seen.add(variantKey);
    if (offer.sampleOrigin !== options.sampleOrigin) {
      exclude('provenance');
      excludedOffers += 1;
      continue;
    }
    const checks = evaluateOffer(brief, slot, offer, normalize(offer));
    const failed = checks.filter((check) => check.status === 'fail');
    if (failed.length > 0) {
      for (const key of new Set(failed.map((check) => check.key))) exclude(key);
      excludedOffers += 1;
      continue;
    }
    candidates.push({
      offer,
      variantKey,
      checks,
      unknown: checks.filter((check) => check.status === 'unknown').length,
      relevance: relevance(slot, offer),
    });
  }
  candidates.sort(compareCandidates);
  return {
    slot,
    candidates: candidates.slice(0, MATCHING_LIMITS.candidatesPerSlot),
    excluded,
    excludedOffers,
  };
}

function toState(plans: readonly SlotPlan[], picks: (Candidate | null)[], budget: number | null) {
  const chosen = picks.filter((pick): pick is Candidate => pick !== null);
  const priced = chosen.reduce((sum, pick) => sum + (pick.offer.price?.amount ?? 0), 0);
  const covered = (required: boolean) =>
    picks.filter((pick, index) => pick !== null && plans[index].slot.required === required).length;
  return {
    picks,
    requiredCovered: covered(true),
    optionalCovered: covered(false),
    overBudget: budget !== null && priced > budget,
    unknown: chosen.reduce((sum, pick) => sum + pick.unknown, 0),
    relevance: chosen.reduce((sum, pick) => sum + pick.relevance, 0),
    priced,
    merchants: new Set(chosen.map((pick) => pick.offer.merchant.id)).size,
    // An empty slot sorts after any offer ID.
    ids: picks.map((pick) => pick?.offer.id ?? '￿').join('\u0000'),
  } satisfies State;
}

function compareStates(a: State, b: State): number {
  return (
    b.requiredCovered - a.requiredCovered ||
    Number(a.overBudget) - Number(b.overBudget) ||
    a.unknown - b.unknown ||
    b.optionalCovered - a.optionalCovered ||
    b.relevance - a.relevance ||
    a.priced - b.priced ||
    a.merchants - b.merchants ||
    compareText(a.ids, b.ids)
  );
}

/** Beam search over slots; every slot also has an explicit "missing" option. */
function search(plans: readonly SlotPlan[], budget: number | null): State[] {
  let beam: State[] = [toState(plans, [], budget)];
  for (const plan of plans) {
    const next: State[] = [];
    for (const state of beam) {
      const used = new Set(state.picks.map((pick) => pick?.variantKey));
      for (const option of [...plan.candidates, null]) {
        if (option && used.has(option.variantKey)) continue;
        next.push(toState(plans, [...state.picks, option], budget));
      }
    }
    beam = next.sort(compareStates).slice(0, MATCHING_LIMITS.beamWidth);
  }
  return beam;
}

/** Best first; extra collections keep the best's coverage/budget and are not subsets of another. */
function choose(states: readonly State[]): State[] {
  const [best] = states;
  const chosen: State[] = [];
  for (const state of states) {
    if (chosen.length === MATCHING_LIMITS.maxCollections) break;
    if (state.requiredCovered < best.requiredCovered) break;
    if (state.overBudget && !best.overBudget) continue;
    const padded = chosen.some((other) =>
      state.picks.every((pick, index) => pick === null || pick === other.picks[index]),
    );
    if (!padded) chosen.push(state);
  }
  return chosen;
}

function provenanceWarning(origin: SampleOrigin): string[] {
  if (origin === 'seed') return ['Synthetic seed offers, not live catalog results'];
  if (origin === 'replay') return ['Replayed provider recording; product facts may be stale'];
  return [];
}

function toMatch(
  brief: IntentBrief,
  plans: readonly SlotPlan[],
  state: State,
  origin: SampleOrigin,
  id: string,
): CollectionMatch {
  const chosen = state.picks.filter((pick): pick is Candidate => pick !== null);
  const used = new Set(chosen.map((pick) => pick.variantKey));
  const warnings = provenanceWarning(origin);
  const slots = plans.map((plan, index) => {
    const pick = state.picks[index];
    const category = plan.slot.category;
    if (plan.excludedOffers > 0) {
      const reasons = [...plan.excluded]
        .sort(([a], [b]) => compareText(a, b))
        .map(([key, count]) => `${key}: ${count}`);
      const noun = plan.excludedOffers === 1 ? 'offer' : 'offers';
      warnings.push(
        `Slot "${category}": excluded ${plan.excludedOffers} ${noun} (${reasons.join(', ')})`,
      );
    }
    if (!pick) {
      warnings.push(
        `No offer selected for ${plan.slot.required ? 'required' : 'optional'} slot "${category}"`,
      );
    }
    return {
      slotId: plan.slot.id,
      selectedOfferId: pick?.offer.id ?? null,
      alternativeOfferIds: plan.candidates
        .filter((candidate) => !used.has(candidate.variantKey))
        .map((candidate) => candidate.offer.id),
      required: plan.slot.required,
      checks: pick?.checks ?? [],
    };
  });

  // Every remaining price is in the brief currency (other currencies fail the price check).
  const unpriced = chosen.some((pick) => pick.offer.price === null);
  const itemSubtotal =
    chosen.length === 0 || unpriced ? null : { amount: state.priced, currency: brief.currency };
  if (unpriced) warnings.push('Item subtotal unknown: a selected offer has no verified price');
  if (state.overBudget) warnings.push('Known item subtotal exceeds the item budget');
  if (state.unknown > 0) {
    warnings.push('Some selected items need verification before this collection is ready');
  }

  const ready =
    state.requiredCovered === plans.filter((plan) => plan.slot.required).length &&
    state.unknown === 0 &&
    itemSubtotal !== null &&
    !state.overBudget;
  return {
    id,
    briefId: brief.id,
    briefRevision: brief.revision,
    status: chosen.length === 0 ? 'no_match' : ready ? 'ready' : 'partial',
    slots,
    itemSubtotal,
    excludesShippingAndTax: true,
    warnings,
    sampleOrigin: origin,
  };
}

/** Confirmed brief + per-slot offers -> up to three collections, best first. */
export function matchCollections(
  brief: IntentBrief,
  candidates: SlotCandidates,
  options: MatchOptions,
): CollectionMatch[] {
  if (brief.status !== 'confirmed') {
    throw new Error('Matching requires a confirmed brief revision');
  }
  const plans = brief.slots.map((slot) =>
    planSlot(brief, slot, Object.hasOwn(candidates, slot.id) ? candidates[slot.id] : [], options),
  );
  const newMatchId = options.newMatchId ?? (() => newId('match_'));
  return choose(search(plans, brief.itemBudget?.amount ?? null)).map((state) =>
    toMatch(brief, plans, state, options.sampleOrigin, newMatchId()),
  );
}
