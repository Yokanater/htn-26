/** Hard-constraint checks per offer. Owner: L2 (S2-L2-1). Design v3 §5.2.
 * A known violation is `fail` and excludes the offer; missing data is `unknown`, never a pass.
 * Unknown checks cite no evidence. Decided checks cite evidence recorded for the same field,
 * falling back to a whole `product_record` capture.
 */
import type {
  ConstraintCheck,
  IntentBrief,
  IntentSlot,
  ItemConstraint,
  ProductOffer,
} from '@sei/contracts';
import {
  canonicalKey,
  type DimensionAxis,
  LETTER_SIZES,
  type MountingKind,
  type NormalizedAttributes,
  normalizeOfferAttributes,
  normalizeSize,
} from './normalize';

/**
 * Check keys, provisional until the shared list lands in `@sei/contracts` (L1 editor, L2 review).
 * Constraint checks with a qualifier use `dimension:<axis>` and `exclude_material:<material>`.
 */
export const CHECK_KEYS = {
  price: 'price',
  availability: 'availability',
  shipsTo: 'ships_to',
  size: 'size',
  mounting: 'mounting',
} as const;

const RECORD_FIELD = 'product_record';
type Status = ConstraintCheck['status'];

function check(
  offer: ProductOffer,
  key: string,
  status: Status,
  fields: readonly string[],
  explanation: string,
): ConstraintCheck {
  if (status === 'unknown') return { key, status, evidenceIds: [], explanation };
  const evidence = offer.evidence.map((item) => ({ id: item.id, field: canonicalKey(item.field) }));
  const direct = evidence.filter((item) => fields.includes(item.field));
  const cited = direct.length > 0 ? direct : evidence.filter((item) => item.field === RECORD_FIELD);
  return { key, status, evidenceIds: cited.map((item) => item.id), explanation };
}

function priceCheck(brief: IntentBrief, offer: ProductOffer): ConstraintCheck {
  const fields = ['price'];
  if (!offer.price) {
    return check(offer, CHECK_KEYS.price, 'unknown', fields, 'No verified price for this variant');
  }
  if (offer.price.currency !== brief.currency) {
    return check(
      offer,
      CHECK_KEYS.price,
      'fail',
      fields,
      `Priced in ${offer.price.currency}; the brief uses ${brief.currency} and prices are never converted`,
    );
  }
  return check(
    offer,
    CHECK_KEYS.price,
    'pass',
    fields,
    `Priced in ${brief.currency}, the brief currency`,
  );
}

function availabilityCheck(offer: ProductOffer): ConstraintCheck {
  const fields = ['availability', 'inventory'];
  const key = CHECK_KEYS.availability;
  if (offer.availability === 'available')
    return check(offer, key, 'pass', fields, 'Listed as available');
  if (offer.availability === 'unavailable')
    return check(offer, key, 'fail', fields, 'Listed as unavailable');
  return check(offer, key, 'unknown', fields, 'Availability not verified');
}

function shippingCheck(brief: IntentBrief, offer: ProductOffer): ConstraintCheck {
  const fields = ['shipping', 'ships_to', 'shipping_countries'];
  const key = CHECK_KEYS.shipsTo;
  if (offer.shipsTo === null)
    return check(offer, key, 'unknown', fields, 'Shipping destinations not verified');
  if (offer.shipsTo.includes(brief.country))
    return check(offer, key, 'pass', fields, `Ships to ${brief.country}`);
  return check(offer, key, 'fail', fields, `Does not list shipping to ${brief.country}`);
}

const NUMERIC_SIZE = /^\d+(\.\d+)?$/;

function sizeCheck(offer: ProductOffer, requested: string, actual: string | null) {
  const fields = ['size', 'variant'];
  const key = CHECK_KEYS.size;
  const wanted = normalizeSize(requested);
  if (actual === null) return check(offer, key, 'unknown', fields, 'Variant size not verified');
  if (actual === wanted) {
    return check(
      offer,
      key,
      'pass',
      fields,
      `Variant size ${actual} matches requested size ${wanted}`,
    );
  }
  const comparable =
    (LETTER_SIZES.has(actual) && LETTER_SIZES.has(wanted)) ||
    (NUMERIC_SIZE.test(actual) && NUMERIC_SIZE.test(wanted));
  return comparable
    ? check(
        offer,
        key,
        'fail',
        fields,
        `Variant size ${actual} does not match requested size ${wanted}`,
      )
    : check(
        offer,
        key,
        'unknown',
        fields,
        `Variant size ${actual} cannot be compared with requested size ${wanted}`,
      );
}

