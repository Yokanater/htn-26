import { readFileSync } from 'node:fs';
import {
  type CollaborationDraft,
  CollaborationDraftSchema,
  DemandAggregateSchema,
  type MerchantOpportunity,
  type MerchantProfile,
  MerchantProfileSchema,
  type MerchantRun,
  newId,
  type ShoppingDomain,
} from '@sei/contracts';
import type {
  CollaborationComposer,
  MerchantDiscovery,
  MerchantProfiler,
  OpportunityMapper,
} from '@sei/core';
import { loadSeedOffers } from '../replay';
import type { PrivateDemandLedger } from './demand';
import type { DemandProjectionService } from './demand-projection';
import type { OwnerSessions } from './session';

export class MerchantError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 429 = 409,
  ) {
    super(message);
  }
}

export function createSeedMerchantProfiler(): MerchantProfiler {
  return {
    origin: 'seed',
    async profile({ url, domain, signal, progress }) {
      signal.throwIfAborted();
      const host = new URL(url).hostname;
      const offers = loadSeedOffers().filter(
        (offer) => offer.merchant.domain === host && offer.id.includes(`_${domain}_`),
      );
      if (!offers.length) throw new Error('Choose a listed synthetic store');
      progress(
        'verify',
        'Loaded explicitly synthetic product records; no provider was called.',
        offers.length,
      );
      return MerchantProfileSchema.parse({
        id: newId('prof_'),
        merchant: offers[0].merchant,
        domain,
        offers,
        confirmed: false,
        sampleOrigin: 'seed',
        capturedAt: new Date().toISOString(),
        warnings: [
          'Synthetic catalog and demand demonstration. No real merchant or market evidence.',
        ],
      });
    },
  };
}

type Owned<T> = { owner: string; value: T; expires: number };
type OpportunityRecord = {
  value: MerchantOpportunity;
  generation: number;
  profileId: string;
  profileVersion: string;
};
type MerchantDeps = {
  profiler: MerchantProfiler;
  composer: CollaborationComposer;
  mapper: OpportunityMapper;
  projection: DemandProjectionService;
  ledger: PrivateDemandLedger;
  sessions: OwnerSessions;
  discovery?: MerchantDiscovery;
  now: () => Date;
  hardMs?: number;
};

export class MerchantWorkspaceService {
  readonly #runs = new Map<string, Owned<MerchantRun> & { controller: AbortController }>();
  readonly #profiles = new Map<string, Owned<MerchantProfile>>();
  readonly #opportunities = new Map<string, Owned<OpportunityRecord>>();
  readonly #drafts = new Map<string, Owned<{ draft: CollaborationDraft; opportunityId: string }>>();
  readonly #drafting = new Map<string, AbortController>();
  readonly #deps: MerchantDeps;
  constructor(deps: MerchantDeps) {
    this.#deps = deps;
  }

