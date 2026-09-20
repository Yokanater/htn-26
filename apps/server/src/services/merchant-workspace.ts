/**
 * Owner-scoped merchant demo workspace. Owner: L4 (S4-L4-1 / live opt-in).
 * Bindings are MerchantWorkspaceAccess, not store ownership.
 * Seed and allowlisted newcomers stay in-memory. Live public hosts use L1 via merchantCatalog.
 * Demand and drafts stay seed even when the catalog profile is live.
 */

import type { MerchantOpportunity, SampleOrigin } from '@sei/contracts';
import {
  type MerchantCollaborationDraft,
  MerchantCollaborationDraftSchema,
  type MerchantWorkspaceProfile,
  MerchantWorkspaceProfileSchema,
  newId,
  type ProductOffer,
} from '@sei/contracts';
import { loadDemoNewcomerOffers, loadSeedOffers } from '../replay';
import type { MerchantProfiler } from './merchant-catalog';
import {
  inferOpportunity,
  loadSeedOpportunities,
  observedOpportunityFor,
  type SeedPair,
  validateOpportunity,
} from './merchant-opportunities';
import {
  classifyMerchantHost,
  type MerchantCatalogMode,
  MerchantUrlError,
  parseMerchantUrl,
} from './merchant-url';

export interface MerchantWorkspaceAccess {
  ownerId: string;
  merchantId: string;
  domain: string;
  profiledAt: string;
}

export class MerchantConflictError extends Error {
  constructor() {
    super('The draft changed in another request. Reload and try again.');
    this.name = 'MerchantConflictError';
  }
}

export class MerchantNotFoundError extends Error {
  constructor() {
    super('Not found.');
    this.name = 'MerchantNotFoundError';
  }
}

export class MerchantSessionDeletedError extends Error {
  constructor() {
    super('The private session is gone.');
    this.name = 'MerchantSessionDeletedError';
  }
}

export class MerchantSelectionError extends Error {
  constructor() {
    super('That evidence is not part of this opportunity.');
    this.name = 'MerchantSelectionError';
  }
}

interface OwnerProfile {
  access: MerchantWorkspaceAccess;
  merchant: MerchantWorkspaceProfile['merchant'];
  offers: ProductOffer[];
  opportunities: MerchantOpportunity[];
  sampleOrigin: SampleOrigin;
}

interface DraftRecord {
  ownerId: string;
  draft: MerchantCollaborationDraft;
}

export class MerchantWorkspaceStore {
  readonly #deleted = new Set<string>();
  readonly #tail = new Map<string, Promise<void>>();
  readonly #profiles = new Map<string, OwnerProfile>();
  readonly #domainIndex = new Map<string, string>();
  readonly #drafts = new Map<string, DraftRecord>();
  readonly #seedOffers: ProductOffer[];
  readonly #newcomerOffers: ProductOffer[];
  readonly #seedPairs: SeedPair[];
  readonly #seedDomains: Set<string>;
  readonly #newcomerHosts: Set<string>;
  readonly #mode: MerchantCatalogMode;
  readonly #now: () => Date;
  /** Test seam: after validation, before the per-owner write lock. */
  beforePersist: (() => Promise<void>) | null = null;

  constructor(
    options: {
      now?: () => Date;
      seedOffers?: ProductOffer[];
      newcomerOffers?: ProductOffer[];
      mode?: MerchantCatalogMode;
    } = {},
  ) {
    this.#now = options.now ?? (() => new Date());
    this.#seedOffers = options.seedOffers ?? loadSeedOffers();
    this.#newcomerOffers = options.newcomerOffers ?? loadDemoNewcomerOffers();
    this.#seedPairs = loadSeedOpportunities(this.#seedOffers);
    this.#seedDomains = new Set(this.#seedOffers.map((offer) => offer.merchant.domain));
    this.#newcomerHosts = new Set(this.#newcomerOffers.map((offer) => offer.merchant.domain));
    this.#mode = options.mode ?? 'fake';
  }

  seedDomains(): ReadonlySet<string> {
    return this.#seedDomains;
  }

  isEmpty(): boolean {
    return this.#profiles.size === 0 && this.#drafts.size === 0;
  }

