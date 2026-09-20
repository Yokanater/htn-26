const CATEGORY_LABELS: ReadonlyArray<[string, RegExp]> = [
  ['Supplements', /\b(protein|creatine|supplements?|pre[- ]?workout|electrolytes?)\b/i],
  [
    'Fitness equipment',
    /\b(pull[- ]?up bars?|dumbbells?|kettlebells?|resistance bands?|gym equipment|training equipment)\b/i,
  ],
  ['Skincare', /\b(skincare|serums?|moisturi[sz]ers?|cleansers?|sunscreens?)\b/i],
  [
    'Makeup',
    /\b(makeup|cosmetics?|lip|lipsticks?|mascaras?|foundations?|concealers?|blush|bronzers?|highlighters?|eyeshadows?)\b/i,
  ],
  ['Beauty tools', /\b(beauty tools?|makeup brushes?|applicators?|sponges?|mirrors?)\b/i],
  ['Footwear', /\b(shoes?|footwear|boots?|sandals?|heels?|flats?|sneakers?)\b/i],
  ['Socks', /\b(socks?|hosiery)\b/i],
  ['Bags', /\b(bags?|handbags?|backpacks?|totes?)\b/i],
  [
    'Bottoms',
    /\b(bottoms?|pants?|trousers?|jeans?|shorts?|skirts?|leggings?|joggers?|tights?|underwear|boxers?)\b/i,
  ],
  [
    'Tops',
    /\b(tops?|shirts?|jackets?|coats?|sweaters?|blouses?|hoodies?|pullovers?|sports bras?|bras?|tanks?|tees?|t-shirts?|crop tops?)\b/i,
  ],
  ['Accessories', /\b(accessories|headwear|caps?|hats?|beanies?|water bottles?)\b/i],
];

export function categoryLabel(category: string): string {
  if (/^unknown$/i.test(category.trim())) return 'Other';
  const known = CATEGORY_LABELS.find(([, pattern]) => pattern.test(category));
  if (known) return known[0];
  const leaf = category.split(/[>/|]/).filter(Boolean).at(-1)?.trim() || category.trim();
  return leaf.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
