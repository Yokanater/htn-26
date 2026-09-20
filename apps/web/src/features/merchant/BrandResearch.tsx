import {
  type MerchantResearch,
  MerchantResearchSchema,
  type MerchantWorkspaceProfile,
  type ProductOffer,
  type ResearchedBrand,
} from '@sei/contracts';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, ExternalLink, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { json } from '../../shell/api';

function money(amount: number, currency: string) {
  const formatter = new Intl.NumberFormat('en', { style: 'currency', currency });
  return formatter.format(amount / 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2));
}
function priceRange(products: ProductOffer[], currency: string) {
  const prices = products.flatMap((product) =>
    product.price?.currency === currency ? [product.price.amount] : [],
  );
  if (!prices.length) return 'Price not available';
  const min = Math.min(...prices),
    max = Math.max(...prices);
  return min === max ? money(min, currency) : `${money(min, currency)} – ${money(max, currency)}`;
}
function ProductLink({ product }: { product: ProductOffer }) {
  return (
    <div className="research-product">
      {product.imageUrl && (
        <img
          className="research-product-image"
          src={product.imageUrl}
          alt={product.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      )}
      <span className="merchant-badge">{product.category}</span>
      <a href={product.productUrl} target="_blank" rel="noreferrer">
        {product.title}
        <ExternalLink size={14} aria-hidden />
      </a>
      <span>
        {product.price
          ? money(product.price.amount, product.price.currency)
          : 'Price not available'}{' '}
        ·{' '}
        {product.availability === 'available'
          ? 'In stock'
          : product.availability === 'unavailable'
            ? 'Out of stock'
            : 'Check availability'}
      </span>
    </div>
  );
}

function BrandCard({ brand }: { brand: ResearchedBrand }) {
  return (
    <article className="research-brand-card">
      <a
        className="research-brand-name"
        href={`https://${brand.merchant.domain}/`}
        target="_blank"
        rel="noreferrer"
      >
        {brand.merchant.name}
        <ExternalLink size={16} aria-hidden />
      </a>
      <p>{brand.reason}</p>
      <div className="research-brand-products">
        {brand.products.slice(0, 3).map((product) => (
          <ProductLink key={product.id} product={product} />
        ))}
      </div>
    </article>
  );
}

export function BrandResearch({ profile }: { profile: MerchantWorkspaceProfile }) {
  const [country, setCountry] = useState('CA');
  const [category, setCategory] = useState('');
  const [tab, setTab] = useState<'bundles' | 'partners' | 'competitors'>('bundles');
  const [selected, setSelected] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const currency = country === 'US' ? 'USD' : country === 'GB' ? 'GBP' : 'CAD';
  const research = useMutation({
    mutationFn: async () => {
      controller.current?.abort();
      controller.current = new AbortController();
      return MerchantResearchSchema.parse(
        await json<MerchantResearch>(`/api/merchants/${profile.merchant.id}/research`, {
          method: 'POST',
          signal: controller.current.signal,
          body: JSON.stringify({ country, currency, ...(category ? { category } : {}) }),
        }),
      );
    },
    onSuccess: (result) => {
      setSelected(result.competitors.slice(0, 2).map((brand) => brand.merchant.domain));
    },
  });
  const report = research.data;
  return (
    <section className="brand-research" aria-label="Products and brands">
      <div className="merchant-section-heading">
        <div>
          <p className="eyebrow">RESEARCH</p>
          <h2>Products and brands</h2>
        </div>
      </div>
      <p className="merchant-muted">
        Find products to bundle, brands to work with, and stores selling similar products.
      </p>
      <form
        className="research-controls"
        onSubmit={(event) => {
          event.preventDefault();
          research.mutate();
        }}
      >
        <label>
          Category
          <select
            value={category}
            disabled={research.isPending}
            onChange={(event) => {
              setCategory(event.target.value);
              research.reset();
            }}
          >
            <option value="">Largest category</option>
            {profile.categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          Market
          <select
            value={country}
            disabled={research.isPending}
            onChange={(event) => {
              setCountry(event.target.value);
              research.reset();
            }}
          >
            <option value="CA">Canada · CAD</option>
            <option value="US">United States · USD</option>
            <option value="GB">United Kingdom · GBP</option>
          </select>
        </label>
        <button className="primary" disabled={research.isPending} type="submit">
          <Search size={17} aria-hidden />
          {research.isPending ? 'Searching…' : report ? 'Search again' : 'Find products and brands'}
          <ArrowRight size={17} aria-hidden />
        </button>
      </form>
      {research.isPending && (
        <div className="merchant-research-status" role="status">
          <strong>Finding products and checking stores.</strong>
          <p>This can take up to 2½ minutes. Results appear when the search finishes.</p>
          <button type="button" className="text-button" onClick={() => controller.current?.abort()}>
            Cancel search
          </button>
        </div>
      )}
      {research.error && (
        <p role="alert" className="form-error">
          {research.error.name === 'AbortError' ? 'Search cancelled.' : research.error.message}
        </p>
      )}
      {report && !research.isPending && (
        <>
          <p className="research-summary">
            {report.category} · {report.country} ·{' '}
            {report.sampleOrigin === 'seed'
              ? 'Demo results'
              : `Updated ${new Date(report.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
          </p>
          <div className="research-tabs" role="tablist" aria-label="Research results">
            {(
              [
                ['bundles', 'Bundle products', report.bundles.length],
                ['partners', 'Complementary brands', report.partners.length],
                ['competitors', 'Competitors', report.competitors.length],
              ] as const
            ).map(([key, title, count]) => (
              <button
                id={`research-tab-${key}`}
                role="tab"
                aria-selected={tab === key}
                aria-controls="research-results"
                key={key}
                type="button"
                onClick={() => setTab(key)}
              >
                {title}
                <span>{count}</span>
              </button>
            ))}
          </div>
          <div id="research-results" role="tabpanel" aria-labelledby={`research-tab-${tab}`}>
            {tab === 'bundles' && (
              <>
                <p className="merchant-muted">
                  Product combinations to consider. Totals are item prices before shipping or
                  discounts.
                </p>
                <div className="research-bundles">
                  {report.bundles.map((bundle) => (
                    <article className="research-bundle" key={bundle.complementaryProduct.id}>
                      <div className="bundle-products">
                        <ProductLink product={bundle.ownProduct} />
                        <span className="bundle-plus">+</span>
                        <ProductLink product={bundle.complementaryProduct} />
                      </div>
                      <p>{bundle.reason}</p>
                      <div className="bundle-footer">
                        <a
                          href={`https://${bundle.complementaryProduct.merchant.domain}/`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {bundle.complementaryProduct.merchant.name}
                        </a>
                        <strong>
                          {bundle.itemSubtotal
                            ? `${money(bundle.itemSubtotal.amount, bundle.itemSubtotal.currency)} combined`
                            : 'No comparable total'}
                        </strong>
                      </div>
                    </article>
                  ))}
                </div>
                {!report.bundles.length && (
                  <p className="research-empty">
                    No bundle products found. Try another category or market.
                  </p>
                )}
              </>
            )}
            {tab === 'partners' && (
              <>
                <p className="merchant-muted">
                  These stores sell complementary products. Partnership interest has not been
                  checked.
                </p>
                <div className="research-brand-grid">
                  {report.partners.map((brand) => (
                    <BrandCard key={brand.merchant.domain} brand={brand} />
                  ))}
                </div>
                {!report.partners.length && (
                  <p className="research-empty">No complementary brands found in this search.</p>
                )}
              </>
            )}
            {tab === 'competitors' && (
              <>
                <p className="merchant-muted">
                  Stores selling {report.category}. Select up to three to compare with your store.
                  Prices cover the products found, not each store’s full range.
                </p>
                <div className="competitor-select">
                  {report.competitors.map((brand) => (
                    <label key={brand.merchant.domain}>
                      <input
                        type="checkbox"
                        checked={selected.includes(brand.merchant.domain)}
                        disabled={!selected.includes(brand.merchant.domain) && selected.length >= 3}
                        onChange={(event) =>
                          setSelected(
                            event.target.checked
                              ? [...selected, brand.merchant.domain]
                              : selected.filter((value) => value !== brand.merchant.domain),
                          )
                        }
                      />
                      {brand.merchant.name}
                    </label>
                  ))}
                </div>
                {!!report.competitors.length && (
                  <section className="brand-comparison" aria-label="Brand comparison">
                    <article className="comparison-card own">
                      <span className="merchant-badge">Your store</span>
                      <h3>{profile.merchant.name}</h3>
                      <dl>
                        <dt>Category</dt>
                        <dd>{report.category}</dd>
                        <dt>Sampled price range ({report.currency})</dt>
                        <dd>{priceRange(report.comparisonProducts, report.currency)}</dd>
                        <dt>Products in sample</dt>
                        <dd>{report.comparisonProducts.length}</dd>
                      </dl>
                    </article>
                    {report.competitors
                      .filter((brand) => selected.includes(brand.merchant.domain))
                      .map((brand) => (
                        <article className="comparison-card" key={brand.merchant.domain}>
                          <span className="merchant-badge">Similar products</span>
                          <h3>
                            <a
                              href={`https://${brand.merchant.domain}/`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {brand.merchant.name}
                            </a>
                          </h3>
                          <dl>
                            <dt>Category</dt>
                            <dd>{report.category}</dd>
                            <dt>Sampled price range ({report.currency})</dt>
                            <dd>{priceRange(brand.products, report.currency)}</dd>
                            <dt>Products found</dt>
                            <dd>{brand.products.length}</dd>
                          </dl>
                          {brand.products.slice(0, 2).map((product) => (
                            <ProductLink key={product.id} product={product} />
                          ))}
                        </article>
                      ))}
                  </section>
                )}
                {!report.competitors.length && (
                  <p className="research-empty">No competing brands found in this search.</p>
                )}
              </>
            )}
          </div>
          {!!report.gaps.length && (
            <details className="research-gaps">
              <summary>Search limitations ({report.gaps.length})</summary>
              <ul>
                {report.gaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
