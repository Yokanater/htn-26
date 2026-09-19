/** Evidence-bounded collection explanations. Owner: L3 (S2-L3-1). Design v3 §5.3, §7.
 * The template explainer states only offer facts and the matcher's computed checks, each citing
 * evidence of the selected offer. An injected model explainer may add summary wording, but every
 * line is validated: unknown or foreign evidence IDs, uncited facts, unsupported numbers and
 * forbidden claims (shipping/tax included, probabilities, exact replicas) are rejected.
 */
import type {
  CollectionMatch,
  IntentBrief,
  ProductEvidence,
  ProductOffer,
  SlotMatch,
} from '@sei/contracts';
import type { ShoppingContext } from '@sei/core';

/** Code-derived: `product_fact` (cited offer fact), `computed_check` (matcher check),
 * `computed_summary` (counts/arithmetic over the match), `missing` (a stated gap).
 * `model_summary` is a model judgment. Facts and model wording must cite evidence. */
export type ExplanationBasis =
  | 'product_fact'
  | 'computed_check'
  | 'computed_summary'
  | 'model_summary'
  | 'missing';

const CITATION_REQUIRED: ReadonlySet<ExplanationBasis> = new Set(['product_fact', 'model_summary']);

export interface ExplanationLine {
  text: string;
  basis: ExplanationBasis;
  evidenceIds: string[];
}

export type SlotExplanationState = 'selected' | 'needs_verification' | 'not_met' | 'missing';

export interface SlotExplanation {
  slotId: string;
  category: string;
  required: boolean;
  state: SlotExplanationState;
  lines: ExplanationLine[];
}

export interface CollectionExplanation {
  matchId: string;
  summary: ExplanationLine[];
  slots: SlotExplanation[];
}

export interface ExplainCollectionInput {
  brief: IntentBrief;
  match: CollectionMatch;
  offers: readonly ProductOffer[];
}

/** Optional model-backed explainer. Its output is validated and replaced by the template on failure. */
export interface CollectionExplainer {
  explain(input: ExplainCollectionInput, context: ShoppingContext): Promise<CollectionExplanation>;
}

export const MAX_EXPLANATION_CHARS = 300;

const FACT_FIELDS = {
  price: ['price', 'product_record'],
  availability: ['availability', 'product_record'],
} as const;

const FORBIDDEN_CLAIMS: readonly [RegExp, string][] = [
  [/\b(free|included|includes)\s+(shipping|delivery)\b/i, 'claims shipping is included'],
  [
    /\b(shipping|delivery|tax|taxes)\s+(is\s+|are\s+)?included\b/i,
    'claims shipping/tax is included',
  ],
  [
    /\b(probability|likelihood|\d+\s*%\s*(match|likely|chance))\b/i,
    'describes a score as a probability',
  ],
  [/\b(exact|identical|perfect)\s+(match|replica|copy)\b/i, 'promises an exact replica'],
  [/\b(guaranteed?|will fit)\b/i, 'makes an unsupported guarantee'],
];

/** Minor units -> localized amount, using the currency's own fraction digits. No conversion. */
export function formatMoney(amount: number, currency: string): string {
  const format = new Intl.NumberFormat('en-CA', { style: 'currency', currency });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return `${currency} ${(amount / 10 ** digits).toFixed(digits)}`;
}

function evidenceFor(offer: ProductOffer, fields: readonly string[]): string[] {
  return offer.evidence.filter((ev) => fields.includes(ev.field)).map((ev) => ev.id);
}

function checkLine(check: SlotMatch['checks'][number]): ExplanationLine {
  const prefix =
    check.status === 'pass'
      ? 'Meets'
      : check.status === 'fail'
        ? 'Does not meet'
        : 'Needs verification';
  const uncited = check.evidenceIds.length === 0 ? ' (no captured evidence)' : '';
  return {
    text: `${prefix} ${check.key}: ${check.explanation}${uncited}`,
    basis: 'computed_check',
    evidenceIds: [...check.evidenceIds],
  };
}

function slotState(slot: SlotMatch): SlotExplanationState {
  if (slot.selectedOfferId === null) return 'missing';
  if (slot.checks.some((check) => check.status === 'fail')) return 'not_met';
  if (slot.checks.some((check) => check.status === 'unknown')) return 'needs_verification';
  return 'selected';
}

