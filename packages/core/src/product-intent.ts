/** Shared deterministic relevance. Search signals are never product evidence. */
import type { IntentSlot, ProductOffer } from '@sei/contracts';

export function productWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function has(text: string, term: string): boolean {
  return ` ${productWords(text)} `.includes(` ${productWords(term)} `);
}

const KINDS = [
  ['t-shirt', 't shirt', 'tee', 'tees'],
  ['shirt', 'button up', 'button down', 'shirt', 'shirts', 'blouse'],
  ['sweater', 'sweater', 'cardigan', 'knitwear'],
  ['hoodie', 'hoodie', 'sweatshirt'],
  ['shorts', 'shorts', 'bermuda'],
  ['trousers', 'trousers', 'pants', 'chinos', 'jeans'],
  ['skirt', 'skirt'],
  ['sandals', 'sandals', 'sandal', 'slides', 'slide'],
  ['sneakers', 'sneakers', 'sneaker', 'trainers'],
  ['boots', 'boots', 'boot'],
  ['loafers', 'loafers', 'loafer'],
  ['sunglasses', 'sunglasses', 'eyewear', 'shades'],
  ['watch', 'watch', 'watches', 'wristwatch'],
  ['hat', 'hat', 'cap', 'beanie'],
  ['bag', 'bag', 'backpack', 'tote', 'purse'],
  // Head nouns matter: a desk lamp is lighting, not a desk; a desk chair is seating.
  ['lamp', 'lamp', 'lighting', 'sconce', 'chandelier', 'pendant light'],
  ['chair', 'chair', 'stool', 'armchair'],
  ['desk', 'desk', 'workstation', 'writing table'],
  ['rug', 'rug', 'carpet'],
  ['shelf', 'shelf', 'shelves', 'bookcase', 'cabinet'],
] as const;

const COLORS = [
  ['blue', 'blue', 'navy', 'azure', 'sky', 'indigo'],
  ['white', 'white', 'ivory', 'cream', 'ecru', 'off white'],
  ['beige', 'beige', 'tan', 'sand', 'oatmeal'],
  ['green', 'green', 'olive', 'sage', 'khaki'],
  ['red', 'red', 'burgundy', 'maroon', 'wine'],
  ['black', 'black', 'onyx'],
  ['grey', 'grey', 'gray', 'charcoal'],
  ['brown', 'brown', 'chocolate', 'cognac'],
  ['pink', 'pink', 'rose', 'blush'],
  ['purple', 'purple', 'violet', 'lavender'],
  ['yellow', 'yellow', 'mustard'],
  ['orange', 'orange', 'rust'],
] as const;

const DETAILS = [
  ['slip-on', 'slip on', 'slide', 'slides'],
  ['button-up', 'button up', 'button down', 'button front'],
  ['long-sleeve', 'long sleeve', 'long sleeves'],
  ['short-sleeve', 'short sleeve', 'short sleeves'],
  ['striped', 'striped', 'stripes', 'stripe'],
  ['plain', 'plain', 'solid', 'unpatterned'],
  ['graphic', 'graphic', 'printed', 'print'],
] as const;

const STOP = new Set(
  'a an and the of for with in on to from my our your this that matching confirmed inspiration item product wearing visible looks like appears top bottom footwear accessory accessories mens men womens women male female unisex'.split(
    ' ',
  ),
);

export function requestedAudience(slot: IntentSlot): 'men' | 'women' | 'kids' | 'unisex' | null {
  const chosen = slot.visualAttributes
    .find((value) => value.startsWith('Shopping department: '))
    ?.slice('Shopping department: '.length);
  if (chosen === 'men' || chosen === 'women' || chosen === 'kids' || chosen === 'unisex')
    return chosen;
  const text = productWords(`${slot.description} ${slot.visualAttributes.join(' ')}`);
  if (/\b(unisex)\b/.test(text)) return 'unisex';
  if (/\b(kids|children|toddler|boys|girls)\b/.test(text)) return 'kids';
  if (/\b(women|womens|womenswear|woman|female|ladies)\b/.test(text)) return 'women';
  if (/\b(men|mens|menswear|man|male)\b/.test(text)) return 'men';
  return null;
}

function kind(text: string): string | null {
  return KINDS.find(([, ...aliases]) => aliases.some((alias) => has(text, alias)))?.[0] ?? null;
}

function features(text: string, groups: readonly (readonly string[])[]): string[] {
  return groups
    .filter(([, ...aliases]) => aliases.some((alias) => has(text, alias)))
    .map(([name]) => name!);
}

