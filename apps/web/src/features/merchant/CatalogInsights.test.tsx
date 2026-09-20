import { type ProductOffer, ProductOfferSchema } from '@sei/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import outfit from '../../../../../fixtures/seed/outfit/offers.json';
import setup from '../../../../../fixtures/seed/setup/offers.json';
import { CatalogInsights } from './CatalogInsights';
import { categoryLabel } from './category-label';

afterEach(cleanup);

it.each([{ seed: outfit }, { seed: setup }])(
  'counts each product once across variants',
  ({ seed }) => {
    const base = ProductOfferSchema.parse(seed[0]);
    const variants: ProductOffer[] = [
      base,
      { ...base, id: 'offer_second', variantId: 'second', availability: 'unknown', price: null },
    ];
    render(<CatalogInsights offers={variants} />);
    expect(screen.getByText('1 products sampled / Demo data')).toBeTruthy();
    const meter = screen.getByRole('meter', { name: `${categoryLabel(base.category)} products` });
    expect(meter.getAttribute('value')).toBe('1');
    expect(meter.getAttribute('max')).toBe('1');
    expect(screen.queryByRole('link')).toBeNull();
  },
);

it('labels live inventory as public evidence without claiming demand', () => {
  render(
    <CatalogInsights offers={[{ ...ProductOfferSchema.parse(setup[0]), sampleOrigin: 'live' }]} />,
  );
  expect(screen.getByText('1 products sampled')).toBeTruthy();
  expect(screen.queryByText(/Demo data/)).toBeNull();
});

it('merges raw Shopify taxonomy paths into readable category groups', () => {
  const base = ProductOfferSchema.parse(outfit[0]);
  render(
    <CatalogInsights
      offers={[
        { ...base, productId: 'sports-bra', category: 'Womens>apparel>sports Bras>v_neck' },
        {
          ...base,
          id: 'offer_taxonomy_2',
          productId: 'pullover',
          category: 'Womens>apparel>pullovers>1_4_zip',
        },
        {
          ...base,
          id: 'offer_taxonomy_3',
          productId: 'leggings',
          category: 'Womens>apparel>leggings>full_length',
        },
      ]}
    />,
  );
  expect(screen.getByRole('meter', { name: 'Tops products' }).getAttribute('value')).toBe('2');
  expect(screen.getByRole('meter', { name: 'Bottoms products' }).getAttribute('value')).toBe('1');
  expect(screen.queryByText(/Womens>/)).toBeNull();
});
