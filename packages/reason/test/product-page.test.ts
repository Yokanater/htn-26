import { expect, it } from 'vitest';
import { validatePageProduct } from '../src/product-page';

it('requires source-backed title, exact price and unambiguous currency', () => {
  const source = 'Training socks. CAD 20.00. Add to cart.';
  const value = { title: 'Training socks', amount: 20, currency: 'CAD', quote: 'CAD 20.00' };
  expect(validatePageProduct(source, value)).toEqual(value);
  expect(
    validatePageProduct('Training socks CA$20.00', { ...value, quote: 'CA$20.00' }),
  ).not.toBeNull();
  expect(
    validatePageProduct('Training socks CAD 20-30', { ...value, quote: 'CAD 20-30' }),
  ).toBeNull();
  expect(validatePageProduct(source, { ...value, amount: 200 })).toBeNull();
  expect(validatePageProduct(source, { ...value, title: 'Protein powder' })).toBeNull();
  expect(validatePageProduct(source, { ...value, currency: 'USD' })).toBeNull();
  expect(validatePageProduct('Training socks $20.00', { ...value, quote: '$20.00' })).toBeNull();
  expect(validatePageProduct(source, { ...value, quote: 'CAD 20.00 Free shipping' })).toBeNull();
});
