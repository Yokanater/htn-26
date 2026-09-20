/** Synthetic/demo merchant workspace. Owner: L4 (S4-L4-1). Access is not store ownership. */
import {
  type MerchantCollaborationDraft,
  MerchantCollaborationDraftSchema,
  type MerchantOpportunity,
  MerchantOpportunityListSchema,
  MerchantOpportunitySchema,
  type MerchantWorkspaceProfile,
  MerchantWorkspaceProfileSchema,
} from '@sei/contracts';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Copy, RefreshCw, ShieldCheck, Store } from 'lucide-react';
import { useState } from 'react';
import { ApiError, json } from '../../shell/api';

function bandLabel(band: { min: number; max: number } | null): string {
  if (!band) return 'Not observed for this pairing';
  return `${band.min}–${band.max}`;
}

export function MerchantWorkspace({ back }: { back: () => void }) {
  const [url, setUrl] = useState('https://outfit-brand-1.example/');
  const [proposalText, setProposalText] = useState('');
  const [uncertaintiesText, setUncertaintiesText] = useState('');
  const [copied, setCopied] = useState(false);
  const [profile, setProfile] = useState<MerchantWorkspaceProfile | null>(null);
  const [opportunities, setOpportunities] = useState<MerchantOpportunity[]>([]);
  const [draft, setDraft] = useState<MerchantCollaborationDraft | null>(null);

  const clearWorkspace = () => {
    setProfile(null);
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
        opportunities: listed.opportunities.map((item) => MerchantOpportunitySchema.parse(item)),
      };
    },
    onMutate: clearWorkspace,
    onError: clearWorkspace,
    onSuccess: (result) => {
      setProfile(result.profile);
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
          <p className="eyebrow">SYNTHETIC/DEMO MERCHANT WORKSPACE</p>
          <h1>
            See the demand between <em>categories.</em>
          </h1>
          <p>
            Claiming a URL opens a labeled demo workspace for this session. It does not verify
            ownership or connect a live store.
          </p>
          <form
            className="merchant-url-form"
            onSubmit={(event) => {
              event.preventDefault();
              profileStore.mutate(url);
            }}
          >
            <label>
              <span>PUBLIC HTTPS STORE URL</span>
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://outfit-brand-1.example/"
                autoComplete="url"
                aria-label="Public HTTPS store URL"
              />
            </label>
            <button className="primary" type="submit" disabled={profileStore.isPending}>
              {profileStore.isPending ? (
                <RefreshCw className="spin" aria-hidden />
              ) : (
                <Store aria-hidden />
              )}{' '}
              Profile demo store <ArrowRight aria-hidden />
            </button>
          </form>
          {profileStore.error && (
            <p className="form-error" role="alert">
              {profileStore.error.message}
            </p>
          )}
          <p className="coming-note">
            Seed `.example` stores stay in-memory. A live public catalog profile is opt-in and does
            not turn seed cohort bands into live demand. Counts are coarse bands from synthetic
            aggregates, not live shopper histories.
          </p>
        </div>
        {profile ? (
          <section className="signal-preview" aria-label="Profiled synthetic merchant">
            <div className="preview-top">
              <span>
                {profile.sampleOrigin === 'live'
                  ? 'Live public catalog profile'
                  : 'SYNTHETIC DEMO MERCHANT'}
              </span>
              <Store aria-hidden />
            </div>
            <p>{profile.merchant.domain.toUpperCase()}</p>
            <h2>{profile.merchant.name}</h2>
            <div className="signal-count">
              <strong>{profile.categories.length}</strong>
              <span>
                public categories
                <br />
                in this demo catalog
              </span>
            </div>
            <div className="signal-row">
              <span>Workspace</span>
              <strong>Synthetic/demo</strong>
            </div>
            <div className="signal-row">
              <span>Sample origin</span>
              <strong>{profile.sampleOrigin}</strong>
            </div>
            <div className="signal-foot">
              <ShieldCheck aria-hidden /> No shopper images, briefs, or individual histories
            </div>
          </section>
        ) : (
          <section
            className="signal-preview"
            aria-label="Example merchant opportunity, synthetic preview"
          >
            <div className="preview-top">
              <span>SYNTHETIC PREVIEW</span>
              <Store aria-hidden />
            </div>
            <p>OUTFIT · CANADA · LAST 30 DAYS</p>
            <h2>Structured layers + everyday bags</h2>
            <div className="signal-count">
              <strong>5–9</strong>
              <span>
                eligible sessions
                <br />
                in this coarse cohort
              </span>
            </div>
            <div className="signal-row">
              <span>Observed pair support</span>
              <strong>5–9</strong>
            </div>
            <div className="signal-foot">
              <ShieldCheck aria-hidden /> No shopper images or individual histories
            </div>
          </section>
        )}
      </section>

      {opportunities.length > 0 && (
        <section className="merchant-opportunity-list" aria-label="Synthetic opportunities">
          <p className="eyebrow">DEMO OPPORTUNITIES</p>
          <h2>Labeled cohort evidence, not ownership.</h2>
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
                <p className="opportunity-unknowns">{opportunity.uncertainties[0]}</p>
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
          <h2>Editable outreach. Unknowns stay unknown.</h2>
          <label>
            Proposal
            <textarea
              value={proposalText}
              onChange={(event) => setProposalText(event.target.value)}
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
                await navigator.clipboard.writeText(proposalText);
                setCopied(true);
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