  ownerHasRows(ownerId: string): boolean {
    return [...this.#profiles.values()].some((profile) => profile.access.ownerId === ownerId);
  }

  async deleteSession(ownerId: string): Promise<void> {
    await this.#serialized(ownerId, () => {
      this.#deleted.add(ownerId);
      for (const [key, profile] of this.#profiles) {
        if (profile.access.ownerId === ownerId) this.#profiles.delete(key);
      }
      for (const key of this.#domainIndex.keys()) {
        if (key.startsWith(`${ownerId}\0`)) this.#domainIndex.delete(key);
      }
      for (const [id, record] of this.#drafts) {
        if (record.ownerId === ownerId) this.#drafts.delete(id);
      }
    });
  }

  async profile(
    ownerId: string,
    url: string,
    catalog: MerchantProfiler,
    signal: AbortSignal,
  ): Promise<MerchantWorkspaceProfile> {
    const parsed = parseMerchantUrl(url);
    const kind = classifyMerchantHost(
      parsed.host,
      this.#seedDomains,
      this.#newcomerHosts,
      this.#mode,
    );
    if (kind === 'rejected') throw new MerchantUrlError();
    this.#assertWritable(ownerId);
    const sampleOrigin: SampleOrigin = kind === 'public' ? 'live' : 'seed';
    const resolved =
      kind === 'public'
        ? await catalog.profileMerchant(parsed.href, {
            signal,
            sampleOrigin,
            consume() {},
          })
        : this.#fromMemory(parsed.host, kind);
    if (this.beforePersist) await this.beforePersist();
    return this.#serialized(ownerId, () => {
      this.#assertWritable(ownerId);
      const existingId = this.#domainIndex.get(this.#domainKey(ownerId, resolved.merchant.domain));
      const merchantId = existingId ?? resolved.merchant.id;
      const merchant = { ...resolved.merchant, id: merchantId };
      const observed =
        kind === 'seed' ? observedOpportunityFor(merchant.id, this.#seedPairs) : null;
      const opportunities = [
        observed ?? inferOpportunity(merchant, resolved.offers, this.#seedPairs),
      ].map(validateOpportunity);
      const access: MerchantWorkspaceAccess = {
        ownerId,
        merchantId,
        domain: merchant.domain,
        profiledAt: this.#now().toISOString(),
      };
      this.#profiles.set(this.#profileKey(ownerId, merchantId), {
        access,
        merchant,
        offers: structuredClone(resolved.offers),
        opportunities,
        sampleOrigin,
      });
      this.#domainIndex.set(this.#domainKey(ownerId, merchant.domain), merchantId);
      return this.#toProfile(merchant, resolved.offers, sampleOrigin);
    });
  }

  listOpportunities(ownerId: string, merchantId: string): MerchantOpportunity[] {
    this.#assertWritable(ownerId);
    const profile = this.#profiles.get(this.#profileKey(ownerId, merchantId));
    if (!profile) throw new MerchantNotFoundError();
    return profile.opportunities.map((opportunity) => validateOpportunity(opportunity));
  }

  getDraft(ownerId: string, draftId: string): MerchantCollaborationDraft {
    this.#assertWritable(ownerId);
    const record = this.#drafts.get(draftId);
    if (!record || record.ownerId !== ownerId) throw new MerchantNotFoundError();
    return MerchantCollaborationDraftSchema.parse(structuredClone(record.draft));
  }

  async createDraft(ownerId: string, merchantId: string, opportunityId: string) {
    this.#assertWritable(ownerId);
    const snapshot = this.#requireOpportunity(ownerId, merchantId, opportunityId);
    if (this.beforePersist) await this.beforePersist();
    return this.#serialized(ownerId, () => {
      this.#assertWritable(ownerId);
      const current = this.#requireOpportunity(ownerId, merchantId, opportunityId);
      this.#assertSameOpportunity(snapshot, current);
      const now = this.#now().toISOString();
      const draft = MerchantCollaborationDraftSchema.parse({
        id: newId('draft_'),
        version: 1,
        merchantId,
        opportunityId: current.id,
        aggregateId: current.demand.aggregateId,
        aggregateVersion: current.demand.aggregateVersion,
        sampleOrigin: current.demand.sampleOrigin,
        proposalText: current.proposedExperiment,
        uncertainties: [...current.uncertainties],
        evidenceIds: [...current.productEvidenceIds],
        createdAt: now,
        updatedAt: now,
      });
      this.#drafts.set(draft.id, { ownerId, draft });
      return structuredClone(draft);
    });
  }

  /** Test seam: prove a stale aggregate version cannot mint a draft. */
  bumpStoredAggregateVersion(ownerId: string, merchantId: string): void {
    this.#assertWritable(ownerId);
    const profile = this.#profiles.get(this.#profileKey(ownerId, merchantId));
    if (!profile) throw new MerchantNotFoundError();
    profile.opportunities = profile.opportunities.map((opportunity) =>
      validateOpportunity({
        ...opportunity,
        demand: {
          ...opportunity.demand,
          aggregateVersion: opportunity.demand.aggregateVersion + 1,
        },
      }),
    );
  }

  async updateDraft(
    ownerId: string,
    draftId: string,
    input: { expectedVersion: number; proposalText: string; uncertainties: string[] },
  ) {
    this.#assertWritable(ownerId);
    const existing = this.#drafts.get(draftId);
    if (!existing || existing.ownerId !== ownerId) throw new MerchantNotFoundError();
    const snapshot = this.#requireOpportunity(
      ownerId,
      existing.draft.merchantId,
      existing.draft.opportunityId,
    );
    this.#assertDraftMatches(existing.draft, snapshot);
    if (this.beforePersist) await this.beforePersist();
    return this.#serialized(ownerId, () => {
      this.#assertWritable(ownerId);
      const record = this.#drafts.get(draftId);
      if (!record || record.ownerId !== ownerId) throw new MerchantNotFoundError();
      if (record.draft.version !== input.expectedVersion) throw new MerchantConflictError();
      const opportunity = this.#requireOpportunity(
        ownerId,
        record.draft.merchantId,
        record.draft.opportunityId,
      );
      this.#assertDraftMatches(record.draft, opportunity);
      const draft = MerchantCollaborationDraftSchema.parse({
        ...record.draft,
        version: record.draft.version + 1,
        proposalText: input.proposalText,
        uncertainties: input.uncertainties,
        updatedAt: this.#now().toISOString(),
      });
      this.#drafts.set(draft.id, { ownerId, draft });
      return structuredClone(draft);
    });
  }

  #fromMemory(
    host: string,
    kind: 'seed' | 'synthetic_example',
  ): {
    merchant: MerchantWorkspaceProfile['merchant'];
    offers: ProductOffer[];
  } {
    const source = kind === 'seed' ? this.#seedOffers : this.#newcomerOffers;
    const offers = source.filter((offer) => offer.merchant.domain === host);
    const merchant = offers[0]?.merchant;
    if (!merchant || offers.length === 0) throw new MerchantUrlError();
    return { merchant: structuredClone(merchant), offers: structuredClone(offers) };
  }

  #toProfile(
    merchant: MerchantWorkspaceProfile['merchant'],
    offers: readonly ProductOffer[],
    sampleOrigin: SampleOrigin,
  ): MerchantWorkspaceProfile {
    return MerchantWorkspaceProfileSchema.parse({
      merchant: structuredClone(merchant),
      sampleOrigin,
      categories: [...new Set(offers.map((offer) => offer.category))],
      evidenceIds: [...new Set(offers.flatMap((offer) => offer.evidence.map((item) => item.id)))],
      workspace: 'synthetic_demo',
    });
  }

  #requireOpportunity(
    ownerId: string,
    merchantId: string,
    opportunityId: string,
  ): MerchantOpportunity {
    const profile = this.#profiles.get(this.#profileKey(ownerId, merchantId));
    const opportunity = profile?.opportunities.find((item) => item.id === opportunityId);
    if (!profile || !opportunity) throw new MerchantNotFoundError();
    if (!opportunity.merchants.some((merchant) => merchant.id === merchantId)) {
      throw new MerchantNotFoundError();
    }
    return opportunity;
  }

  #assertSameOpportunity(left: MerchantOpportunity, right: MerchantOpportunity): void {
    if (
      left.id !== right.id ||
      left.demand.aggregateId !== right.demand.aggregateId ||
      left.demand.aggregateVersion !== right.demand.aggregateVersion ||
      left.demand.sampleOrigin !== right.demand.sampleOrigin
    ) {
      throw new MerchantConflictError();
    }
    if (left.productEvidenceIds.join('|') !== right.productEvidenceIds.join('|')) {
      throw new MerchantSelectionError();
    }
  }

  #assertDraftMatches(draft: MerchantCollaborationDraft, opportunity: MerchantOpportunity): void {
    if (
      draft.opportunityId !== opportunity.id ||
      draft.aggregateId !== opportunity.demand.aggregateId ||
      draft.aggregateVersion !== opportunity.demand.aggregateVersion ||
      draft.sampleOrigin !== opportunity.demand.sampleOrigin
    ) {
      throw new MerchantConflictError();
    }
    if (draft.evidenceIds.join('|') !== opportunity.productEvidenceIds.join('|')) {
      throw new MerchantSelectionError();
    }
  }

  #assertWritable(ownerId: string): void {
    if (this.#deleted.has(ownerId)) throw new MerchantSessionDeletedError();
  }

  #profileKey(ownerId: string, merchantId: string): string {
    return `${ownerId}\0${merchantId}`;
  }

  #domainKey(ownerId: string, domain: string): string {
    return `${ownerId}\0${domain}`;
  }

  #serialized<T>(ownerId: string, work: () => T | Promise<T>): Promise<T> {
    const previous = this.#tail.get(ownerId) ?? Promise.resolve();
    const current = previous.then(work, work);
    this.#tail.set(
      ownerId,
      current.then(
        () => undefined,
        () => undefined,
      ),
    );
    return current;
  }
}
