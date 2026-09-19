/** VisionDraft -> draft IntentBrief. Owner: L3. Design v3 §§4, 5.1.
 * Code owns identity, revision, status, provenance and constraints; the model only describes items.
 * Sizes, dimensions and mounting come from the shopper later, never from the model.
 */
import {
  type IntentBrief,
  IntentBriefSchema,
  type IntentSlot,
  newId,
  type SampleOrigin,
  type ShoppingDomain,
} from '@sei/contracts';
import type { VisionDraft } from './ports';

export const INTENT_LIMITS = {
  maxSlots: 6,
  category: 80,
  description: 500,
  attributes: 12,
  attribute: 80,
} as const;

export type IntentIdFactory = (prefix: 'brief_' | 'slot_') => string;

export interface MapVisionDraftInput {
  domain: ShoppingDomain;
  input: IntentBrief['input'];
  country: string;
  currency: string;
  sampleOrigin: SampleOrigin;
  createdAt: Date;
  ids?: IntentIdFactory;
}

export type MapVisionDraftResult =
  | { ok: true; brief: IntentBrief }
  | { ok: false; issues: string[] };

const defaultIds: IntentIdFactory = (prefix) => newId(prefix);

/** Collapse whitespace, drop control characters, and cut to `max` UTF-16 units without
 * splitting a surrogate pair. */
export function cleanText(value: string, max: number): string {
  const printable = Array.from(value, (char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? ' ' : char;
  }).join('');
  const collapsed = printable.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  let cut = collapsed.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut.trimEnd();
}

function cleanAttributes(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const attribute = cleanText(value, INTENT_LIMITS.attribute);
    const key = attribute.toLowerCase();
    if (!attribute || seen.has(key)) continue;
    seen.add(key);
    out.push(attribute);
    if (out.length === INTENT_LIMITS.attributes) break;
  }
  return out;
}

/** Deterministic mapping. Returns schema issues instead of throwing so the caller can repair. */
export function mapVisionDraft(
  draft: VisionDraft,
  options: MapVisionDraftInput,
): MapVisionDraftResult {
  const ids = options.ids ?? defaultIds;
  const seen = new Set<string>();
  const slots: IntentSlot[] = [];
  for (const draftSlot of draft.slots) {
    const category = cleanText(draftSlot.category, INTENT_LIMITS.category);
    if (!category) continue;
    const description = cleanText(draftSlot.description, INTENT_LIMITS.description) || category;
    const key = JSON.stringify([category.toLowerCase(), description.toLowerCase()]);
    if (seen.has(key)) continue;
    seen.add(key);
    slots.push({
      id: ids('slot_'),
      category,
      description,
      required: draftSlot.requiredSuggested,
      visualAttributes: cleanAttributes(draftSlot.visualAttributes),
      constraints: [],
    });
    if (slots.length === INTENT_LIMITS.maxSlots) break;
  }
  // `requiredSuggested` is advice; the shopper confirms later, but a draft needs one anchor.
  const firstSlot = slots[0];
  if (firstSlot && !slots.some((slot) => slot.required)) firstSlot.required = true;

  const candidate: IntentBrief = {
    id: ids('brief_'),
    domain: options.domain,
    revision: 1,
    status: 'draft',
    input: options.input,
    slots,
    country: options.country,
    currency: options.currency,
    itemBudget: null,
    sampleOrigin: options.sampleOrigin,
    createdAt: options.createdAt.toISOString(),
  };
  const parsed = IntentBriefSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    };
  }
  return { ok: true, brief: parsed.data };
}
