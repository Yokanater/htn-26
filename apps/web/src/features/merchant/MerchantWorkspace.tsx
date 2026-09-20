import type {
  CollaborationDraft,
  MerchantOpportunity,
  MerchantProfile,
  MerchantRun,
  ProductOffer,
  ShoppingDomain,
} from '@sei/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Store,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { json } from '../../shell/api';
import './merchant.css';

type Comparison = {
  opportunities: MerchantOpportunity[];
  offers: ProductOffer[];
  message: string;
  candidates?: { profile: MerchantProfile; complementaryCategories: string[]; stale: boolean }[];
};
const stages = ['Capture catalog', 'Review products', 'Compare evidence', 'Draft collaboration'];

function ProductProof({ offer }: { offer: ProductOffer }) {
  return (
    <details className="merchant-proof">
      <summary>
        {offer.title} <span>{offer.category}</span>
      </summary>
      <p>
        {offer.price
          ? new Intl.NumberFormat('en-CA', {
              style: 'currency',
              currency: offer.price.currency,
            }).format(offer.price.amount / 100)
          : 'Price unknown'}{' '}
        · {offer.availability}
      </p>
      <p>
        {offer.shipsTo
          ? `Ships to ${offer.shipsTo.join(', ')}`
          : 'Shipping eligibility needs verification'}
      </p>
      {offer.evidence.map((fact) => (
        <blockquote key={fact.id}>
          <p>{fact.value}</p>
          <a href={fact.url} target="_blank" rel="noreferrer">
            {fact.field} · {new Date(fact.capturedAt).toLocaleString()} <ExternalLink size={12} />
          </a>
          <small>{fact.id}</small>
        </blockquote>
      ))}
    </details>
  );
}

