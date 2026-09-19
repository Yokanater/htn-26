import type { ProductOffer } from '@sei/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlternativePicker } from './AlternativePicker';
import { EvidenceDrawer } from './EvidenceDrawer';
import { ProductTile } from './ProductTile';

afterEach(() => {
  cleanup();
});

function offer(overrides: Partial<ProductOffer> = {}): ProductOffer {
  return {
    id: 'offer_test_1',
    merchant: {
      id: 'mer_test_1',
      name: 'Test Merchant',
      domain: 'test-merchant.example',
    },
    productId: 'product-1',
    variantId: 'variant-1',
    title: 'Test top',
    category: 'top',
    productUrl: 'https://test-merchant.example/products/top',
    imageUrl: null,
    price: { amount: 2500, currency: 'CAD' },
    availability: 'available',
    shipsTo: ['CA'],
    attributes: { size: 'M' },
    evidence: [
      {
        id: 'ev_test_1',
        field: 'product_record',
        value: 'fixture',
        url: 'https://test-merchant.example/products/top',
        capturedAt: '2026-09-19T12:00:00Z',
        method: 'catalog',
      },
    ],
    sampleOrigin: 'seed',
    ...overrides,
  };
}

describe('ProductTile', () => {
  it('shows unknown price, shipping, size, and stale facts', () => {
    render(
      <ProductTile
        offer={offer({
          price: null,
          shipsTo: null,
          attributes: {},
          evidence: [
            {
              id: 'ev_old',
              field: 'product_record',
              value: 'old',
              url: 'https://test-merchant.example/products/top',
              capturedAt: '2020-01-01T00:00:00Z',
              method: 'catalog',
            },
          ],
        })}
        now={new Date('2026-09-19T12:00:00Z')}
        evidenceTtlMs={60_000}
      />,
    );
    expect(screen.getByText('Price unknown')).toBeTruthy();
    expect(screen.getByText('Shipping eligibility unknown')).toBeTruthy();
    expect(screen.getByText('Size unknown')).toBeTruthy();
    expect(screen.getByText('Facts may be stale')).toBeTruthy();
    expect(screen.getByText(/Provenance: seed/)).toBeTruthy();
  });

  it('shows a readable fallback when the image fails', () => {
    render(
      <ProductTile offer={offer({ imageUrl: 'https://test-merchant.example/missing.jpg' })} />,
    );
    const img = screen.getByAltText('Test top');
    fireEvent.error(img);
    expect(screen.getByRole('status').textContent).toMatch(/unavailable/i);
  });
});

describe('AlternativePicker', () => {
  it('selects alternatives without unifying merchants', () => {
    const onSelect = vi.fn();
    const a = offer({ id: 'offer_a', merchant: { id: 'mer_a', name: 'A', domain: 'a.example' } });
    const b = offer({
      id: 'offer_b',
      title: 'Same product other seller',
      productId: 'product-1',
      variantId: 'variant-1',
      merchant: { id: 'mer_b', name: 'B', domain: 'b.example' },
      productUrl: 'https://b.example/products/top',
      evidence: [
        {
          id: 'ev_b',
          field: 'product_record',
          value: 'b',
          url: 'https://b.example/products/top',
          capturedAt: '2026-09-19T12:00:00Z',
          method: 'catalog',
        },
      ],
    });
    render(<AlternativePicker offers={[a, b]} selectedOfferId="offer_a" onSelect={onSelect} />);
    expect(screen.getByText(/does not create a unified cart/i)).toBeTruthy();
    expect(screen.getByText((_, el) => el?.textContent === 'A · a.example')).toBeTruthy();
    expect(screen.getByText((_, el) => el?.textContent === 'B · b.example')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Shortlist' }));
    expect(onSelect).toHaveBeenCalledWith('offer_b');
  });
});

describe('EvidenceDrawer', () => {
  it('opens with evidence details and closes via the close button', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <EvidenceDrawer
        open
        title="Evidence"
        evidence={offer().evidence}
        sampleOrigin="seed"
        onClose={onClose}
        now={new Date('2026-09-19T12:00:00Z')}
      />,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/Method: catalog/)).toBeTruthy();
    expect(screen.getByText(/Sample origin: seed/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    rerender(
      <EvidenceDrawer
        open={false}
        title="Evidence"
        evidence={offer().evidence}
        onClose={onClose}
      />,
    );
  });
});
