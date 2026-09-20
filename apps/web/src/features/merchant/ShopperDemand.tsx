import { MerchantDemandSummarySchema } from '@sei/contracts';
import { useQuery } from '@tanstack/react-query';
import { json } from '../../shell/api';

export function ShopperDemand({ merchantId }: { merchantId: string }) {
  const demo = useQuery({
    queryKey: ['demo'],
    queryFn: () => json<{ enabled?: boolean; merchantNames?: Record<string, string> }>('/api/demo'),
    retry: false,
    staleTime: Infinity,
  });
  const demand = useQuery({
    queryKey: ['merchant-demand', merchantId],
    queryFn: async () =>
      MerchantDemandSummarySchema.array().parse(await json(`/api/merchants/${merchantId}/demand`)),
    refetchInterval: 60_000,
  });
  return (
    <section className="brand-research" aria-label="Shopper demand">
      <h2>What shoppers are looking for</h2>
      <p>
        Confirmed shopping needs that overlap your catalog. Counts include shoppers who chose to
        share their preferences.{' '}
        {demo.data?.enabled
          ? 'Insights refresh when you open this view.'
          : 'Insights refresh every 15 minutes.'}
      </p>
      {demand.isPending ? (
        <p>Loading shopper insights…</p>
      ) : demand.isError ? (
        <p role="alert">Shopper insights could not load.</p>
      ) : !demand.data?.length ? (
        <p>
          There isn’t enough shared demand yet. Insights appear after at least five consenting
          sessions share matching needs.
        </p>
      ) : (
        demand.data.map((summary) => (
          <article key={summary.aggregateId} className="opportunity-card">
            {summary.sampleOrigin === 'replay' && (
              <p className="merchant-badge">
                Sample insights · includes synthetic data · not purchases
              </p>
            )}
            <h3>{summary.cohort.categories.join(' + ')}</h3>
            <p>
              {summary.eligibleSessions?.min}–{summary.eligibleSessions?.max} consenting sessions ·{' '}
              {summary.cohort.country} · {summary.cohort.currency}
            </p>
            {(summary.pairSupport ?? [])
              .filter((pair) => pair.merchantIds.includes(merchantId))
              .map((pair) => (
                <p key={pair.merchantIds.join(':')}>
                  {pair.merchantIds
                    .map(
                      (id) =>
                        demo.data?.merchantNames?.[id] ??
                        (id === merchantId ? 'Your store' : 'Another store'),
                    )
                    .join(' + ')}
                  : selected together in {pair.support.min}–{pair.support.max} consenting sessions.
                </p>
              ))}
            <p>
              {summary.merchantSupport?.find((entry) => entry.merchantId === merchantId)
                ? `${summary.merchantSupport.find((entry) => entry.merchantId === merchantId)!.support.min}–${summary.merchantSupport.find((entry) => entry.merchantId === merchantId)!.support.max} sessions selected products from your store.`
                : 'Catalog overlap suggests potential interest. There is not enough evidence to report selection of your brand.'}
            </p>
            <p>
              {summary.windowStart.slice(0, 10)} to {summary.windowEnd.slice(0, 10)}
            </p>
          </article>
        ))
      )}
    </section>
  );
}
