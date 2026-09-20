// @vitest-environment jsdom
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { PRODUCT_DOCUMENT_SCRIPT } from '../src/browserbase-session';
import { extractProductFacts } from '../src/product-page';

it('preserves product JSON-LD after more than 750 KB of theme markup', () => {
  const document = (
    globalThis as unknown as {
      document: { head: { innerHTML: string }; body: { innerHTML: string } };
    }
  ).document;
  document.head.innerHTML = `<title>Blue Shirt</title><meta property="og:image" content="https://shop.example/shirt.jpg"><style>${' '.repeat(800_000)}</style>`;
  document.body.innerHTML = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Blue Shirt', offers: { '@type': 'Offer', price: '49', priceCurrency: 'CAD' } })}</script>`;
  const snapshot = runInNewContext(PRODUCT_DOCUMENT_SCRIPT, {
    document,
    location: { href: 'https://shop.example/products/shirt' },
  });
  expect(snapshot.html.length).toBeLessThan(1000);
  expect(
    extractProductFacts({ html: snapshot.html, finalUrl: 'https://shop.example/products/shirt' }),
  ).toMatchObject({
    title: 'Blue Shirt',
    variants: [expect.objectContaining({ amountMinorUnits: 4900, currency: 'CAD' })],
  });
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});
