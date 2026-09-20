/** Synthetic/demo merchant workspace. Owner: L4 (S4-L4-1). Access is not store ownership. */
import {
  type MerchantCollaborationDraft,
  MerchantCollaborationDraftSchema,
  type MerchantOpportunity,
  MerchantOpportunityListSchema,
  MerchantOpportunitySchema,
  type MerchantWorkspaceProfile,
  MerchantWorkspaceProfileSchema,
  type ProductOffer,
  ProductOfferSchema,
} from '@sei/contracts';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Copy, RefreshCw, Store } from 'lucide-react';
import { useState } from 'react';
import { ApiError, json } from '../../shell/api';
import { BrandResearch } from './BrandResearch';
import { CatalogInsights } from './CatalogInsights';
import { ShopperDemand } from './ShopperDemand';
import './merchant.css';

function bandLabel(band: { min: number; max: number } | null): string {
  if (!band) return 'Not observed for this pairing';
  return `${band.min}–${band.max}`;
}

export function MerchantWorkspace({
  back,
  initialUrl = '',
}: {
  back: () => void;
  initialUrl?: string;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [proposalText, setProposalText] = useState('');
  const [uncertaintiesText, setUncertaintiesText] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [offers, setOffers] = useState<ProductOffer[]>([]);
  const [profile, setProfile] = useState<MerchantWorkspaceProfile | null>(null);
  const [opportunities, setOpportunities] = useState<MerchantOpportunity[]>([]);
  const [draft, setDraft] = useState<MerchantCollaborationDraft | null>(null);

  const clearWorkspace = () => {
    setProfile(null);
    setOffers([]);
    setCopyError('');
    setOpportunities([]);
    setDraft(null);
    setProposalText('');
    setUncertaintiesText('');
    setCopied(false);
  };

  const profileStore = useMutation({
    mutationFn: async (storeUrl: string) => {
      const created = MerchantWorkspaceProfileSchema.parse(
        await json<MerchantWorkspaceProfile>('/api/merchants/profile', {
          method: 'POST',
          body: JSON.stringify({ url: storeUrl }),
        }),
      );
      const listed = MerchantOpportunityListSchema.parse(
        await json<{ opportunities: MerchantOpportunity[] }>(
          `/api/merchants/${created.merchant.id}/opportunities`,
        ),
      );
      return {
        profile: created,
        offers: ProductOfferSchema.array().parse(
          await json<unknown>(`/api/merchants/${created.merchant.id}/catalog`),
        ),
        opportunities: listed.opportunities.map((item) => MerchantOpportunitySchema.parse(item)),
      };
    },
    onMutate: clearWorkspace,
    onError: clearWorkspace,
    onSuccess: (result) => {
      setProfile(result.profile);
      setOffers(result.offers);
      setOpportunities(result.opportunities);
      setDraft(null);
      setProposalText('');
      setUncertaintiesText('');
    },
  });

  const createDraft = useMutation({
    mutationFn: async (opportunity: MerchantOpportunity) => {
      if (!profile) throw new Error('Profile the store first.');
      return MerchantCollaborationDraftSchema.parse(
        await json<MerchantCollaborationDraft>(
          `/api/merchants/${profile.merchant.id}/opportunities/${opportunity.id}/drafts`,
          { method: 'POST', body: '{}' },
        ),
      );
    },
    onSuccess: (created) => {
      setDraft(created);
      setProposalText(created.proposalText);
      setUncertaintiesText(created.uncertainties.join('\n'));
    },
  });

  const saveDraft = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error('Create a draft first.');
      const uncertainties = uncertaintiesText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      return MerchantCollaborationDraftSchema.parse(
        await json<MerchantCollaborationDraft>(`/api/drafts/${draft.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            expectedVersion: draft.version,
            proposalText,
            uncertainties,
          }),
        }),
      );
    },
    onSuccess: (updated) => {
      setDraft(updated);
      setProposalText(updated.proposalText);
      setUncertaintiesText(updated.uncertainties.join('\n'));
    },
  });

  const reloadDraft = useMutation({
    mutationFn: async (draftId: string) =>
      MerchantCollaborationDraftSchema.parse(
        await json<MerchantCollaborationDraft>(`/api/drafts/${draftId}`),
      ),
    onSuccess: (latest) => {
      setDraft(latest);
      setProposalText(latest.proposalText);
      setUncertaintiesText(latest.uncertainties.join('\n'));
      saveDraft.reset();
    },
  });

  return (
    <main className="workspace-main merchant-workspace merchant-workspace-live">
      <button className="back-button" type="button" onClick={back}>
        <ArrowLeft aria-hidden /> Back to both paths
      </button>
      <section className="merchant-hero">
        <div>
          <p className="eyebrow">MERCHANT INTELLIGENCE</p>
          <h1>
            Bundles, partners <em>and competitors.</em>
          </h1>
          <p>
            Enter your store URL to find bundle products, potential partners and competing brands.
          </p>
          <form
            className="merchant-url-form"
            onSubmit={(event) => {
              event.preventDefault();
              createDraft.reset();
              saveDraft.reset();
              reloadDraft.reset();
              profileStore.mutate(url);
            }}
          >
            <label>
              <span>STORE URL</span>
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="your-store.com"
                required
                autoComplete="url"
                aria-label="Public store URL"
              />
            </label>
            <button
              className="primary"
              type="submit"
              disabled={
                profileStore.isPending ||
                createDraft.isPending ||
                saveDraft.isPending ||
                reloadDraft.isPending
              }
            >
              {profileStore.isPending ? (
                <RefreshCw className="spin" aria-hidden />
              ) : (
                <Store aria-hidden />
              )}{' '}
              {profileStore.isPending ? 'Inspecting catalog…' : 'Analyze store'}{' '}
              <ArrowRight aria-hidden />
            </button>
          </form>
          <details className="merchant-demo-disclosure">
            <summary>Explore a sample store</summary>
            <div className="merchant-demo-actions">
              <button
                className="text-button"
                type="button"
                onClick={() => setUrl('https://outfit-brand-1.example/')}
              >
                Try outfit demo
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => setUrl('https://setup-brand-1.example/')}
              >
                Try setup demo
              </button>
            </div>
            <p className="coming-note">
              Demo stores use sample data. No store connection or login required.
            </p>
          </details>
          {profileStore.isPending && (
            <p className="merchant-research-status" role="status">
              Loading your store. Large catalogs can take up to four minutes.
            </p>
          )}
          {profileStore.error && (
            <p className="form-error" role="alert">
              {profileStore.error.message}
            </p>
          )}
        </div>
        {profile ? (
          <details className="merchant-profile-chart">
            <summary>Catalog overview · {offers.length} sampled offers</summary>
            <p className="merchant-store-name">{profile.merchant.name}</p>
            <CatalogInsights offers={offers} />
          </details>
        ) : null}
      </section>
      {profile && (
        <>
          <BrandResearch
            key={profile.merchant.id + offers[0]?.evidence[0]?.capturedAt}
            profile={profile}
          />
          <details className="merchant-secondary" open={profile.sampleOrigin === 'replay'}>
            <summary>Shopper demand insights</summary>
            <ShopperDemand merchantId={profile.merchant.id} />
          </details>
        </>
      )}
      {opportunities.length > 0 && (
        <section className="merchant-opportunity-list" aria-label="Synthetic opportunities">
          <p className="eyebrow">DEMO OPPORTUNITIES</p>
          <h2>Demo collaboration</h2>
          <div className="opportunity-grid">
            {opportunities.map((opportunity) => (
              <article className="opportunity-card" key={opportunity.id}>
                <span className="synthetic-label">
                  {opportunity.basis === 'observed_pair'
                    ? 'Observed pair · synthetic'
                    : 'Inferred supply fit · synthetic'}
                </span>
                <p className="demand-origin">Synthetic demand opportunity</p>
                <h3>
                  {opportunity.merchants[0].name} + {opportunity.merchants[1].name}
                </h3>
                <p>{opportunity.demand.cohort.categories.join(' · ')}</p>
                <dl>
                  <div>
                    <dt>Eligible sessions</dt>
                    <dd>{bandLabel(opportunity.demand.eligibleSessions)}</dd>
                  </div>
                  <div>
                    <dt>Observed pair support</dt>
                    <dd>{bandLabel(opportunity.observedPairSupport)}</dd>
                  </div>
                </dl>
                <p>{opportunity.proposedExperiment}</p>
                <details>
                  <summary>Evidence and limitations</summary>
                  <p>
                    {opportunity.demand.cohort.country} · {opportunity.demand.cohort.currency} ·{' '}
                    {opportunity.demand.cohort.domain}
                  </p>
                  <p>
                    {opportunity.demand.windowStart.slice(0, 10)} to{' '}
                    {opportunity.demand.windowEnd.slice(0, 10)}
                  </p>
                  <p>
                    Aggregate {opportunity.demand.aggregateId} · revision{' '}
                    {opportunity.demand.aggregateVersion}
                  </p>
                  <ul>
                    {opportunity.uncertainties.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </details>
                <button
                  className="primary"
                  type="button"
                  disabled={createDraft.isPending}
                  onClick={() => createDraft.mutate(opportunity)}
                >
                  Create collaboration draft
                </button>
              </article>
            ))}
          </div>
          {createDraft.error && (
            <p className="form-error" role="alert">
              {createDraft.error.message}
            </p>
          )}
        </section>
      )}

      {draft && (
        <section className="merchant-draft-editor" aria-label="Collaboration draft">
          <p className="eyebrow">
            DRAFT · VERSION {draft.version} · NOT APPROVED · Synthetic demand opportunity
          </p>
          <h2>Edit collaboration draft</h2>
          <label>
            Proposal
            <textarea
              value={proposalText}
              onChange={(event) => {
                setProposalText(event.target.value);
                setCopied(false);
              }}
              rows={6}
            />
          </label>
          <label>
            Uncertainties (one per line)
            <textarea
              value={uncertaintiesText}
              onChange={(event) => setUncertaintiesText(event.target.value)}
              rows={4}
            />
          </label>
          {saveDraft.error && (
            <div className="form-error" role="alert">
              <p>{saveDraft.error.message}</p>
              {saveDraft.error instanceof ApiError &&
                saveDraft.error.code === 'REVISION_CONFLICT' && (
                  <button
                    className="text-button"
                    type="button"
                    disabled={reloadDraft.isPending}
                    onClick={() => reloadDraft.mutate(draft.id)}
                  >
                    Reload latest draft
                  </button>
                )}
            </div>
          )}
          {reloadDraft.error && (
            <p className="form-error" role="alert">
              {reloadDraft.error.message}
            </p>
          )}
          {copyError && <p role="alert">{copyError}</p>}
          {saveDraft.isSuccess && <p role="status">Draft saved.</p>}
          <div className="draft-actions">
            <button
              className="primary"
              type="button"
              disabled={saveDraft.isPending}
              onClick={() => saveDraft.mutate()}
            >
              Save draft
            </button>
            <button
              className="text-button"
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(proposalText);
                  setCopied(true);
                  setCopyError('');
                } catch {
                  setCopyError('Copy failed. Select the proposal text and copy it manually.');
                }
              }}
            >
              <Copy aria-hidden /> {copied ? 'Copied proposal' : 'Copy proposal'}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
