import {
  type InspirationAsset,
  type IntentBrief,
  SCHEMA_VERSION,
  type ShoppingDomain,
} from '@sei/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleGauge,
  LockKeyhole,
  PackageSearch,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
} from 'lucide-react';
import { useState } from 'react';
import { BriefEditor, type DomainHint } from './features/shopper/brief';
import { MediaIntake, type MediaSelection } from './features/shopper/media';
import { ApiError, json } from './shell/api';
import { CollectionPanel } from './shell/CollectionPanel';

type Surface = 'home' | 'shopper' | 'merchant';

function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden>
        <i />
        <i />
      </span>
      common<b>ground</b>
    </span>
  );
}

function FlowMap() {
  return (
    <div
      className="flow-map"
      role="img"
      aria-label="Shopper intent becomes private aggregate merchant evidence"
    >
      <div className="flow-node">
        <ScanSearch aria-hidden />
        <span>inspiration</span>
      </div>
      <div className="flow-line">
        <i />
        <i />
        <i />
      </div>
      <div className="flow-node">
        <CircleGauge aria-hidden />
        <span>confirmed signal</span>
      </div>
      <div className="flow-line">
        <i />
        <i />
        <i />
      </div>
      <div className="flow-node">
        <Store aria-hidden />
        <span>merchant action</span>
      </div>
    </div>
  );
}

function Home({ enter }: { enter: (surface: Surface) => void }) {
  return (
    <main>
      <section className="hero">
        <div>
          <p className="eyebrow">ONE IDEA · A WHOLE COLLECTION</p>
          <h1>
            Find what belongs <em>together.</em>
          </h1>
          <p className="lede">
            Turn an outfit or room inspiration into a real collection across stores. With
            permission, those choices help independent shops build better collaborations.
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
        <div className="hero-object" aria-hidden>
          <div className="paper-card one">
            <span>linen</span>
            <strong>01</strong>
          </div>
          <div className="paper-card two">
            <span>walnut</span>
            <strong>02</strong>
          </div>
          <div className="paper-card three">
            <span>olive</span>
            <strong>03</strong>
          </div>
          <Sparkles />
        </div>
      </section>

      <section className="role-section" aria-labelledby="choose-path">
        <p className="eyebrow">TWO SIDES · ONE USEFUL LOOP</p>
        <h2 id="choose-path">Where are you starting?</h2>
        <div className="role-grid">
          <button className="role-card" type="button" onClick={() => enter('shopper')}>
            <span className="role-icon">
              <ShoppingBag aria-hidden />
            </span>
            <small>01</small>
            <strong>I’m building a look or space</strong>
            <span>Bring an image or describe the idea. Confirm what matters before we search.</span>
            <i>
              Build my collection <ArrowRight aria-hidden />
            </i>
          </button>
          <button className="role-card merchant" type="button" onClick={() => enter('merchant')}>
            <span className="role-icon">
              <Store aria-hidden />
            </span>
            <small>02</small>
            <strong>I run a Shopify store</strong>
            <span>
              See the aggregate combinations shoppers actually ask for—and where your catalog fits.
            </span>
            <i>
              Explore merchant insights <ArrowRight aria-hidden />
            </i>
          </button>
        </div>
      </section>

      <section className="loop-section">
        <div>
          <p className="eyebrow">PRIVATE BY DESIGN</p>
          <h2>From personal taste to a useful pattern.</h2>
          <p>
            Images stay private. Merchant views use coarse, consented aggregates—never individual
            histories.
          </p>
        </div>
        <FlowMap />
      </section>
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

function BriefReview({
  brief,
  save,
  confirm,
  pending,
  error,
  reload,
}: {
  brief: IntentBrief;
  save: (brief: IntentBrief) => void;
  confirm: (brief: IntentBrief) => void;
  pending: boolean;
  error: Error | null;
  reload: () => void;
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
      <div className="review-heading">
        <div>
          <p className="eyebrow">DRAFT · REVISION {brief.revision}</p>
          <h2>Here’s the collection we heard.</h2>
          {brief.sampleOrigin === 'seed' && (
            <p>Synthetic demo draft. Review and edit every item.</p>
          )}
          <p>Nothing is searched until you confirm. The full editor can refine every detail.</p>
        </div>
        <span className="private-badge">
          <LockKeyhole aria-hidden /> Private to this session
        </span>
      </div>
      <div className="slot-list">
        {brief.slots.map((slot, index) => (
          <article className="slot-card" key={slot.id}>
            <small>0{index + 1}</small>
            <p>{slot.required ? 'REQUIRED' : 'OPTIONAL'}</p>
            <h3>{slot.category}</h3>
            <span>{slot.description}</span>
            <Check aria-hidden />
          </article>
        ))}
      </div>
      <div className="review-note">
        <ShieldCheck aria-hidden />
        <p>
          <strong>One check before search:</strong> add clothing sizes or furniture dimensions in
          the full brief editor. We never infer them from an image.
        </p>
      </div>
      {brief.status === 'confirmed' ? (
        <>
          <div className="confirmed-panel">
            <span>
              <Check aria-hidden />
            </span>
            <div>
              <strong>Brief confirmed.</strong>
              <p>Collection matching will use this exact revision.</p>
            </div>
          </div>
          <CollectionPanel
            key={`${brief.id}-${brief.revision}`}
            brief={brief}
            onEdit={() => save(brief)}
          />
        </>
      ) : (
        <div className="brief-editor-shell" aria-busy={pending}>
          <div className="editor-intro">
            <p className="eyebrow">FINAL CHECK</p>
            <h3>Make it exact before search.</h3>
            <p>Adjust categories, sizes, dimensions, and required items. Nothing here is shared.</p>
          </div>
          <BriefEditor
            key={`${brief.id}-${brief.revision}`}
            brief={brief}
            hints={hints[brief.domain]}
            onSave={save}
            onConfirm={confirm}
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
      )}
    </section>
  );
}

function ShopperWorkspace({ back }: { back: () => void }) {
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
        body: JSON.stringify({ domain, ...source, country: 'CA', currency: 'CAD' }),
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
                initialMode="text"
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
              <LockKeyhole aria-hidden /> Private intake. Merchant sharing is a separate, optional
              choice later.
            </p>
          </form>
        </section>
      ) : (
        <BriefReview
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

function MerchantWorkspace({ back }: { back: () => void }) {
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
  const capabilities = useQuery({
    queryKey: ['capabilities'],
    queryFn: () => json<{ flags?: Record<string, boolean> }>('/api/capabilities'),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const session = useQuery({
    queryKey: ['private-session'],
    queryFn: () => json<{ owner: boolean }>('/api/session'),
    retry: false,
  });
  return (
    <div className="app-shell">
      <header>
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
        <span className={`session-status ${session.data?.owner ? 'ready' : ''}`}>
          <i />
          {session.isPending
            ? 'Securing session'
            : session.data?.owner
              ? 'Private session'
              : 'Session unavailable'}
        </span>
      </header>
      {surface === 'home' && <Home enter={setSurface} />}
      {surface === 'shopper' &&
        (capabilities.data?.flags?.FEATURE_INTENT_CAPTURE === false ? (
          <main>
            <p>Shopper intake is currently disabled.</p>
          </main>
        ) : (
          <ShopperWorkspace back={() => setSurface('home')} />
        ))}
      {surface === 'merchant' && <MerchantWorkspace back={() => setSurface('home')} />}
      <footer>
        <Brand />
        <span>Personal inspiration. Shared only by choice.</span>
        <small>Contracts v{SCHEMA_VERSION}</small>
      </footer>
    </div>
  );
}