const formatCm = (value: number) => String(Math.round(value * 10) / 10);

function dimensionCheck(
  offer: ProductOffer,
  axis: DimensionAxis,
  maxCm: number,
  actual: number | null,
): ConstraintCheck {
  const fields = [axis, `${axis}_cm`, `${axis}_mm`, `${axis}_in`, 'dimensions'];
  const key = `dimension:${axis}`;
  const label = axis[0].toUpperCase() + axis.slice(1);
  if (actual === null) return check(offer, key, 'unknown', fields, `${label} not verified`);
  const measured = `${label} ${formatCm(actual)} cm`;
  return actual <= maxCm
    ? check(offer, key, 'pass', fields, `${measured} is within the ${formatCm(maxCm)} cm maximum`)
    : check(offer, key, 'fail', fields, `${measured} exceeds the ${formatCm(maxCm)} cm maximum`);
}

const MOUNTING_LABELS: Record<MountingKind, string> = {
  freestanding: 'freestanding',
  no_drilling: 'no drilling',
  requires_drilling: 'requires drilling',
};

function mountingCheck(
  offer: ProductOffer,
  wanted: 'no_drilling' | 'freestanding',
  actual: MountingKind | null,
): ConstraintCheck {
  const fields = ['mounting', 'installation'];
  const key = CHECK_KEYS.mounting;
  const request = MOUNTING_LABELS[wanted];
  if (actual === null) return check(offer, key, 'unknown', fields, 'Mounting method not verified');
  if (actual === 'requires_drilling')
    return check(offer, key, 'fail', fields, `Requires drilling; the brief asks for ${request}`);
  if (actual === 'no_drilling' && wanted === 'freestanding') {
    return check(
      offer,
      key,
      'unknown',
      fields,
      'Mounts without drilling; freestanding use not verified',
    );
  }
  return check(
    offer,
    key,
    'pass',
    fields,
    `Mounting (${MOUNTING_LABELS[actual]}) satisfies ${request}`,
  );
}

/** "faux leather" or "leather-free" mention the material without establishing it is present. */
const QUALIFIED_MATERIAL = /\b(faux|vegan|imitation|artificial|synthetic|free)\b/;

function materialCheck(
  offer: ProductOffer,
  excludedValue: string,
  materials: readonly string[] | null,
): ConstraintCheck {
  const fields = ['material', 'materials', 'fabric', 'composition'];
  const excluded = excludedValue.trim().toLowerCase();
  const key = `exclude_material:${excluded}`;
  if (materials === null) {
    return check(
      offer,
      key,
      'unknown',
      fields,
      `Materials not verified; cannot confirm no ${excluded}`,
    );
  }
  const mention = new RegExp(`\\b${excluded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const mentions = materials.filter((phrase) => mention.test(phrase));
  if (mentions.some((phrase) => !QUALIFIED_MATERIAL.test(phrase.replace(mention, ' ')))) {
    return check(offer, key, 'fail', fields, `Listed materials include ${excluded}`);
  }
  if (mentions.length > 0) {
    return check(
      offer,
      key,
      'unknown',
      fields,
      `Listed material needs review against excluded ${excluded}`,
    );
  }
  return check(offer, key, 'pass', fields, `Listed materials exclude ${excluded}`);
}

function constraintCheck(
  offer: ProductOffer,
  constraint: ItemConstraint,
  attributes: NormalizedAttributes,
): ConstraintCheck {
  switch (constraint.kind) {
    case 'size':
      return sizeCheck(offer, constraint.value, attributes.size);
    case 'dimension':
      return dimensionCheck(
        offer,
        constraint.axis,
        constraint.maxCm,
        attributes.dimensionsCm[constraint.axis],
      );
    case 'mounting':
      return mountingCheck(offer, constraint.value, attributes.mounting);
    case 'exclude_material':
      return materialCheck(offer, constraint.value, attributes.materials);
  }
}

/** Checks in a fixed order: price, availability, shipping, then the slot's own constraints. */
export function evaluateOffer(
  brief: IntentBrief,
  slot: IntentSlot,
  offer: ProductOffer,
  attributes: NormalizedAttributes = normalizeOfferAttributes(offer),
): ConstraintCheck[] {
  return [
    priceCheck(brief, offer),
    availabilityCheck(offer),
    shippingCheck(brief, offer),
    ...slot.constraints.map((constraint) => constraintCheck(offer, constraint, attributes)),
  ];
}