function DraftEditor({ initial }: { initial: CollaborationDraft }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const saved = useMutation({
    mutationFn: () =>
      json<CollaborationDraft>(`/api/drafts/${draft.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          expectedRevision: draft.revision,
          title: draft.title,
          experiment: draft.experiment,
          outreach: draft.outreach,
          merchantNotes: draft.merchantNotes,
        }),
      }),
    onSuccess: (value) => {
      setDraft(value);
      setDirty(false);
      setNotice('Draft saved in this workspace.');
      void client.invalidateQueries({ queryKey: ['merchant-drafts'] });
    },
  });
  const exportDraft = useMutation({
    mutationFn: async (copy: boolean) => {
      const current = await json<CollaborationDraft>(`/api/drafts/${draft.id}`); // revalidate consent/catalog before export
      const content = `${current.title}\n\n${current.hypothesis}\n\nExperiment\n${current.experiment}\n\nOutreach\n${current.outreach}\n\nMerchant notes (unverified)\n${current.merchantNotes}\n\nUnknowns\n${current.opportunity.uncertainties.join('\n')}\n\nEvidence IDs\n${current.opportunity.productEvidenceIds.join('\n')}\n\n${current.warnings.join('\n')}`;
      if (copy) await navigator.clipboard.writeText(content);
      else {
        const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `collaboration-${current.id}.txt`;
        a.click();
        URL.revokeObjectURL(url);
      }
      return copy;
    },
    onSuccess: (copy) =>
      setNotice(copy ? 'Copied. Review before sharing with a partner.' : 'Draft downloaded.'),
  });
  const change = (key: 'title' | 'experiment' | 'outreach' | 'merchantNotes', value: string) => {
    setDraft({ ...draft, [key]: value });
    setDirty(true);
    setNotice('');
  };
  return (
    <section className="merchant-draft">
      <p className="eyebrow">
        COLLABORATION DRAFT · REVISION {draft.revision} ·{' '}
        {draft.generatedBy === 'baseten' ? 'BASETEN EXPERIMENT SELECTION' : 'EVIDENCE TEMPLATE'}
      </p>
      <h2>Make the first conversation useful.</h2>
      <aside className="merchant-evidence">
        <strong>Evidence summary · read only</strong>
        <p>{draft.hypothesis}</p>
      </aside>
      <label>
        Proposal title
        <input
          value={draft.title}
          maxLength={160}
          onChange={(e) => change('title', e.target.value)}
        />
      </label>
      <label>
        Small experiment
        <textarea
          value={draft.experiment}
          maxLength={2000}
          rows={4}
          onChange={(e) => change('experiment', e.target.value)}
        />
      </label>
      <label>
        Outreach draft
        <textarea
          value={draft.outreach}
          maxLength={5000}
          rows={12}
          onChange={(e) => change('outreach', e.target.value)}
        />
      </label>
      <label>
        Your terms and notes (unverified)
        <textarea
          value={draft.merchantNotes}
          maxLength={5000}
          rows={3}
          placeholder="Costs, asset permissions, fulfillment questions, or proposed next steps"
          onChange={(e) => change('merchantNotes', e.target.value)}
        />
      </label>
      <p>
        Edits are merchant-authored and unverified. Costs, willingness and fulfillment remain
        unknown until agreed. Nothing is sent or published.
      </p>
      {draft.warnings.map((warning) => (
        <p className="merchant-warning" key={warning}>
          {warning}
        </p>
      ))}
      <div className="merchant-actions">
        <button
          className="primary"
          type="button"
          disabled={saved.isPending || !dirty}
          onClick={() => saved.mutate()}
        >
          Save changes
        </button>
        <button
          type="button"
          disabled={dirty || exportDraft.isPending}
          onClick={() => exportDraft.mutate(true)}
        >
          Copy proposal
        </button>
        <button
          type="button"
          disabled={dirty || exportDraft.isPending}
          onClick={() => exportDraft.mutate(false)}
        >
          Download draft
        </button>
      </div>
      {dirty && <small>Save your edits before copying or downloading.</small>}
      {(saved.error || exportDraft.error) && (
        <p role="alert" className="form-error">
          {(saved.error || exportDraft.error)?.message}
        </p>
      )}
      <p role="status">{notice}</p>
    </section>
  );
}

export function MerchantWorkspace({ back }: { back: () => void }) {
  const client = useQueryClient();
  const [domain, setDomain] = useState<ShoppingDomain>('outfit');
  const [url, setUrl] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [profile, setProfile] = useState<MerchantProfile | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [selected, setSelected] = useState<MerchantOpportunity | null>(null);
  const [draft, setDraft] = useState<CollaborationDraft | null>(null);
  const handledRun = useRef<string | null>(null);
  const settings = useQuery({
    queryKey: ['merchant-settings'],
    queryFn: () =>
      json<{ provider: string; stores: string[]; retention: string }>('/api/merchants/settings'),
  });
  const profiles = useQuery({
    queryKey: ['merchant-profiles'],
    queryFn: () => json<MerchantProfile[]>('/api/merchants/profiles'),
  });
  const drafts = useQuery({
    queryKey: ['merchant-drafts'],
    queryFn: () =>
      json<{ id: string; title: string; revision: number; status: string }[]>('/api/drafts'),
  });
  const reopen = useMutation({
    mutationFn: (id: string) => json<CollaborationDraft>(`/api/drafts/${id}`),
    onSuccess: setDraft,
  });
  const start = useMutation({
    mutationFn: (storeUrl?: string) =>
      json<MerchantRun>('/api/merchants/profile', {
        method: 'POST',
        body: JSON.stringify({ url: (storeUrl ?? url).startsWith('https://') ? (storeUrl ?? url) : `https://${storeUrl ?? url}`, domain: profile?.domain ?? domain }),
      }),
    onSuccess: (run) => {
      setRunId(run.id);
      setProfile(null);
      setComparison(null);
      setDraft(null);
      setSelected(null);
      client.setQueryData(['merchant-run', run.id], run);
    },
  });
  const run = useQuery({
    queryKey: ['merchant-run', runId],
    enabled: Boolean(runId),
    queryFn: () => json<MerchantRun>(`/api/merchants/runs/${runId}`),
    retry: 1,
    refetchInterval: (query) =>
      query.state.error ? false : query.state.data?.status === 'running' ? 1000 : false,
  });
  useEffect(() => {
    if (
      run.data &&
      run.data.status !== 'running' &&
      run.data.profile &&
      handledRun.current !== run.data.id
    ) {
      handledRun.current = run.data.id;
      setProfile(run.data.profile);
      void client.invalidateQueries({ queryKey: ['merchant-profiles'] });
    }
  }, [run.data, client]);
  const cancel = useMutation({
    mutationFn: () => json<MerchantRun>(`/api/merchants/runs/${runId}`, { method: 'DELETE' }),
    onSuccess: (value) => client.setQueryData(['merchant-run', runId], value),
  });
  const confirm = useMutation({
    mutationFn: () => {
      if (!profile) throw new Error('Choose a catalog first.');
      return json<MerchantProfile>(`/api/merchants/profiles/${profile.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          categories: profile.offers.map((offer) => ({
            offerId: offer.id,
            category: offer.category,
          })),
        }),
      });
    },
    onSuccess: (value) => {
      setProfile(value);
      setComparison(null);
      setDraft(null);
      void client.invalidateQueries({ queryKey: ['merchant-profiles'] });
    },
  });
  const compare = useMutation({
    mutationFn: () => json<Comparison>(`/api/merchants/${profile?.id}/opportunities`),
    onSuccess: (value) => {
      setComparison(value);
      setSelected(value.opportunities[0] ?? null);
      setDraft(null);
    },
  });
  const compose = useMutation({
    mutationFn: () =>
      json<CollaborationDraft>(`/api/opportunities/${selected?.id}/drafts`, { method: 'POST' }),
    onSuccess: (value) => {
      setDraft(value);
      void client.invalidateQueries({ queryKey: ['merchant-drafts'] });
    },
  });
  const busy = start.isPending || run.data?.status === 'running';
  const step = draft ? 3 : comparison ? 2 : profile ? 1 : 0;
  const error =
    start.error ||
    run.error ||
    cancel.error ||
    confirm.error ||
    compare.error ||
    compose.error ||
    settings.error ||
    reopen.error;
  return (
    <main className="workspace-main merchant-studio">
      <button className="back-button" type="button" onClick={back}>
        <ArrowLeft /> Back to both paths
      </button>
      <div className="merchant-heading">
        <div>
          <p className="eyebrow">COMMON GROUND / MERCHANT STUDIO</p>
          <h1>
            Find your next <em>good fit.</em>
          </h1>
          <p>From your catalog to a grounded partner conversation.</p>
        </div>
        <span className="merchant-mode">
          <ShieldCheck size={16} />
          {settings.data?.provider === 'synthetic'
            ? 'SYNTHETIC DEMONSTRATION'
            : 'PRIVATE WORKSPACE'}
        </span>
      </div>
      <ol className="merchant-steps">
        {stages.map((label, index) => (
          <li key={label} aria-current={index === step ? 'step' : undefined}>
            <span>{index < step ? <Check size={16} /> : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <div className="merchant-layout">
        <aside className="merchant-sidebar">
          <h2>
            <Store size={20} /> Your catalog
          </h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              start.mutate();
            }}
          >
            <label>
              Collection domain
              <select
                value={domain}
                disabled={busy}
                onChange={(e) => {
                  setDomain(e.target.value as ShoppingDomain);
                  setUrl('');
                }}
              >
                <option value="outfit">Outfits</option>
                <option value="setup">Room & desk setups</option>
              </select>
            </label>
            <label htmlFor="merchant-store-url">
              Public Shopify store
              {settings.data?.provider === 'synthetic' ? (
                <select
                  id="merchant-store-url"
                  required
                  value={url}
                  disabled={busy}
                  onChange={(e) => setUrl(e.target.value)}
                >
                  <option value="">Choose a demo store</option>
                  {settings.data.stores
                    .filter((store) => store.startsWith(domain))
                    .map((store) => (
                      <option key={store}>{store}</option>
                    ))}
                </select>
              ) : (
                <input
                  id="merchant-store-url"
                  required
                  value={url}
                  disabled={busy}
                  placeholder="your-store.com"
                  onChange={(e) => setUrl(e.target.value)}
                />
              )}
            </label>
            <button className="primary wide" type="submit" disabled={busy || !url}>
              {busy ? <RefreshCw className="spin" size={16} /> : <ArrowRight size={16} />}{' '}
              {busy ? 'Scanning catalog' : 'Profile store'}
            </button>
          </form>
          <p className="merchant-subtle">
            Enter your store once. We automatically search for complementary merchants and verify
            their public catalogs. No partner URLs or domain whitelist needed.
          </p>
          <h3>Workspace catalogs</h3>
          {(profiles.data ?? []).map((item) => (
            <button
              className={`merchant-catalog-choice ${profile?.id === item.id ? 'selected' : ''}`}
              key={item.id}
              type="button"
              disabled={busy}
              onClick={() => {
                setProfile(item);
                setRunId(null);
                setComparison(null);
                setSelected(null);
                setDraft(null);
              }}
            >
              <strong>{item.merchant.name}</strong>
              <small>
                {item.discoveredFor ? 'Discovered partner' : item.domain} · {item.offers.length}{' '}
                variants ·{' '}
                {item.confirmed
                  ? 'confirmed'
                  : item.discoveredFor
                    ? 'inferred fit'
                    : 'review needed'}
              </small>
            </button>
          ))}
          <p className="merchant-subtle">
            {settings.data?.retention} Download proposals you want to keep.
          </p>
          <h3>Saved proposals</h3>
          {(drafts.data ?? []).map((item) => (
            <button
              type="button"
              className="merchant-catalog-choice"
              key={item.id}
              disabled={item.status === 'stale' || reopen.isPending}
              onClick={() => reopen.mutate(item.id)}
            >
              <strong>{item.title}</strong>
              <small>
                Revision {item.revision} ·{' '}
                {item.status === 'stale'
                  ? 'Evidence changed — create a fresh draft'
                  : 'Open proposal'}
              </small>
            </button>
          ))}
        </aside>
        <div className="merchant-content">
          {error && (
            <p className="form-error" role="alert">
              {error.message}
            </p>
          )}
          {run.data && (
            <section className="merchant-progress" aria-label="Catalog scan progress">
              <div className="merchant-section-heading">
                <h2>
                  {run.data.status === 'running'
                    ? 'Your catalog, coming into focus.'
                    : `Catalog scan · ${run.data.status}`}
                </h2>
                {run.data.status === 'running' && (
                  <button type="button" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                    <X size={14} /> Cancel scan
                  </button>
                )}
              </div>
              <p>
                {run.data.sampleOrigin === 'seed'
                  ? 'Offline demonstration. No Browserbase or Baseten calls.'
                  : 'Browserbase captures public pages. Baseten extracts facts. Verified storefront records provide variants and prices.'}
              </p>
              <ol aria-live="polite">
                {run.data.events.map((event) => (
                  <li key={event.sequence}>
                    <time>{new Date(event.at).toLocaleTimeString()}</time>
                    <span>
                      <strong>{event.stage}</strong>
                      {event.message}
                    </span>
                    {event.productCount > 0 && <b>{event.productCount} variants</b>}
                  </li>
                ))}
              </ol>
              {run.data.liveViewUrl && (
                <details open>
                  <summary>Watch the read-only browser</summary>
                  <iframe
                    title="Browserbase public catalog live view"
                    src={run.data.liveViewUrl}
                    sandbox="allow-scripts allow-same-origin"
                    referrerPolicy="no-referrer"
                  />
                </details>
              )}
              {run.error && (
                <button type="button" onClick={() => void run.refetch()}>
                  Reconnect progress
                </button>
              )}
            </section>
          )}
          {!profile && !busy && !run.data && (
            <section className="merchant-empty">
              <p className="eyebrow">START WITH WHAT YOU SELL</p>
              <h2>A useful partnership starts with product proof.</h2>
              <p>
                We’ll capture your catalog, help you confirm it, and compare it with eligible
                consented demand. Every proposal keeps the evidence and unknowns attached.
              </p>
              <div>
                <span>01 / Source products</span>
                <span>02 / Find complementary supply</span>
                <span>03 / Test a small idea</span>
              </div>
            </section>
          )}
          {profile && (
            <section className="merchant-review">
              <p className="eyebrow">
                {profile.sampleOrigin === 'seed' ? 'SYNTHETIC CATALOG' : 'PUBLIC CATALOG'} ·{' '}
                {profile.domain}
              </p>
              <h2>{profile.merchant.name}</h2>
              <p>
                Review categories before using them for demand comparison. Expand a product to
                inspect source evidence.
              </p>
              {profile.warnings.map((warning) => (
                <p className="merchant-warning" key={warning}>
                  {warning}
                </p>
              ))}
              <div className="merchant-products">
                {profile.offers.map((offer) => (
                  <article key={offer.id}>
                    <ProductProof offer={offer} />
                    <label>
                      Category for {offer.title}
                      <input
                        value={offer.category}
                        maxLength={80}
                        disabled={confirm.isPending}
                        onChange={(e) => {
                          setProfile({
                            ...profile,
                            confirmed: false,
                            offers: profile.offers.map((item) =>
                              item.id === offer.id ? { ...item, category: e.target.value } : item,
                            ),
                          });
                          setComparison(null);
                          setDraft(null);
                        }}
                      />
                    </label>
                  </article>
                ))}
              </div>
              <div className="merchant-actions">
                <button
                  className="primary"
                  type="button"
                  disabled={
                    confirm.isPending ||
                    profile.confirmed ||
                    profile.offers.some((offer) => !offer.category.trim())
                  }
                  onClick={() => confirm.mutate()}
                >
                  {profile.confirmed ? 'Catalog confirmed' : 'Confirm reviewed catalog'}
                </button>
                <button
                  type="button"
                  disabled={!profile.confirmed || compare.isPending}
                  onClick={() => compare.mutate()}
                >
                  {compare.isPending ? 'Checking eligible demand…' : 'Compare demand & partners'}
                </button>
              </div>
            </section>
          )}
          {comparison && (
            <section className="merchant-comparison">
              <p className="eyebrow">DEMAND & COMPLEMENTARY SUPPLY</p>
              <h2>Evidence before a first hello.</h2>
              <p>{comparison.message}</p>
              <button type="button" disabled={busy} onClick={() => start.mutate(profile?.merchant.domain)}>Explore again</button>
              {Boolean(comparison.candidates?.length) && (
                <section aria-label="Automatically discovered merchants">
                  <h3>Merchants explored for you</h3>
                  <p>Ranked by additional catalog categories. This is inferred supply fit, not evidence of customer demand or partner interest.</p>
                  {comparison.candidates?.map(({ profile: candidate, complementaryCategories, stale }) => (
                    <details className="merchant-evidence" key={candidate.id}>
                      <summary>
                        <strong>{candidate.merchant.name}</strong> · {complementaryCategories.length ? complementaryCategories.join(' + ') : 'Similar catalog; no additional category found'}
                      </summary>
                      <p>{candidate.sampleOrigin === 'seed' ? 'Synthetic catalog' : 'Public catalog'} · {candidate.merchant.domain}</p>
                      <p>{stale ? 'Catalog evidence has expired. Run exploration again before relying on it.' : 'Availability, shipping, terms and willingness still need confirmation.'}</p>
                      {candidate.offers.map((offer) => <ProductProof key={offer.id} offer={offer} />)}
                    </details>
                  ))}
                </section>
              )}
              {comparison.candidates?.length === 0 && <p>No partner catalogs were verified. Run exploration again to search for fresh candidates.</p>}
              <div className="merchant-partners">
                {comparison.opportunities.map((item) => (
                  <button
                    type="button"
                    className={selected?.id === item.id ? 'selected' : ''}
                    key={item.id}
                    onClick={() => {
                      setSelected(item);
                      setDraft(null);
                    }}
                  >
                    <small>
                      {item.basis === 'observed_pair' ? 'OBSERVED PAIR' : 'INFERRED SUPPLY FIT'}
                    </small>
                    <strong>{item.merchants[1].name}</strong>
                    <span>{item.demand.cohort.categories.join(' + ')}</span>
                  </button>
                ))}
              </div>
              {selected && (
                <>
                  <div className="merchant-metrics">
                    <div>
                      <small>Eligible consented sessions</small>
                      <strong>
                        {selected.demand.eligibleSessions?.min}–
                        {selected.demand.eligibleSessions?.max}
                      </strong>
                    </div>
                    <div>
                      <small>Observed pair support</small>
                      <strong>
                        {selected.observedPairSupport
                          ? `${selected.observedPairSupport.min}–${selected.observedPairSupport.max}`
                          : 'Not established'}
                      </strong>
                    </div>
                    <div>
                      <small>Evidence origin</small>
                      <strong>
                        {selected.demand.sampleOrigin === 'live' ? 'Live' : 'Synthetic'}
                      </strong>
                    </div>
                  </div>
                  <p className="merchant-subtle">
                    {selected.demand.cohort.country} · {selected.demand.cohort.currency} ·{' '}
                    {new Date(selected.demand.windowStart).toLocaleDateString()}–
                    {new Date(selected.demand.windowEnd).toLocaleDateString()} ·{' '}
                    {selected.demand.aggregateId} v{selected.demand.aggregateVersion}. Session
                    counts are not verified people or purchases.
                  </p>
                  <h3>Both catalogs, with proof</h3>
                  {comparison.offers
                    .filter((offer) =>
                      offer.evidence.some((fact) => selected.productEvidenceIds.includes(fact.id)),
                    )
                    .map((offer) => (
                      <ProductProof key={offer.id} offer={offer} />
                    ))}
                  <h3>Questions to resolve together</h3>
                  <ul>
                    {selected.uncertainties.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <button
                    className="primary"
                    type="button"
                    disabled={compose.isPending}
                    onClick={() => compose.mutate()}
                  >
                    {compose.isPending
                      ? 'Preparing a cited experiment…'
                      : 'Create collaboration draft'}{' '}
                    <ArrowRight size={16} />
                  </button>
                </>
              )}
            </section>
          )}
          {draft && <DraftEditor key={draft.id} initial={draft} />}
        </div>
      </div>
    </main>
  );
}