export function slotSearchTerms(slot: IntentSlot, relaxed = false): string[] {
  const text = `${slot.description} ${slot.visualAttributes.filter((value) => !value.startsWith('Shopping department: ')).join(' ')}`;
  const noun = kind(text) ?? kind(slot.category) ?? slot.category;
  const colours = COLORS.flatMap(([, ...aliases]) => {
    const found = aliases.find((alias) => has(text, alias));
    if (!found) return [];
    const shade = productWords(text).match(new RegExp(`\\b(light|pale|dark|off) ${found}\\b`))?.[0];
    return [shade ?? found];
  });
  const materials = [
    'linen',
    'cotton',
    'leather',
    'suede',
    'wool',
    'oak',
    'wood',
    'metal',
    'steel',
  ];
  const styles = ['rounded', 'round', 'aviator', 'tailored', 'chino', 'flat', 'slide', 'slides'];
  const rest = relaxed
    ? []
    : [...materials, ...styles].filter((word) => has(text, word)).slice(0, 3);
  // Compact phrases leave room for the destination, unlike the full verbose description.
  return [
    ...new Set(
      [requestedAudience(slot), noun, ...colours, ...features(text, DETAILS), ...rest].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  ];
}

export function productIntentFit(
  slot: IntentSlot,
  text: string,
): { score: number; conflict: boolean; strong: boolean } {
  const wanted = `${slot.description} ${slot.visualAttributes.join(' ')}`;
  const wantedKind = kind(wanted) ?? kind(slot.category);
  const actualKind = kind(text);
  const audience = requestedAudience(slot);
  const actualAudience = requestedAudience({ ...slot, description: text, visualAttributes: [] });
  const audienceConflict = Boolean(
    audience &&
      actualAudience &&
      actualAudience !== 'unisex' &&
      audience !== 'unisex' &&
      audience !== actualAudience,
  );
  const kindConflict = Boolean(wantedKind && actualKind && wantedKind !== actualKind);
  const colors = features(wanted, COLORS);
  const actualColors = features(text, COLORS);
  const colorMatches = colors.filter((color) => actualColors.includes(color)).length;
  const details = features(wanted, DETAILS);
  const actualDetails = features(text, DETAILS);
  const detailMatches = details.filter((detail) => actualDetails.includes(detail)).length;
  const oppositeDetails = [
    ['plain', 'striped'],
    ['plain', 'graphic'],
    ['long-sleeve', 'short-sleeve'],
  ];
  const detailConflict = oppositeDetails.some(
    ([left, right]) =>
      (details.includes(left!) && actualDetails.includes(right!)) ||
      (details.includes(right!) && actualDetails.includes(left!)),
  );
  const requestedShade = productWords(wanted).match(
    /\b(light|pale|dark) (blue|green|grey|gray|beige|brown)\b/,
  );
  const actualShade = productWords(text).match(
    /\b(light|pale|dark) (blue|green|grey|gray|beige|brown)\b/,
  );
  const shadeConflict = Boolean(
    requestedShade &&
      actualShade &&
      requestedShade[2] === actualShade[2] &&
      (requestedShade[1] === 'dark') !== (actualShade[1] === 'dark'),
  );
  const words = [
    ...new Set(
      productWords(wanted)
        .split(' ')
        .filter((word) => word.length > 1 && !STOP.has(word)),
    ),
  ];
  const overlap = words.length ? words.filter((word) => has(text, word)).length / words.length : 0;
  const conflict = audienceConflict || kindConflict;
  const score = conflict
    ? 0
    : Math.max(
        0,
        Math.min(
          1000,
          Math.round(
            (wantedKind && actualKind === wantedKind ? 350 : 0) +
              (colors.length ? (250 * colorMatches) / colors.length : 0) +
              (details.length ? (200 * detailMatches) / details.length : 0) +
              overlap * 200 -
              (colors.length && actualColors.length && !colorMatches ? 200 : 0) -
              (detailConflict || shadeConflict ? 250 : 0),
          ),
        ),
      );
  return {
    score,
    conflict,
    strong:
      !conflict &&
      !detailConflict &&
      !shadeConflict &&
      Boolean(actualKind && (!wantedKind || actualKind === wantedKind)) &&
      (!colors.length || colorMatches > 0) &&
      (!details.length || detailMatches === details.length),
  };
}

export function offerIntentText(offer: ProductOffer): string {
  // The catalog's assigned category is not evidence of relevance.
  return [offer.title, ...Object.values(offer.attributes)].join(' ');
}
