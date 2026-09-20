import type { ProductOffer } from '@sei/contracts';
import { categoryLabel } from './category-label';

export function CatalogInsights({ offers }: { offers: ProductOffer[] }) {
  const products = [...new Map(offers.map((offer) => [offer.productId, offer])).values()];
  const groups = [...new Set(products.map((offer) => categoryLabel(offer.category)))]
    .map((category) => ({
      category,
      count: products.filter((offer) => categoryLabel(offer.category) === category).length,
    }))
    .sort((a, b) => b.count - a.count);
  return (
    <section className="merchant-catalog merchant-category-panel" aria-label="Product categories">
      <div className="merchant-section-heading">
        <div>
          <p className="eyebrow">YOUR STORE</p>
          <h2>Product categories</h2>
        </div>
        <span className="merchant-badge">
          {products.length} products sampled
          {offers[0]?.sampleOrigin === 'seed' ? ' / Demo data' : ''}
        </span>
      </div>
      <div className="merchant-category-chart">
        {groups.map((group) => (
          <div className="merchant-category" key={group.category}>
            <span>{group.category}</span>
            <meter
              min={0}
              max={Math.max(products.length, 1)}
              value={group.count}
              aria-label={`${group.category} products`}
            />
            <strong>{group.count}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