/** Deterministic, model-free explanation from offer facts and computed checks. */
export function explainCollection({
  brief,
  match,
  offers,
}: ExplainCollectionInput): CollectionExplanation {
  const byId = new Map(offers.map((offer) => [offer.id, offer]));
  const briefSlots = new Map(brief.slots.map((slot) => [slot.id, slot]));
  const slots = match.slots.map((slotMatch): SlotExplanation => {
    const slot = briefSlots.get(slotMatch.slotId);
    const category = slot?.category ?? 'item';
    const offer = slotMatch.selectedOfferId ? byId.get(slotMatch.selectedOfferId) : undefined;
    const lines: ExplanationLine[] = [];
    if (!offer) {
      lines.push({
        text: `No eligible ${category} was found${slotMatch.required ? ' for this required item' : ''}.`,
        basis: 'missing',
        evidenceIds: [],
      });
    } else {
      const priceEvidence = evidenceFor(offer, FACT_FIELDS.price);
      if (offer.price && priceEvidence.length) {
        lines.push({
          text: `${offer.title} from ${offer.merchant.name} (${offer.merchant.domain}), listed at ${formatMoney(offer.price.amount, offer.price.currency)} before shipping and tax.`,
          basis: 'product_fact',
          evidenceIds: priceEvidence,
        });
      } else {
        lines.push({
          text: `${offer.title} from ${offer.merchant.name} (${offer.merchant.domain}); price needs verification.`,
          basis: 'missing',
          evidenceIds: [],
        });
      }
      const availabilityEvidence = evidenceFor(offer, FACT_FIELDS.availability);
      if (offer.availability === 'unknown' || !availabilityEvidence.length) {
        lines.push({ text: 'Availability needs verification.', basis: 'missing', evidenceIds: [] });
      }
      lines.push(...slotMatch.checks.map(checkLine));
    }
    return {
      slotId: slotMatch.slotId,
      category,
      required: slotMatch.required,
      state: slotState(slotMatch),
      lines,
    };
  });

  const selected = match.slots.filter((slot) => slot.selectedOfferId !== null).length;
  const summary: ExplanationLine[] = [
    {
      text: `${selected} of ${match.slots.length} items selected across ${new Set(match.slots.flatMap((slot) => (slot.selectedOfferId ? [byId.get(slot.selectedOfferId)?.merchant.domain] : []))).size} store(s).`,
      basis: 'computed_summary',
      evidenceIds: [],
    },
  ];
  if (match.itemSubtotal) {
    const pricedEvidence = match.slots.flatMap((slot) => {
      const offer = slot.selectedOfferId ? byId.get(slot.selectedOfferId) : undefined;
      return offer?.price ? evidenceFor(offer, FACT_FIELDS.price) : [];
    });
    summary.push({
      text: `Known item subtotal ${formatMoney(match.itemSubtotal.amount, match.itemSubtotal.currency)}; excludes shipping and tax, which each store sets.`,
      basis: 'computed_summary',
      evidenceIds: pricedEvidence,
    });
  } else {
    summary.push({
      text: 'Item subtotal unavailable: at least one selected price is unknown or missing.',
      basis: 'missing',
      evidenceIds: [],
    });
  }
  return { matchId: match.id, summary, slots };
}

function numbersIn(text: string): string[] {
  return text.match(/\d+(?:[.,]\d+)?/g) ?? [];
}

interface LineScope {
  /** Evidence of the selected offer(s) this line may cite. */
  evidence: readonly ProductEvidence[];
  /** Plain-text facts a model line may quote numbers from. */
  facts: string;
}

/** Issues for one line; empty means the line is bounded by its scope. */
function lineIssues(line: ExplanationLine, scope: LineScope): string[] {
  const issues: string[] = [];
  if (!line.text.trim() || line.text.length > MAX_EXPLANATION_CHARS) {
    issues.push(`text must be 1-${MAX_EXPLANATION_CHARS} characters`);
  }
  if (CITATION_REQUIRED.has(line.basis) && line.evidenceIds.length === 0) {
    issues.push(`${line.basis} line cites no evidence`);
  }
  const allowed = new Set(scope.evidence.map((ev) => ev.id));
  if (line.evidenceIds.some((id) => !allowed.has(id))) {
    issues.push('cites evidence outside the selected offer');
  }
  for (const [pattern, reason] of FORBIDDEN_CLAIMS) {
    if (pattern.test(line.text)) issues.push(reason);
  }
  if (line.basis === 'model_summary') {
    const cited = scope.evidence
      .filter((ev) => line.evidenceIds.includes(ev.id))
      .map((ev) => ev.value)
      .join(' ');
    const facts = `${cited} ${scope.facts}`;
    if (numbersIn(line.text).some((number) => !facts.includes(number))) {
      issues.push('unsupported quantity');
    }
  }
  return issues;
}

