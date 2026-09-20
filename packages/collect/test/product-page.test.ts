import { describe, expect, it } from 'vitest';
import { extractProductFacts, factsFromShopifyProductJson } from '../src/product-page';

const PAGE_URL = 'https://shop.example/products/olive-shirt';

function page(head: string, body = 'Product'): string {
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}

function jsonLd(value: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
}

function facts(head: string, finalUrl = PAGE_URL) {
  return extractProductFacts({ html: page(head), finalUrl });
}

describe('JSON-LD layer', () => {
  it('reads a ProductGroup with per-size Product variants and array price specifications', () => {
    const result = facts(
      jsonLd({
        '@type': 'ProductGroup',
        name: 'Light Beige Cotton Shorts',
        sku: 'SHORTS',
        url: PAGE_URL,
        color: 'Light Beige',
        hasVariant: [
          {
            '@type': 'Product',
            sku: 'SHORTS-28',
            size: '28',
            offers: {
              '@type': 'Offer',
              availability: 'https://schema.org/InStock',
              priceSpecification: [
                { '@type': 'UnitPriceSpecification', price: 250, priceCurrency: 'CAD' },
              ],
            },
          },
        ],
      }),
    );
    expect(result).toMatchObject({
      title: 'Light Beige Cotton Shorts',
      productId: 'SHORTS',
      variants: [
        expect.objectContaining({
          variantId: 'SHORTS-28',
          currency: 'CAD',
          amountMinorUnits: 25000,
          attributes: { size: '28', color: 'Light Beige' },
        }),
      ],
    });
  });
  it('prefers the explicit Shopify variant URL over a different SKU', () => {
    const result = facts(
      jsonLd({
        '@type': 'Product',
        name: 'Light Blue Shirt',
        offers: {
          '@type': 'Offer',
          sku: 'SHIRT-BLUE-XS',
          url: `${PAGE_URL}?variant=32593207590966`,
          price: 69.99,
          priceCurrency: 'CAD',
        },
      }),
    );
    expect(result?.variants[0]?.variantId).toBe('32593207590966');
  });
  it('selects the current product instead of the first related-product JSON-LD node', () => {
    const result = facts(
      jsonLd([
        {
          '@type': 'Product',
          name: 'Black Recommended Sandal',
          url: 'https://shop.example/products/other',
          offers: { '@type': 'Offer', price: 10, priceCurrency: 'USD' },
        },
        {
          '@type': 'Product',
          name: 'Current White Sandal',
          url: PAGE_URL,
          offers: { '@type': 'Offer', price: 50, priceCurrency: 'CAD' },
        },
      ]),
    );
    expect(result).toMatchObject({ title: 'Current White Sandal', currency: 'CAD' });
  });
  it('preserves apostrophes in a double-quoted product title and decodes image URLs', () => {
    const result = facts(
      `<meta property="og:title" content="White Men's Helix Slide Sandals | PEDRO"><meta property="product:price:amount" content="116"><meta property="product:price:currency" content="CAD"><meta property="og:image" content="https://shop.example/image.jpg?a=1&amp;b=2">`,
    );
    expect(result?.title).toContain("White Men's Helix Slide Sandals");
    expect(result?.imageUrl).toBe('https://shop.example/image.jpg?a=1&b=2');
  });
  it('reads a single offer with an explicit variant, price and availability', () => {
    const result = facts(
      `<link rel="canonical" href="https://shop.example/products/olive-shirt">${jsonLd({
        '@context': 'https://schema.org/',
        '@type': 'Product',
        name: 'Olive Oxford Shirt',
        sku: 'OX-OLIVE',
        image: ['https://cdn.shop.example/olive.jpg'],
        offers: {
          '@type': 'Offer',
          priceCurrency: 'CAD',
          price: '89.95',
          availability: 'https://schema.org/InStock',
          sku: 'OX-OLIVE-M',
          size: 'M',
        },
      })}`,
    );
    expect(result).toMatchObject({
      strategy: 'json_ld',
      productId: 'OX-OLIVE',
      title: 'Olive Oxford Shirt',
      imageUrl: 'https://cdn.shop.example/olive.jpg',
      currency: 'CAD',
      canonicalUrl: PAGE_URL,
    });
    expect(result?.variants).toEqual([
      {
        variantId: 'OX-OLIVE-M',
        title: null,
        amountMinorUnits: 8995,
        currency: 'CAD',
        availability: 'available',
        attributes: { size: 'M' },
        imageUrl: null,
      },
    ]);
  });

  it('keeps every distinguishable offer with its own availability', () => {
    const result = facts(
      jsonLd({
        '@type': 'Product',
        name: 'Tan Chino Shorts',
        offers: [
          {
            '@type': 'Offer',
            sku: 'CH-S',
            price: 45,
            priceCurrency: 'CAD',
            availability: 'InStock',
            size: 'S',
          },
          {
            '@type': 'Offer',
            sku: 'CH-M',
            price: 45,
            priceCurrency: 'CAD',
            availability: 'https://schema.org/OutOfStock',
            size: 'M',
          },
        ],
      }),
    );
    expect(result?.variants.map((variant) => [variant.variantId, variant.availability])).toEqual([
      ['CH-S', 'available'],
      ['CH-M', 'unavailable'],
    ]);
  });

  it('pairs a Product with its Offer inside @graph', () => {
    const result = facts(
      jsonLd({
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'Organization', name: 'Shop' },
          { '@type': 'Product', name: 'Walnut Desk', productID: 'desk-1' },
          {
            '@type': 'Offer',
            price: '499.00',
            priceCurrency: 'USD',
            availability: 'InStock',
            sku: 'DESK-140',
          },
        ],
      }),
      'https://desks.example/shop/walnut-desk',
    );
    expect(result).toMatchObject({ strategy: 'json_ld', productId: 'desk-1', currency: 'USD' });
    expect(result?.variants[0]).toMatchObject({ variantId: 'DESK-140', amountMinorUnits: 49900 });
  });

  it('reads a top-level array of nodes', () => {
    const result = facts(
      jsonLd([
        { '@type': 'WebPage', name: 'Lamp page' },
        {
          '@type': 'Product',
          name: 'Brass Lamp',
          offers: { '@type': 'Offer', price: '129.00', priceCurrency: 'USD' },
        },
      ]),
    );
    expect(result?.title).toBe('Brass Lamp');
    expect(result?.variants[0]?.amountMinorUnits).toBe(12900);
  });

  it('treats a price range as unknown but accepts a collapsed range', () => {
    const range = facts(
      jsonLd({
        '@type': 'Product',
        name: 'Rug',
        offers: {
          '@type': 'AggregateOffer',
          lowPrice: '80.00',
          highPrice: '240.00',
          priceCurrency: 'USD',
        },
      }),
    );
    expect(range?.variants[0]?.amountMinorUnits).toBeNull();
    const collapsed = facts(
      jsonLd({
        '@type': 'Product',
        name: 'Rug',
        offers: {
          '@type': 'AggregateOffer',
          lowPrice: '80.00',
          highPrice: '80.00',
          priceCurrency: 'USD',
        },
      }),
    );
    expect(collapsed?.variants[0]?.amountMinorUnits).toBe(8000);
  });

  it('never derives a variant identifier from an offer title', () => {
    const result = facts(
      jsonLd({
        '@type': 'Product',
        name: 'Merino Tee',
        offers: { '@type': 'Offer', name: 'Medium', price: '60.00', priceCurrency: 'CAD' },
      }),
    );
    expect(result?.variants[0]).toMatchObject({ variantId: null, title: 'Medium' });
  });

  it('leaves price and currency unknown when the page states neither', () => {
    const result = facts(
      jsonLd({
        '@type': 'Product',
        name: 'Mystery Chair',
        offers: { '@type': 'Offer', availability: 'InStock' },
      }),
    );
    expect(result?.currency).toBeNull();
    expect(result?.variants[0]).toMatchObject({
      amountMinorUnits: null,
      availability: 'available',
    });
  });

  it('applies the ISO exponent for zero-decimal currencies and European separators', () => {
    const yen = facts(
      jsonLd({
        '@type': 'Product',
        name: 'Kettle',
        offers: { '@type': 'Offer', price: '1200', priceCurrency: 'JPY' },
      }),
    );
    expect(yen?.variants[0]?.amountMinorUnits).toBe(1200);
    const euro = facts(
      jsonLd({
        '@type': 'Product',
        name: 'Chair',
        offers: { '@type': 'Offer', price: '1.234,56', priceCurrency: 'EUR' },
      }),
    );
    expect(euro?.variants[0]?.amountMinorUnits).toBe(123456);
  });

  it('reports a named product with no stated offer as having no variants', () => {
    const result = facts(jsonLd({ '@type': 'Product', name: 'Coming Soon Jacket' }));
    expect(result).toMatchObject({
      strategy: 'json_ld',
      title: 'Coming Soon Jacket',
      variants: [],
    });
  });
});

