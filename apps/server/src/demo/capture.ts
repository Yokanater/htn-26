/** Explicitly user-authorized recording command. Never imported by the app or tests. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { type CatalogHit, normalizeCatalogHits } from '@sei/collect';
import { z } from 'zod';

const productSchema = z.object({
  title: z.string(),
  handle: z.string(),
  images: z.array(z.object({ src: z.string() })).optional(),
});
const detailSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string(),
  variants: z.array(
    z.object({
      id: z.union([z.number(), z.string()]),
      available: z.boolean(),
      price: z.number(),
      option1: z.string().nullable().optional(),
      title: z.string(),
    }),
  ),
});

const sources = [
  {
    host: 'www.allbirds.com',
    category: 'footwear',
    pattern: /^men.*(?:strider|dasher)/i,
    count: 8,
  },
  { host: 'darntough.com', category: 'socks', pattern: /\brun\b|running/i, count: 2 },
  {
    host: 'topodesigns.com',
    category: 'bag',
    pattern: /^rover pack classic$|^rover pack tech$/i,
    count: 2,
  },
  { host: 'www.stanley1913.com', category: 'bottle', pattern: /quencher|bottle/i, count: 2 },
  {
    host: 'vessi.com',
    category: 'footwear',
    pattern: /men.*(?:sneaker|weekend|stormburst)/i,
    count: 1,
  },
  { host: 'www.rothys.com', category: 'footwear', pattern: /sneaker|runner/i, count: 1 },
  { host: 'thursdayboots.com', category: 'footwear', pattern: /sneaker|premier/i, count: 1 },
];
async function read(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Public catalog HTTP ${r.status}`);
  return await r.json();
}
const hits: CatalogHit[] = [];
const onlyHost = process.argv.find((a) => a.startsWith('--host='))?.slice(7);
for (const source of sources.filter((s) => !onlyHost || s.host === onlyHost)) {
  try {
    const origin = `https://${source.host}`;
    const [catalogRaw, cartRaw] = await Promise.all([
      read(`${origin}/products.json?limit=250`),
      read(`${origin}/cart.js`),
    ]);
    const catalog = z.object({ products: z.array(productSchema) }).parse(catalogRaw);
    const cart = z.object({ currency: z.string() }).parse(cartRaw);
    const products = catalog.products
      .filter((p: { title: string }) => source.pattern.test(p.title))
      .slice(0, source.count);
    for (const product of products) {
      const url = `${origin}/products/${product.handle}`;
      const detail = detailSchema.parse(await read(`${url}.js`));
      const variant =
        detail.variants.find((v: { available: boolean }) => v.available) ?? detail.variants[0];
      if (!variant || !cart.currency) continue;
      hits.push({
        merchant: { name: source.host.replace(/^www\./, ''), domain: source.host },
        productId: String(detail.id),
        variantId: String(variant.id),
        title: detail.title,
        category: source.category,
        productUrl: url,
        imageUrl: product.images?.[0]?.src ?? null,
        price: { amount: Number(variant.price), currency: cart.currency },
        availability: variant.available ? 'available' : 'unavailable',
        shipsTo: null,
        attributes: { size: variant.option1 ?? variant.title },
        evidenceUrl: `${url}.js`,
        evidenceMethod: 'fetch',
      });
    }
    console.log(source.host, products.length, 'products', cart.currency);
  } catch (error) {
    console.log(source.host, error instanceof Error ? error.message : 'capture failed');
  }
}
const capturedAt = new Date().toISOString();
const { offers: capturedOffers } = normalizeCatalogHits(hits, {
  sampleOrigin: 'replay',
  capturedAt,
  limit: 40,
});
const dir = new URL('../../../../demo/', import.meta.url);
await mkdir(dir, { recursive: true });
const previous = onlyHost
  ? JSON.parse(await readFile(new URL('allbirds-recording.json', dir), 'utf8')).offers
  : [];
const offers = [
  ...previous.filter((p: { merchant: { domain: string } }) => p.merchant.domain !== onlyHost),
  ...capturedOffers,
];
await writeFile(
  new URL('allbirds-recording.json', dir),
  JSON.stringify(
    {
      capturedAt,
      anchor: 'www.allbirds.com',
      notice: 'Public catalog recording. Rehearsal choices are not real purchases or live demand.',
      offers,
    },
    null,
    2,
  ),
);
console.log('Recorded', offers.length, 'offers');