  #expires() {
    return this.#deps.now().getTime() + 60 * 60 * 1000;
  }
  #owned<T>(map: Map<string, Owned<T>>, id: string, owner: string): T {
    const item = map.get(id);
    if (!item || item.owner !== owner || item.expires < this.#deps.now().getTime())
      throw new MerchantError('NOT_FOUND', 'This item is unavailable or expired.', 404);
    return item.value;
  }
  #sweep() {
    for (const [id, item] of this.#runs)
      if (item.expires < this.#deps.now().getTime()) {
        item.controller.abort();
        this.#runs.delete(id);
      }
    for (const map of [this.#profiles, this.#opportunities, this.#drafts])
      for (const [id, item] of map) if (item.expires < this.#deps.now().getTime()) map.delete(id);
  }
  settings() {
    return {
      provider: this.#deps.profiler.origin === 'seed' ? 'synthetic' : 'browserbase_baseten',
      stores:
        this.#deps.profiler.origin === 'seed'
          ? [...new Set(loadSeedOffers().map((offer) => offer.merchant.domain))]
          : [],
      retention: 'Workspace expires after one hour and is cleared on server restart.',
    };
  }
  start(owner: string, url: string, domain: ShoppingDomain) {
    this.#sweep();
    const running = [...this.#runs.values()].filter((run) => run.value.status === 'running');
    if (running.length >= 2 || running.some((run) => run.owner === owner))
      throw new MerchantError(
        'RUN_LIMIT',
        'A catalog scan is already running. Wait or cancel it before starting another.',
        429,
      );
    if ([...this.#runs.values()].filter((run) => run.owner === owner).length >= 12)
      throw new MerchantError(
        'RUN_LIMIT',
        'This workspace reached its scan limit. Delete the session to start over.',
        429,
      );
    const run: MerchantRun = {
      id: newId('run_'),
      status: 'running',
      sampleOrigin: this.#deps.profiler.origin,
      events: [],
      liveViewUrl: null,
      profile: null,
    };
    const controller = new AbortController();
    this.#runs.set(run.id, { owner, value: run, controller, expires: this.#expires() });
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(this.#deps.hardMs ?? 180000),
    ]);
    const progress: Parameters<MerchantProfiler['profile']>[0]['progress'] = (
      stage,
      message,
      count = 0,
    ) => {
      if (!this.#deps.sessions.valid(owner) || run.status !== 'running') return;
      run.events.push({
        sequence: run.events.length,
        at: this.#deps.now().toISOString(),
        stage,
        message,
        productCount: count,
      });
    };
    progress(
      'queued',
      run.sampleOrigin === 'seed'
        ? 'Preparing a synthetic demonstration.'
        : 'Starting a bounded public catalog scan. This can take up to three minutes.',
    );
    signal.addEventListener(
      'abort',
      () => {
        if (run.status !== 'running') return;
        progress('failed', 'The scan reached its deadline. Retry the public catalog.');
        run.status = 'failed';
        run.liveViewUrl = null;
      },
      { once: true },
    );
    void this.#deps.profiler
      .profile({
        url,
        domain,
        signal,
        progress,
        liveView: (value) => {
          if (run.status === 'running' && !signal.aborted) run.liveViewUrl = value;
        },
      })
      .then(async (profile) => {
        signal.throwIfAborted();
        if (!this.#deps.sessions.valid(owner) || run.status !== 'running') return;
        run.profile = MerchantProfileSchema.parse(profile);
        this.#profiles.set(profile.id, { owner, value: profile, expires: this.#expires() });
        if (this.#deps.discovery) {
          try {
            progress(
              'discover',
              'Finding complementary merchants automatically from your public catalog.',
            );
            const candidates = await this.#deps.discovery.discover(profile, signal);
            const seen = new Set([profile.merchant.domain]);
            let verified = 0;
            for (const url of candidates.slice(0, 3)) {
              signal.throwIfAborted();
              if (!this.#deps.sessions.valid(owner) || run.status !== 'running') return;
              const host = new URL(url).hostname;
              if (seen.has(host)) continue;
              seen.add(host);
              progress('discover', `Exploring potential partner ${host}.`);
              try {
                const partner = await this.#deps.profiler.profile({
                  url,
                  domain,
                  signal,
                  progress: (stage, message, count) =>
                    progress(stage, `${host}: ${message}`, count),
                  liveView: (value) => {
                    if (run.status === 'running' && !signal.aborted) run.liveViewUrl = value;
                  },
                });
                signal.throwIfAborted();
                if (!this.#deps.sessions.valid(owner) || run.status !== 'running') return;
                if (
                  partner.sampleOrigin !== profile.sampleOrigin ||
                  partner.domain !== profile.domain ||
                  !partner.offers.length ||
                  partner.merchant.domain === profile.merchant.domain
                )
                  continue;
                partner.discoveredFor = profile.id;
                partner.confirmed = false;
                partner.warnings.push(
                  'Automatically discovered public catalog. Category fit is inferred; partner interest is unknown.',
                );
                this.#profiles.set(partner.id, {
                  owner,
                  value: MerchantProfileSchema.parse(partner),
                  expires: this.#expires(),
                });
                verified += 1;
                progress('discover', `Verified candidate ${host}.`, partner.offers.length);
              } catch {
                signal.throwIfAborted();
                progress(
                  'discover',
                  `Could not verify ${host}; skipped without inventing products.`,
                );
              }
            }
            if (!verified)
              progress('discover', 'No verifiable candidate stores found. You can retry the scan.');
          } catch {
            signal.throwIfAborted();
            profile.warnings.push(
              'Automatic merchant search unavailable. Your catalog is retained; retry the scan to explore partners.',
            );
            progress('discover', 'Partner search unavailable; retaining your verified catalog.');
          }
        }
        progress(
          'ready',
          'Catalog ready. Review categories and evidence, then confirm.',
          profile.offers.length,
        );
        run.profile = MerchantProfileSchema.parse(profile);
        run.status = 'ready';
      })
      .catch(() => {
        if (run.status !== 'running') return;
        progress(
          'failed',
          signal.aborted
            ? 'The scan reached its deadline. Retry with a smaller public catalog.'
            : 'Catalog scan failed. Check provider configuration and public storefront access, then retry.',
        );
        run.status = 'failed';
      })
      .finally(() => {
        run.liveViewUrl = null;
      });
    return structuredClone(run);
  }
  run(owner: string, id: string) {
    return structuredClone(this.#owned(this.#runs, id, owner));
  }
  cancel(owner: string, id: string) {
    const run = this.#owned(this.#runs, id, owner);
    if (run.status === 'running') {
      run.events.push({
        sequence: run.events.length,
        at: this.#deps.now().toISOString(),
        stage: 'cancelled',
        message: 'Scan cancelled. Browser resources are being released.',
        productCount: 0,
      });
      run.status = 'cancelled';
      run.liveViewUrl = null;
      this.#runs.get(id)?.controller.abort();
    }
    return structuredClone(run);
  }
  profiles(owner: string) {
    this.#sweep();
    return [...this.#profiles.values()]
      .filter((item) => item.owner === owner)
      .map((item) => structuredClone(item.value));
  }
  confirm(owner: string, id: string, categories: { offerId: string; category: string }[]) {
    const profile = this.#owned(this.#profiles, id, owner);
    if (
      categories.length !== profile.offers.length ||
      new Set(categories.map((item) => item.offerId)).size !== categories.length ||
      categories.some((item) => !profile.offers.some((offer) => offer.id === item.offerId))
    )
      throw new MerchantError('INVALID_CATALOG', 'Review every catalog item.', 400);
    for (const offer of profile.offers)
      offer.category =
        categories
          .find((item) => item.offerId === offer.id)
          ?.category.toLowerCase()
          .trim() ?? offer.category;
    profile.confirmed = true;
    return structuredClone(profile);
  }
  #catalogVersion(owner: string) {
    return JSON.stringify(
      this.profiles(owner).map((profile) => ({
        id: profile.id,
        confirmed: profile.confirmed,
        offers: profile.offers,
      })),
    );
  }
  async opportunities(owner: string, profileId: string) {
    const profile = this.#owned(this.#profiles, profileId, owner);
    if (!profile.confirmed)
      throw new MerchantError('CONFIRM_PROFILE', 'Confirm the catalog before comparing demand.');
    const partnerOffers =
      profile.sampleOrigin === 'seed'
        ? loadSeedOffers()
        : this.profiles(owner)
            .filter(
              (item) =>
                (item.confirmed || item.discoveredFor === profile.id) &&
                item.domain === profile.domain &&
                item.sampleOrigin === 'live',
            )
            .flatMap((item) => item.offers);
    let opportunities: MerchantOpportunity[];
    if (profile.sampleOrigin === 'seed') {
      const aggregate = DemandAggregateSchema.parse(
        JSON.parse(
          readFileSync(
            new URL(`../../../../fixtures/seed/${profile.domain}/aggregate.json`, import.meta.url),
            'utf8',
          ),
        ),
      );
      opportunities = this.#deps.mapper.map({
        merchant: profile.merchant,
        offers: profile.offers,
        partnerOffers,
        aggregates: [aggregate],
        minimumSessions: 5,
      });
    } else {
      await this.#deps.projection.refresh('live');
      opportunities = this.#deps.projection
        .mapOpportunities(this.#deps.mapper, {
          merchant: profile.merchant,
          offers: profile.offers,
          partnerOffers,
        })
        .filter((item) => item.demand.cohort.domain === profile.domain);
    }
    if (!this.#deps.sessions.valid(owner))
      throw new MerchantError('NOT_FOUND', 'Session deleted.', 404);
    // Keep draft dependencies when refreshing, but bound unreferenced comparison history.
    const retained = new Set([...this.#drafts.values()].map((item) => item.value.opportunityId));
    for (const [id, item] of this.#opportunities)
      if (item.owner === owner && item.value.profileId === profileId && !retained.has(id))
        this.#opportunities.delete(id);
    for (const value of opportunities)
      this.#opportunities.set(value.id, {
        owner,
        expires: this.#expires(),
        value: {
          value,
          generation: this.#deps.ledger.generation,
          profileId,
          profileVersion: this.#catalogVersion(owner),
        },
      });
    return {
      opportunities,
      candidates: this.profiles(owner)
        .filter((candidate) => candidate.discoveredFor === profile.id && candidate.domain === profile.domain && candidate.sampleOrigin === profile.sampleOrigin)
        .map((candidate) => ({
          profile: candidate,
          complementaryCategories: [...new Set(candidate.offers
            .filter((offer) => offer.availability !== 'unavailable' && !profile.offers.some((own) => own.category.toLowerCase() === offer.category.toLowerCase()))
            .map((offer) => offer.category))],
          stale: this.#deps.now().getTime() - Date.parse(candidate.capturedAt) > 15 * 60000,
        }))
        .sort((a, b) => Number(a.stale) - Number(b.stale) || b.complementaryCategories.length - a.complementaryCategories.length || a.profile.merchant.domain.localeCompare(b.profile.merchant.domain)),
      offers: [
        ...new Map(
          [...profile.offers, ...partnerOffers].map((offer) => [offer.id, offer]),
        ).values(),
      ],
      message: opportunities.length
        ? 'Compare category coverage and verify the remaining constraints.'
        : 'Insufficient eligible evidence or complementary supply. No demand-backed opportunity can be claimed yet.',
    };
  }
  #current(owner: string, id: string) {
    const record = this.#owned(this.#opportunities, id, owner);
    const profile = this.#owned(this.#profiles, record.profileId, owner);
    const demand = record.value.demand;
    const current =
      demand.sampleOrigin === 'live' ? this.#deps.projection.published(demand.aggregateId) : demand;
    if (
      !current ||
      current.aggregateVersion !== demand.aggregateVersion ||
      (demand.sampleOrigin === 'live' && record.generation !== this.#deps.ledger.generation) ||
      record.profileVersion !== this.#catalogVersion(owner)
    )
      throw new MerchantError(
        'STALE_EVIDENCE',
        'Evidence changed or consent was withdrawn. Refresh opportunities before using this draft.',
      );
    if (
      profile.sampleOrigin === 'live' &&
      this.profiles(owner).some(
        (item) =>
          record.value.merchants.some((merchant) => merchant.id === item.merchant.id) &&
          this.#deps.now().getTime() - Date.parse(item.capturedAt) > 15 * 60000,
      )
    )
      throw new MerchantError(
        'STALE_CATALOG',
        'Catalog evidence expired. Profile the store again before drafting.',
      );
    return record.value;
  }
  async draft(owner: string, opportunityId: string) {
    if (this.#drafting.has(owner) || this.#drafting.size >= 2)
      throw new MerchantError(
        'DRAFT_BUSY',
        'A proposal is being prepared. Wait before starting another.',
        429,
      );
    if ([...this.#drafts.values()].filter((item) => item.owner === owner).length >= 24)
      throw new MerchantError('DRAFT_LIMIT', 'Workspace draft limit reached.', 429);
    const opportunity = this.#current(owner, opportunityId);
    const controller = new AbortController();
    this.#drafting.set(owner, controller);
    try {
      const copy = await this.#deps.composer.compose(
        opportunity,
        AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]),
      );
      if (!this.#deps.sessions.valid(owner))
        throw new MerchantError('NOT_FOUND', 'Session deleted.', 404);
      this.#current(owner, opportunityId);
      const draft = CollaborationDraftSchema.parse({
        id: newId('act_'),
        revision: 1,
        opportunity,
        ...copy,
        merchantNotes: '',
        updatedAt: this.#deps.now().toISOString(),
      });
      this.#drafts.set(draft.id, {
        owner,
        expires: this.#expires(),
        value: { draft, opportunityId },
      });
      return structuredClone(draft);
    } finally {
      this.#drafting.delete(owner);
    }
  }
  drafts(owner: string) {
    this.#sweep();
    return [...this.#drafts.values()]
      .filter((item) => item.owner === owner)
      .map(({ value }) => {
        let status = 'current';
        try {
          this.#current(owner, value.opportunityId);
        } catch {
          status = 'stale';
        }
        return {
          id: value.draft.id,
          title: value.draft.title,
          revision: value.draft.revision,
          status,
        };
      });
  }
  getDraft(owner: string, id: string) {
    const item = this.#owned(this.#drafts, id, owner);
    this.#current(owner, item.opportunityId);
    return structuredClone(item.draft);
  }
  saveDraft(
    owner: string,
    id: string,
    expectedRevision: number,
    edits: Pick<CollaborationDraft, 'title' | 'experiment' | 'outreach' | 'merchantNotes'>,
  ) {
    const item = this.#owned(this.#drafts, id, owner);
    this.#current(owner, item.opportunityId);
    if (item.draft.revision !== expectedRevision)
      throw new MerchantError('REVISION_CONFLICT', 'This draft changed. Reload before saving.');
    item.draft = CollaborationDraftSchema.parse({
      ...item.draft,
      ...edits,
      revision: expectedRevision + 1,
      updatedAt: this.#deps.now().toISOString(),
      warnings: [
        ...new Set([
          ...item.draft.warnings,
          'Merchant edits are unverified. Review claims and terms before outreach.',
        ]),
      ],
    });
    return structuredClone(item.draft);
  }
  deleteOwner(owner: string) {
    this.#drafting.get(owner)?.abort();
    for (const [id, item] of this.#runs)
      if (item.owner === owner) {
        item.controller.abort();
        this.#runs.delete(id);
      }
    for (const map of [this.#profiles, this.#opportunities, this.#drafts])
      for (const [id, item] of map) if (item.owner === owner) map.delete(id);
  }
}
