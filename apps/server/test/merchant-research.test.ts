import { type ProductOffer, ProductOfferSchema } from '@sei/contracts';
import { expect, it, vi } from 'vitest';
import outfit from '../../../fixtures/seed/outfit/offers.json';
import setup from '../../../fixtures/seed/setup/offers.json';
import { createMerchantResearch } from '../src/services/merchant-research';

const request = { country: 'CA', currency: 'CAD' };
const signal = () => new AbortController().signal;
function offer(category: string, domain: string, patch: Partial<ProductOffer> = {}): ProductOffer {
  const base = ProductOfferSchema.parse(outfit[0]);
  return {
    ...base,
    sampleOrigin: 'live',
    category,
    productId: category,
    productUrl: `https://${domain}/products/${category}`,
    merchant: { ...base.merchant, domain },
    ...patch,
  };
}
it.each([
  { seed: outfit, category: 'top' },
  { seed: setup, category: 'desk' },
])('uses seed products without opening live providers: $category', async ({ seed, category }) => {
  const openCatalog = vi.fn();
  const report = await createMerchantResearch({}, { openCatalog }).research(
    [ProductOfferSchema.parse(seed[0])],
    { ...request, category },
    signal(),
  );
  expect(report.sampleOrigin).toBe('seed');
  expect(report.partners.length).toBeGreaterThan(0);
  expect(report.bundles.length).toBeGreaterThan(0);
  expect(openCatalog).not.toHaveBeenCalled();
});
it('rejects articles, own domains, mismatched categories and seed data; deduplicates variants', async () => {
  const own = offer('footwear', 'own.example');
  const close = vi.fn(async () => {});
  const service = createMerchantResearch(
    {},
    {
      openCatalog: () => ({
        close,
        search: async (query) => [
          offer(query.text, 'other.example'),
          offer(query.text, 'other.example', { variantId: 'second' }),
          offer(query.text, 'own.example'),
          offer(query.text, 'sub.own.example'),
          offer(query.text, 'article.example', {
            productUrl: 'https://article.example/blogs/best-shoes',
          }),
          offer(query.text, 'mismatch.example', {
            productUrl: 'https://foreign.example/products/test',
          }),
          offer(query.text, 'fake.example', { sampleOrigin: 'seed' }),
          offer(query.text, 'unverified.example', { evidence: [] }),
          offer('unrelated', 'wrong.example'),
        ],
      }),
    },
  );
  const report = await service.research([own], request, signal());
  expect(report.status).toBe('ready');
  expect(report.bundles).toHaveLength(2);
  expect(report.partners.map((x) => x.merchant.domain)).toEqual(['other.example']);
  expect(report.competitors[0]?.products).toHaveLength(1);
  expect(report.bundles[0]?.itemSubtotal).toEqual({ amount: 20000, currency: 'CAD' });
  expect(close).toHaveBeenCalledOnce();
});
it('does not sum mixed currencies or bundle unavailable items', async () => {
  const service = createMerchantResearch(
    {},
    {
      openCatalog: () => ({
        close: async () => {},
        search: async (query) => [
          offer(query.text, 'other.example', {
            price: { amount: 1000, currency: 'USD' },
            availability: query.text === 'socks' ? 'unavailable' : 'available',
          }),
        ],
      }),
    },
  );
  const report = await service.research([offer('footwear', 'own.example')], request, signal());
  expect(report.bundles).toHaveLength(1);
  expect(report.bundles[0]?.itemSubtotal).toBeNull();
});
it('returns partial results when a later search fails and always closes', async () => {
  const close = vi.fn(async () => {});
  const service = createMerchantResearch(
    {},
    {
      openCatalog: () => ({
        close,
        search: async (query) => {
          if (query.text !== 'bag') throw new Error('Provider failed');
          return [offer('bag', 'other.example')];
        },
      }),
    },
  );
  const report = await service.research([offer('footwear', 'own.example')], request, signal());
  expect(report.status).toBe('partial');
  expect(report.partners).toHaveLength(1);
  expect(report.competitors).toHaveLength(0);
  expect(report.gaps).toHaveLength(2);
  expect(close).toHaveBeenCalledOnce();
});
it('cancels a pending query, blocks concurrent jobs and releases its session', async () => {
  const close = vi.fn(async () => {});
  let start!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const service = createMerchantResearch(
    {},
    {
      openCatalog: () => ({
        close,
        search: async () => {
          start();
          return new Promise(() => {});
        },
      }),
    },
  );
  const controller = new AbortController();
  const pending = service.research([offer('footwear', 'own.example')], request, controller.signal);
  await started;
  await expect(
    service.research([offer('footwear', 'own.example')], request, signal()),
  ).rejects.toMatchObject({ code: 'MERCHANT_RESEARCH_BUSY' });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(close).toHaveBeenCalledOnce();
});
it('validates categories and requires configured live research', async () => {
  const service = createMerchantResearch({});
  await expect(
    service.research(
      [offer('footwear', 'own.example')],
      { ...request, category: 'desk' },
      signal(),
    ),
  ).rejects.toMatchObject({ code: 'INVALID_CATEGORY' });
  await expect(
    service.research([offer('footwear', 'own.example')], request, signal()),
  ).rejects.toMatchObject({ code: 'MERCHANT_RESEARCH_DISABLED' });
});
