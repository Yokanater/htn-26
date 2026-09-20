import type { InspirationAsset, IntentBrief, ShoppingDomain } from '@sei/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  CircleGauge,
  LockKeyhole,
  PackageSearch,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { MerchantWorkspace } from './features/merchant';
import { BriefEditor, type DomainHint } from './features/shopper/brief';
import { MediaIntake, type MediaSelection } from './features/shopper/media';
import { StudioArtwork } from './StudioArtwork';
import { ApiError, json } from './shell/api';
import { CollectionPanel } from './shell/CollectionPanel';

type Surface = 'home' | 'shopper' | 'merchant';

function Brand() {
  return (
    <span className="brand rainforest-logo">
      <img src="/brand/rainforest-logo.png" alt="rainforest" width="1940" height="800" />
    </span>
  );
}

function Home({ enter }: { enter: (surface: Surface) => void }) {
  return (
    <main className="home-clean">
      <section className="hero">
        <div>
          <p className="eyebrow">FOR YOUR LOOK. FOR YOUR SPACE.</p>
          <h1>
            Find what belongs <em>together.</em>
          </h1>
          <p className="lede">
            Bring an image or an idea. Find real products that fit together, across stores.
          </p>
          <div className="hero-actions">
            <button className="primary" type="button" onClick={() => enter('shopper')}>
              Start a collection <ArrowRight aria-hidden />
            </button>
            <button className="text-button" type="button" onClick={() => enter('merchant')}>
              I run a shop <ArrowRight aria-hidden />
            </button>
          </div>
        </div>
        <div className="inspiration-board">
          <div className="board-studies">
            <div className="visual-study outfit-study">
              <StudioArtwork />
              <span>Your next look</span>
            </div>
            <div className="visual-study setup-study">
              <StudioArtwork domain="setup" />
              <span>Your kind of space</span>
            </div>
          </div>
        </div>
      </section>

      <div className="home-notes">
        <p>
          <Store size={18} aria-hidden /> For shops: discover bundles, complementary brands and
          rivals.
        </p>
        <p>
          <LockKeyhole size={18} aria-hidden /> Your uploads stay private. Sharing demand insights
          is your choice.
        </p>
      </div>
    </main>
  );
}

function DomainToggle({
  value,
  onChange,
}: {
  value: ShoppingDomain;
  onChange: (value: ShoppingDomain) => void;
}) {
  return (
    <fieldset className="domain-toggle">
      <legend className="sr-only">Collection type</legend>
      <button type="button" aria-pressed={value === 'outfit'} onClick={() => onChange('outfit')}>
        <ShoppingBag aria-hidden /> Outfit
      </button>
      <button type="button" aria-pressed={value === 'setup'} onClick={() => onChange('setup')}>
        <PackageSearch aria-hidden /> Room or desk
      </button>
    </fieldset>
  );
}

function InspirationReference({ selection }: { selection: MediaSelection | null }) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (selection?.kind !== 'image') {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(selection.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selection]);
  return (
    <aside className="inspiration-reference">
      <p className="eyebrow">THE STARTING POINT</p>
      <h3>Your inspiration</h3>
      {preview ? (
        <img src={preview} alt="Your original inspiration" />
      ) : selection?.kind === 'text' ? (
        <blockquote>{selection.text}</blockquote>
      ) : (
        <p>Your idea is ready to refine.</p>
      )}
      <p>We’ve broken your idea into pieces. Open any item to change its style, fit or details.</p>
      <span>
        <LockKeyhole aria-hidden="true" /> Only visible to you
      </span>
    </aside>
  );
}

function BriefReview({
  brief,
  save,
  confirm,
  pending,
  error,
  reload,
  selection,
}: {
  brief: IntentBrief;
  save: (brief: IntentBrief) => void;
  confirm: (brief: IntentBrief) => void;
  pending: boolean;
  error: Error | null;
  reload: () => void;
  selection: MediaSelection | null;
}) {
  const hints: Record<ShoppingDomain, DomainHint> = {
    outfit: {
      label: 'Fit check',
      exampleCategories: ['outerwear', 'trousers', 'bag'],
      constraintKinds: ['size', 'exclude material'],
      confirmationHint: 'Add sizes and anything you will not wear.',
    },
    setup: {
      label: 'Space check',
      exampleCategories: ['desk', 'lighting', 'storage'],
      constraintKinds: ['dimensions', 'mounting', 'exclude material'],
      confirmationHint: 'Add maximum dimensions and installation limits.',
    },
  };
  return (
    <section className="brief-review" aria-live="polite">
      {brief.status !== 'confirmed' && (
        <div className="review-heading">
          <div>
            <p className="eyebrow">YOUR {brief.domain === 'outfit' ? 'LOOK' : 'SPACE'}</p>
            <h2>Your idea, piece by piece.</h2>
            {brief.sampleOrigin === 'seed' && (
              <p>Synthetic demo draft. Review and edit every item.</p>
            )}
            <p>Keep what you like. Tweak the details. Then find your collection.</p>
          </div>
          <span className="private-badge">
            <LockKeyhole aria-hidden /> Private to this session
          </span>
        </div>
      )}
      {brief.status === 'confirmed' ? (
        <CollectionPanel
          key={`${brief.id}-${brief.revision}`}
          brief={brief}
          onEdit={() => save(brief)}
        />
      ) : (
        <div className="review-workbench">
          <div className="brief-editor-shell compact-review" aria-busy={pending}>
            <BriefEditor
              key={`${brief.id}-${brief.revision}`}
              brief={brief}
              hints={hints[brief.domain]}
              onSave={save}
              onConfirm={confirm}
              disabled={pending}
            />
            {error && (
              <div className="form-error" role="alert">
                <p>{error.message}</p>
                {error instanceof ApiError && error.code === 'REVISION_CONFLICT' && (
                  <button className="text-button" type="button" onClick={reload}>
                    Reload latest brief
                  </button>
                )}
              </div>
            )}
          </div>
          <InspirationReference selection={selection} />
        </div>
      )}
    </section>
  );
}