describe('Shopify layers', () => {
  const META_STATE = `<script src="https://cdn.shopify.com/s/theme.js"></script>
<script>var meta = {"product":{"id":66,"vendor":"Shop","variants":[{"id":900,"price":4500,"name":"Shirt - M","public_title":"M","sku":"S-M"}]},"page":{"pageType":"product"}};</script>
<script>Shopify.currency = {"active":"CAD","rate":"1.0"};</script>`;

  it('reads embedded Shopify state with minor-unit prices and the storefront currency', () => {
    const result = facts(META_STATE);
    expect(result).toMatchObject({
      strategy: 'shopify_state',
      productId: '66',
      currency: 'CAD',
      shopifySignalsPresent: true,
    });
    expect(result?.variants[0]).toMatchObject({
      variantId: '900',
      title: 'M',
      amountMinorUnits: 4500,
      currency: 'CAD',
      // `meta` states no stock flag, so availability stays unknown rather than being assumed.
      availability: 'unknown',
    });
  });

  it('reads a ProductJson script with options and stock flags', () => {
    const result = facts(
      `<meta property="product:price:currency" content="USD">
<script type="application/json" id="ProductJson-template">${JSON.stringify({
        id: 77,
        title: 'Desk Lamp',
        handle: 'desk-lamp',
        options: [{ name: 'Finish', position: 1 }],
        variants: [
          {
            id: 101,
            title: 'Brass',
            available: true,
            price: 12900,
            option1: 'Brass',
            featured_image: { src: 'https://cdn.shopify.com/lamp.jpg' },
          },
        ],
      })}</script>`,
    );
    expect(result?.strategy).toBe('shopify_state');
    expect(result?.variants[0]).toMatchObject({
      variantId: '101',
      amountMinorUnits: 12900,
      currency: 'USD',
      availability: 'available',
      attributes: { finish: 'Brass' },
      imageUrl: 'https://cdn.shopify.com/lamp.jpg',
    });
  });

  it('maps a product.js payload without inventing a currency', () => {
    const result = factsFromShopifyProductJson(
      {
        id: 12,
        title: 'Shirt',
        options: ['Size'],
        variants: [{ id: 42, title: 'Medium', available: true, price: '1000', option1: 'M' }],
      },
      PAGE_URL,
    );
    expect(result).toMatchObject({ strategy: 'shopify_js', productId: '12', currency: null });
    expect(result?.variants[0]).toMatchObject({
      variantId: '42',
      amountMinorUnits: 1000,
      currency: null,
      attributes: { size: 'M' },
    });
  });

  it('rejects payloads that are not a product', () => {
    expect(factsFromShopifyProductJson({ items: [] }, PAGE_URL)).toBeNull();
    expect(factsFromShopifyProductJson({ variants: [{}] }, PAGE_URL)).toBeNull();
  });
});

