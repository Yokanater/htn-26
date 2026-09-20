import { type ProductOffer, ProductOfferSchema } from '@sei/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import outfit from '../../../../../fixtures/seed/outfit/offers.json';
import setup from '../../../../../fixtures/seed/setup/offers.json';
import { CatalogInsights } from './CatalogInsights';

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
    const meter = screen.getByRole('meter', { name: `${base.category} products` });
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