function ShopperWorkspace({ back, demo = false }: { back: () => void; demo?: boolean }) {
  const [domain, setDomain] = useState<ShoppingDomain>('outfit');
  const [selection, setSelection] = useState<MediaSelection | null>(null);
  const [brief, setBrief] = useState<IntentBrief | null>(null);
  const create = useMutation({
    mutationFn: async () => {
      if (!selection) throw new Error('Add an image or description first.');
      let source: { text: string } | { assetId: string };
      if (selection.kind === 'text') {
        source = { text: selection.text };
      } else {
        const form = new FormData();
        form.set('image', selection.file);
        const asset = await json<InspirationAsset>('/api/assets', { method: 'POST', body: form });
        source = { assetId: asset.id };
      }
      return json<IntentBrief>('/api/briefs', {
        method: 'POST',
        body: JSON.stringify({
          domain,
          ...source,
          country: demo ? 'US' : 'CA',
          currency: demo ? 'USD' : 'CAD',
        }),
      });
    },
    onSuccess: setBrief,
  });
  const update = useMutation({
    mutationFn: ({ edited, status }: { edited: IntentBrief; status: 'draft' | 'confirmed' }) => {
      if (!brief || edited.id !== brief.id) throw new Error('No brief to update.');
      return json<IntentBrief>(`/api/briefs/${edited.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          expectedRevision: brief.revision,
          status,
          slots: edited.slots,
          country: edited.country,
          currency: edited.currency,
          itemBudget: edited.itemBudget,
        }),
      });
    },
    onSuccess: setBrief,
  });
  const reload = useMutation({
    mutationFn: () => {
      if (!brief) throw new Error('No brief to reload.');
      return json<IntentBrief>(`/api/briefs/${brief.id}`);
    },
    onSuccess: (latest) => {
      update.reset();
      setBrief(latest);
    },
  });
  return (
    <main className="workspace-main">
      <button className="back-button" type="button" onClick={back}>
        <ArrowLeft aria-hidden /> Back to both paths
      </button>
      {!brief ? (
        <section className="intake-layout">
          <div className="intake-copy">
            <p className="eyebrow">SHOPPER STUDIO · STEP 1 OF 3</p>
            <h1>
              What are we putting <em>together?</em>
            </h1>
            <p>
              Start with the mood and practical goal. You’ll review every item before search begins.
            </p>
            <div className={`intake-study ${domain}`}>
              <StudioArtwork domain={domain} />
              <span>
                {domain === 'outfit' ? 'A look that feels like you.' : 'Make room for your ideas.'}
                <small>Illustrative inspiration</small>
              </span>
            </div>
            <ol className="steps">
              <li className="active">
                <span>1</span>
                <div>
                  <strong>Share the idea</strong>
                  <small>Image or text</small>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Confirm the brief</strong>
                  <small>Items and constraints</small>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Explore collections</strong>
                  <small>Real products across stores</small>
                </div>
              </li>
            </ol>
          </div>
          <form
            className="intake-card"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <DomainToggle value={domain} onChange={setDomain} />
            <div className="integrated-media-intake">
              <MediaIntake
                label={domain === 'outfit' ? 'Outfit inspiration' : 'Room or desk inspiration'}
                textLabel="Your collection idea"
                initialMode={demo ? 'image' : 'text'}
                disabled={create.isPending}
                onSelectionChange={setSelection}
              />
            </div>
            {create.error && (
              <p className="form-error" role="alert">
                {create.error.message}
              </p>
            )}
            <button
              className="primary wide"
              type="submit"
              disabled={create.isPending || !selection}
            >
              {create.isPending ? (
                <RefreshCw className="spin" aria-hidden />
              ) : (
                <Sparkles aria-hidden />
              )}{' '}
              Build my draft brief
            </button>
            <p className="privacy-line">
              <LockKeyhole aria-hidden />
              <span>
                Your inspiration stays private.
                <small>Merchant sharing is optional, and always your choice.</small>
              </span>
            </p>
          </form>
        </section>
      ) : (
        <BriefReview
          selection={selection}
          brief={brief}
          pending={update.isPending || reload.isPending}
          error={update.error ?? reload.error}
          reload={() => reload.mutate()}
          save={(edited) => update.mutate({ edited, status: 'draft' })}
          confirm={(edited) => update.mutate({ edited, status: 'confirmed' })}
        />
      )}
    </main>
  );
}

function MerchantComingSoon({ back }: { back: () => void }) {
  return (
    <main className="workspace-main merchant-workspace">
      <button className="back-button" type="button" onClick={back}>
        <ArrowLeft aria-hidden /> Back to both paths
      </button>
      <section className="merchant-hero">
        <div>
          <p className="eyebrow">MERCHANT STUDIO</p>
          <h1>
            See the demand between <em>categories.</em>
          </h1>
          <p>
            Profile your public catalog, then compare it with privacy-safe patterns from shoppers
            who chose to contribute.
          </p>
          <div className="merchant-form-preview">
            <label>
              <span>SHOPIFY STORE URL</span>
              <input value="your-store.myshopify.com" readOnly />
            </label>
            <button type="button" disabled>
              Profile store <ArrowRight aria-hidden />
            </button>
          </div>
          <p className="coming-note">
            Merchant profiling unlocks with S4 after the consented demand ledger is active.
          </p>
        </div>
        <section
          className="signal-preview"
          aria-label="Example merchant opportunity, synthetic preview"
        >
          <div className="preview-top">
            <span>SYNTHETIC PREVIEW</span>
            <CircleGauge aria-hidden />
          </div>
          <p>OUTFIT · CANADA · LAST 30 DAYS</p>
          <h2>Structured layers + everyday bags</h2>
          <div className="signal-count">
            <strong>24</strong>
            <span>
              eligible sessions
              <br />
              in this coarse cohort
            </span>
          </div>
          <div className="signal-row">
            <span>Observed pair support</span>
            <strong>18</strong>
          </div>
          <div className="signal-row">
            <span>Unmet bag requirement</span>
            <strong>9</strong>
          </div>
          <div className="signal-foot">
            <ShieldCheck aria-hidden /> No shopper images or individual histories
          </div>
        </section>
      </section>
      <section className="merchant-principles">
        <article>
          <span>01</span>
          <h3>Evidence before outreach</h3>
          <p>Every opportunity carries its cohort window, sample size, and public product proof.</p>
        </article>
        <article>
          <span>02</span>
          <h3>Observed stays observed</h3>
          <p>
            New shops can match unmet demand, but never inherit historical support they did not
            earn.
          </p>
        </article>
        <article>
          <span>03</span>
          <h3>Draft, then decide</h3>
          <p>Collaboration briefs label unknown costs, terms, and willingness.</p>
        </article>
      </section>
    </main>
  );
}

export function App() {
  const [surface, setSurface] = useState<Surface>('home');
  const demo = useQuery({
    queryKey: ['demo'],
    queryFn: () => json<{ enabled?: boolean; notice?: string; storeUrl?: string }>('/api/demo'),
    retry: false,
    staleTime: Infinity,
  });
  const capabilities = useQuery({
    queryKey: ['capabilities'],
    queryFn: () => json<{ flags?: Record<string, boolean> }>('/api/capabilities'),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  useQuery({
    queryKey: ['private-session'],
    queryFn: () => json<{ owner: boolean }>('/api/session'),
    retry: false,
  });
  return (
    <div className="app-shell">
      <header className="site-header">
        <Brand />
        <nav aria-label="Primary navigation">
          <button
            className={surface === 'shopper' ? 'active' : ''}
            type="button"
            onClick={() => setSurface('shopper')}
          >
            Shopper
          </button>
          <button
            className={surface === 'merchant' ? 'active' : ''}
            type="button"
            onClick={() => setSurface('merchant')}
          >
            Merchant
          </button>
        </nav>
      </header>
      {surface === 'home' && <Home enter={setSurface} />}
      {surface === 'shopper' &&
        (capabilities.data?.flags?.FEATURE_INTENT_CAPTURE === false ? (
          <main>
            <p>Shopper intake is currently disabled.</p>
          </main>
        ) : (
          <ShopperWorkspace back={() => setSurface('home')} demo={demo.data?.enabled === true} />
        ))}
      {surface === 'merchant' &&
        (capabilities.data?.flags?.FEATURE_MERCHANT_OPPORTUNITIES === true ? (
          <MerchantWorkspace
            back={() => setSurface('home')}
            initialUrl={demo.data?.enabled ? demo.data.storeUrl : undefined}
          />
        ) : (
          <MerchantComingSoon back={() => setSurface('home')} />
        ))}
      <footer>
        <Brand />
        <span className="footer-note">
          Personal inspiration. Shared only by choice.
          {demo.data?.enabled && (
            <small>Recorded catalog · insights include synthetic sample data, not purchases.</small>
          )}
        </span>
      </footer>
    </div>
  );
}
