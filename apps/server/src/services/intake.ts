import {
  type InspirationAsset,
  InspirationAssetSchema,
  type IntentBrief,
  IntentBriefSchema,
  newId,
  type SampleOrigin,
  type ShoppingDomain,
} from '@sei/contracts';
import type { IntentInterpreter } from '@sei/core';

export const ASSET_MAX_BYTES = 8 * 1024 * 1024;
export const ASSET_TTL_MS = 24 * 60 * 60 * 1000;

export interface NormalizedImage {
  bytes: Uint8Array;
  mimeType: InspirationAsset['mimeType'];
}

export interface ImageNormalizer {
  normalize(input: Uint8Array, declaredMimeType: string): Promise<NormalizedImage>;
}

export interface IntentDraftInput {
  domain: ShoppingDomain;
  source:
    | { kind: 'text'; text: string }
    | { kind: 'image'; asset: InspirationAsset; bytes: Uint8Array };
  country: string;
  currency: string;
}

export interface IntentDraftService {
  createDraft(input: IntentDraftInput, signal?: AbortSignal): Promise<IntentBrief>;
}

interface AssetRecord {
  ownerId: string;
  asset: InspirationAsset;
  bytes: Uint8Array;
}

interface BriefRecord {
  ownerId: string;
  brief: IntentBrief;
}

export class IntakeStore {
  readonly #assets = new Map<string, AssetRecord>();
  readonly #briefs = new Map<string, BriefRecord>();

  putAsset(ownerId: string, normalized: NormalizedImage, now = new Date()): InspirationAsset {
    const asset = InspirationAssetSchema.parse({
      id: newId('asset_'),
      mimeType: normalized.mimeType,
      byteLength: normalized.bytes.byteLength,
      expiresAt: new Date(now.getTime() + ASSET_TTL_MS).toISOString(),
    });
    this.#assets.set(asset.id, { ownerId, asset, bytes: normalized.bytes });
    return asset;
  }

  readAsset(ownerId: string, assetId: string, now = new Date()): AssetRecord | null {
    const record = this.#assets.get(assetId);
    if (!record || record.ownerId !== ownerId) return null;
    if (Date.parse(record.asset.expiresAt) <= now.getTime()) {
      this.#assets.delete(assetId);
      return null;
    }
    return record;
  }

  saveBrief(ownerId: string, brief: IntentBrief, expectedRevision: number | null): IntentBrief {
    const current = this.#briefs.get(brief.id);
    if (expectedRevision === null) {
      if (current) throw new RevisionConflictError();
    } else if (
      !current ||
      current.ownerId !== ownerId ||
      current.brief.revision !== expectedRevision
    ) {
      throw new RevisionConflictError();
    }
    this.#briefs.set(brief.id, { ownerId, brief: IntentBriefSchema.parse(brief) });
    return brief;
  }

  /** This owner's confirmed briefs, newest revision as stored. */
  confirmedBriefs(ownerId: string): IntentBrief[] {
    return [...this.#briefs.values()]
      .filter((record) => record.ownerId === ownerId && record.brief.status === 'confirmed')
      .map((record) => record.brief);
  }

  /**
   * Resolves briefs for demand projection. Deliberately not owner-scoped, because a cohort
   * spans sessions; this is an in-process seam and is never reachable from a route.
   */
  findBriefs(briefIds: readonly string[]): IntentBrief[] {
    return briefIds.flatMap((id) => {
      const record = this.#briefs.get(id);
      return record ? [record.brief] : [];
    });
  }

  getBrief(ownerId: string, briefId: string): IntentBrief | null {
    const record = this.#briefs.get(briefId);
    return record?.ownerId === ownerId ? record.brief : null;
  }

  /** Deletes everything an owner holds and returns the brief IDs, so derived data can follow. */
  deleteOwner(ownerId: string): string[] {
    const briefIds: string[] = [];
    for (const [id, record] of this.#assets)
      if (record.ownerId === ownerId) this.#assets.delete(id);
    for (const [id, record] of this.#briefs)
      if (record.ownerId === ownerId) {
        briefIds.push(id);
        this.#briefs.delete(id);
      }
    return briefIds;
  }
}

export class RevisionConflictError extends Error {
  constructor() {
    super('The brief changed in another tab. Reload the latest revision before saving.');
  }
}

/**
 * Adapts L3's budgeted interpreter to the private intake API. `sampleOrigin` says where drafts
 * come from: 'live' only for a real provider, 'seed' for synthetic drafts so they can never be
 * mistaken for observed demand.
 */
export class InterpreterIntentDraftService implements IntentDraftService {
  constructor(
    private readonly interpreter: IntentInterpreter,
    private readonly sampleOrigin: SampleOrigin = 'seed',
  ) {}

  async createDraft(
    input: IntentDraftInput,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<IntentBrief> {
    let consumed = 0;
    return this.interpreter.interpret(
      {
        domain: input.domain,
        source: input.source,
        country: input.country,
        currency: input.currency,
      },
      {
        signal,
        sampleOrigin: this.sampleOrigin,
        consume(resource, amount) {
          if (resource !== 'model_call' || consumed + amount > 2) {
            throw new Error('Intent budget exceeded');
          }
          consumed += amount;
        },
      },
    );
  }
}
