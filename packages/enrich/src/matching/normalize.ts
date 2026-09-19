/** Deterministic attribute normalization. Owner: L2 (S2-L2-1). Design v3 §5.2.
 * Fallback for model-backed normalization: reads only sourced offer attributes and never guesses
 * a unit, size system or material. Attribute key names are provisional until L1 and L2 agree the
 * shared vocabulary (e.g. `size`, `width_cm`, `material`, `mounting`).
 */
import type { ProductOffer } from '@sei/contracts';

export type DimensionAxis = 'width' | 'depth' | 'height';
export type MountingKind = 'freestanding' | 'no_drilling' | 'requires_drilling';

export interface NormalizedAttributes {
  size: string | null;
  dimensionsCm: Record<DimensionAxis, number | null>;
  /** Lower-case material phrases as listed by the product source; null when not listed. */
  materials: readonly string[] | null;
  mounting: MountingKind | null;
}

/** `Mount Type` / `mount-type` / `mount_type` all compare as `mount_type`. */
export function canonicalKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

const SIZE_KEYS = ['size', 'variant_size', 'clothing_size', 'shoe_size'];
const MATERIAL_KEYS = ['material', 'materials', 'fabric', 'composition'];
const MOUNTING_KEYS = ['mounting', 'mount', 'mount_type', 'installation'];

const SIZE_ALIASES: Record<string, string> = {
  '2XS': 'XXS',
  'XX SMALL': 'XXS',
  XXSMALL: 'XXS',
  'X SMALL': 'XS',
  XSMALL: 'XS',
  'EXTRA SMALL': 'XS',
  SM: 'S',
  SMALL: 'S',
  MD: 'M',
  MED: 'M',
  MEDIUM: 'M',
  LG: 'L',
  LARGE: 'L',
  'X LARGE': 'XL',
  XLARGE: 'XL',
  'EXTRA LARGE': 'XL',
  '2XL': 'XXL',
  'XX LARGE': 'XXL',
  XXLARGE: 'XXL',
  '3XL': 'XXXL',
};
export const LETTER_SIZES: ReadonlySet<string> = new Set([
  'XXS',
  'XS',
  'S',
  'M',
  'L',
  'XL',
  'XXL',
  'XXXL',
]);

export function normalizeSize(raw: string | number): string {
  const text = String(raw)
    .trim()
    .toUpperCase()
    .replace(/[\s_.-]+/g, ' ')
    .trim();
  return SIZE_ALIASES[text] ?? text;
}

type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
const CM_PER_UNIT: Record<LengthUnit, number> = { mm: 0.1, cm: 1, m: 100, in: 2.54, ft: 30.48 };
const UNIT_PATTERNS: [LengthUnit, RegExp][] = [
  ['mm', /^(mm|millimet(er|re)s?)$/],
  ['cm', /^(cm|centimet(er|re)s?)$/],
  ['m', /^(m|met(er|re)s?)$/],
  ['in', /^(in|inch|inches|")$/],
  ['ft', /^(ft|foot|feet)$/],
];
const LENGTH = /^(\d+(?:\.\d+)?)\s*([a-z"]+)?$/;

function toCm(value: string | number, keyUnit: LengthUnit | null): number | null {
  let amount: number;
  let unit = keyUnit;
  if (typeof value === 'number') {
    amount = value;
  } else {
    const match = LENGTH.exec(value.trim().toLowerCase());
    if (!match) return null;
    amount = Number(match[1]);
    if (match[2]) unit = UNIT_PATTERNS.find(([, pattern]) => pattern.test(match[2]))?.[0] ?? null;
  }
  // A bare number with no stated unit is not assumed to be centimetres.
  if (!unit || !Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * CM_PER_UNIT[unit] * 1000) / 1000;
}

function dimension(
  attributes: ReadonlyMap<string, string | number>,
  axis: DimensionAxis,
): number | null {
  const keyed: [string, LengthUnit | null][] = [
    [`${axis}_cm`, 'cm'],
    [`${axis}_mm`, 'mm'],
    [`${axis}_in`, 'in'],
    [`${axis}_inches`, 'in'],
    [axis, null],
  ];
  for (const [key, unit] of keyed) {
    const value = attributes.get(key);
    if (value === undefined) continue;
    const cm = toCm(value, unit);
    if (cm !== null) return cm;
  }
  // Combined strings such as "100 x 60 x 75 cm" have no reliable axis order: left unknown.
  return null;
}

function parseMaterials(value: string | number): string[] | null {
  const phrases = String(value)
    .toLowerCase()
    .split(/[,;/&+]|\band\b/)
    .map((phrase) =>
      phrase
        .replace(/\d+(?:\.\d+)?\s*%/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
  return phrases.length > 0 ? phrases : null;
}

const FREESTANDING =
  /\b(free[\s-]?standing|floor[\s-]?standing|table[\s-]?top|desk[\s-]?top|plug[\s-]?in)\b/;
const NO_DRILLING =
  /\b(no[\s-]?drill(ing)?|drill[\s-]?free|renter[\s-]?friendly|clamp(s|ed)?|adhesive|tension|suction|magnetic)\b/;
const REQUIRES_DRILLING =
  /\b(wall[\s-]?mount(ed|ing)?|ceiling[\s-]?mount(ed|ing)?|hard[\s-]?wired|drill(ing)?|screw[\s-]?(in|mount(ed)?))\b/;

/** A product usable freestanding also satisfies "no drilling", so that reading wins. */
function parseMounting(value: string | number): MountingKind | null {
  const text = String(value).toLowerCase();
  if (FREESTANDING.test(text)) return 'freestanding';
  if (NO_DRILLING.test(text)) return 'no_drilling';
  if (REQUIRES_DRILLING.test(text)) return 'requires_drilling';
  return null;
}

export function normalizeOfferAttributes(offer: ProductOffer): NormalizedAttributes {
  const attributes = new Map(
    Object.entries(offer.attributes).map(([key, value]) => [canonicalKey(key), value]),
  );
  const first = (keys: readonly string[]) =>
    keys.map((key) => attributes.get(key)).find((value) => String(value ?? '').trim() !== '');
  const size = first(SIZE_KEYS);
  const materials = first(MATERIAL_KEYS);
  const mounting = first(MOUNTING_KEYS);
  return {
    size: size === undefined ? null : normalizeSize(size),
    dimensionsCm: {
      width: dimension(attributes, 'width'),
      depth: dimension(attributes, 'depth'),
      height: dimension(attributes, 'height'),
    },
    materials: materials === undefined ? null : parseMaterials(materials),
    mounting: mounting === undefined ? null : parseMounting(mounting),
  };
}