describe('meta tag layer and unsupported pages', () => {
  it('reads og/product meta tags and resolves a relative image', () => {
    const result = facts(
      `<meta property="og:title" content="Linen Curtain">
<meta property="og:image" content="/img/curtain.jpg">
<meta property="product:price:amount" content="59.00">
<meta property="product:price:currency" content="GBP">
<meta property="product:availability" content="in stock">
<meta property="product:retailer_item_id" content="CURT-1">`,
      'https://home.example/shop/linen-curtain',
    );
    expect(result).toMatchObject({
      strategy: 'meta_tags',
      productId: 'CURT-1',
      title: 'Linen Curtain',
      imageUrl: 'https://home.example/img/curtain.jpg',
      currency: 'GBP',
    });
    expect(result?.variants[0]).toMatchObject({
      variantId: null,
      amountMinorUnits: 5900,
      availability: 'available',
    });
  });

  it('drops a non-HTTPS image', () => {
    const result = facts(
      `<meta property="og:title" content="Stool">
<meta property="og:image" content="http://insecure.example/stool.jpg">
<meta property="product:price:amount" content="20.00">
<meta property="product:price:currency" content="USD">`,
    );
    expect(result?.imageUrl).toBeNull();
  });

  it('falls through malformed JSON-LD to the meta tags', () => {
    const result = facts(
      `<script type="application/ld+json">{"@type":"Product",</script>
<meta property="og:title" content="Recovered Product">
<meta property="product:price:amount" content="10.00">
<meta property="product:price:currency" content="USD">`,
    );
    expect(result).toMatchObject({ strategy: 'meta_tags', title: 'Recovered Product' });
  });

  it('decodes HTML entities and drops the store name a page title appends', () => {
    const result = facts(
      `<meta property="og:title" content="Nike Endure Sunglasses, Shoes &amp; Accessories | Steve Madden">
<meta property="product:price:amount" content="69.98">
<meta property="product:price:currency" content="CAD">`,
      'https://stevemadden.ca/products/endure',
    );
    expect(result?.title).toBe('Nike Endure Sunglasses, Shoes & Accessories');
  });

  it('completes a JSON-LD offer from the page title, image and stock meta tags', () => {
    const result = facts(
      `${jsonLd({
        '@type': 'Product',
        offers: { '@type': 'Offer', name: '18-20" long', price: '70.00', priceCurrency: 'CAD' },
      })}
<meta property="og:title" content="Beaded Necklace | Orange Avocado">
<meta property="og:image" content="https://cdn.orangeavocado.ca/necklace.jpg">
<meta property="product:availability" content="instock">`,
      'https://orangeavocado.ca/products/beaded-necklace',
    );
    expect(result).toMatchObject({
      strategy: 'json_ld',
      title: 'Beaded Necklace',
      imageUrl: 'https://cdn.orangeavocado.ca/necklace.jpg',
    });
    // A single stated offer may take the page's stock state; its label is not a variant ID.
    expect(result?.variants[0]).toMatchObject({
      variantId: null,
      title: '18-20" long',
      availability: 'available',
    });
  });

  it('does not take page stock state when the page lists several offers', () => {
    const result = facts(
      `${jsonLd({
        '@type': 'Product',
        name: 'Tee',
        offers: [
          { '@type': 'Offer', sku: 'A', price: '10.00', priceCurrency: 'CAD' },
          { '@type': 'Offer', sku: 'B', price: '10.00', priceCurrency: 'CAD' },
        ],
      })}
<meta property="product:availability" content="instock">`,
    );
    expect(result?.variants.map((variant) => variant.availability)).toEqual(['unknown', 'unknown']);
  });

  it('leaves currency unknown when only an unrelated currency appears in the markup', () => {
    const result = facts(
      `<script>window.config = {"currency":"USD","locale":"en-CA"};</script>
${jsonLd({ '@type': 'Product', name: 'Scarf', offers: { '@type': 'Offer', price: '70.00' } })}`,
      'https://orangeavocado.ca/products/scarf',
    );
    expect(result?.currency).toBeNull();
    expect(result?.variants[0]?.amountMinorUnits).toBeNull();
  });

  it('returns null for a page that states no product', () => {
    expect(facts('<title>About us</title>', 'https://shop.example/about')).toBeNull();
    expect(extractProductFacts({ html: '', finalUrl: PAGE_URL })).toBeNull();
  });
});