function scopes(match: CollectionMatch, offers: readonly ProductOffer[]) {
  const byId = new Map(offers.map((offer) => [offer.id, offer]));
  const selected = (slot: SlotMatch) =>
    slot.selectedOfferId ? byId.get(slot.selectedOfferId) : undefined;
  const factsOf = (offer: ProductOffer | undefined) =>
    offer
      ? [
          offer.title,
          offer.price ? formatMoney(offer.price.amount, offer.price.currency) : '',
          ...Object.values(offer.attributes).map(String),
        ]
      : [];
  const slotScope = (slot: SlotMatch): LineScope => ({
    evidence: selected(slot)?.evidence ?? [],
    facts: factsOf(selected(slot)).join(' '),
  });
  const summaryScope: LineScope = {
    evidence: match.slots.flatMap((slot) => selected(slot)?.evidence ?? []),
    facts: [
      ...match.slots.flatMap((slot) => factsOf(selected(slot))),
      match.itemSubtotal ? formatMoney(match.itemSubtotal.amount, match.itemSubtotal.currency) : '',
      String(match.slots.length),
      String(match.slots.filter((slot) => slot.selectedOfferId !== null).length),
    ].join(' '),
  };
  return { slotScope, summaryScope };
}

/** Returns issues; an empty list means the explanation is bounded by the match and its evidence. */
export function checkExplanation(
  explanation: CollectionExplanation,
  { match, offers }: Omit<ExplainCollectionInput, 'brief'>,
): string[] {
  const issues: string[] = [];
  const { slotScope, summaryScope } = scopes(match, offers);
  if (explanation.matchId !== match.id) issues.push('matchId: does not match the collection');
  const explained = new Map(explanation.slots.map((slot) => [slot.slotId, slot]));
  if (explained.size !== explanation.slots.length) issues.push('slots: duplicate slot explanation');
  for (const slotId of explained.keys()) {
    if (!match.slots.some((slot) => slot.slotId === slotId)) {
      issues.push('slots: unknown slot explained');
    }
  }
  for (const [index, slot] of match.slots.entries()) {
    const slotExplanation = explained.get(slot.slotId);
    if (!slotExplanation) {
      issues.push(`slots.${index}: missing explanation`);
      continue;
    }
    if (slotExplanation.state !== slotState(slot)) {
      issues.push(`slots.${index}: state disagrees with checks`);
    }
    slotExplanation.lines.forEach((line, lineIndex) => {
      for (const issue of lineIssues(line, slotScope(slot))) {
        issues.push(`slots.${index}.lines.${lineIndex}: ${issue}`);
      }
    });
  }
  explanation.summary.forEach((line, lineIndex) => {
    for (const issue of lineIssues(line, summaryScope)) {
      issues.push(`summary.lines.${lineIndex}: ${issue}`);
    }
  });
  return issues;
}

/** Drops individual lines that are not bounded by the match and its evidence. Use for the
 * template explanation, whose structure is correct by construction but whose check text comes
 * from the matcher. Returns how many lines were dropped. */
export function boundExplanation(
  explanation: CollectionExplanation,
  { match, offers }: Omit<ExplainCollectionInput, 'brief'>,
): { explanation: CollectionExplanation; dropped: number } {
  const { slotScope, summaryScope } = scopes(match, offers);
  const matchSlots = new Map(match.slots.map((slot) => [slot.slotId, slot]));
  let dropped = 0;
  const keep = (lines: readonly ExplanationLine[], scope: LineScope) =>
    lines.filter((line) => {
      const ok = lineIssues(line, scope).length === 0;
      if (!ok) dropped += 1;
      return ok;
    });
  const slots = explanation.slots.map((slot) => {
    const matchSlot = matchSlots.get(slot.slotId);
    return matchSlot ? { ...slot, lines: keep(slot.lines, slotScope(matchSlot)) } : slot;
  });
  return {
    explanation: { ...explanation, slots, summary: keep(explanation.summary, summaryScope) },
    dropped,
  };
}

/** The template explainer as a `CollectionExplainer`; it never calls a model or spends budget. */
export const templateExplainer: CollectionExplainer = {
  async explain(input) {
    return explainCollection(input);
  },
};
