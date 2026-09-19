import {
  type InspirationAsset,
  InspirationAssetSchema,
  type IntentBrief,
  IntentBriefSchema,
  newId,
  type ShoppingDomain,
} from '@sei/contracts';

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
  source: { kind: 'text'; text: string } | { kind: 'image'; assetId: string };
  country: string;
  currency: string;
}

export interface IntentDraftService {
  createDraft(input: IntentDraftInput): Promise<IntentBrief>;
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

  getBrief(ownerId: string, briefId: string): IntentBrief | null {
    const record = this.#briefs.get(briefId);
    return record?.ownerId === ownerId ? record.brief : null;
  }

  deleteOwner(ownerId: string): void {
    for (const [id, record] of this.#assets)
      if (record.ownerId === ownerId) this.#assets.delete(id);
    for (const [id, record] of this.#briefs)
      if (record.ownerId === ownerId) this.#briefs.delete(id);
  }
}

export class RevisionConflictError extends Error {
  constructor() {
    super('The brief changed in another tab. Reload the latest revision before saving.');
  }
}

const defaultSlots = {
  outfit: [
    { category: 'top', description: 'A lead garment matching the described color and silhouette' },
    { category: 'bottom', description: 'A coordinating bottom that completes the outfit' },
    { category: 'accessory', description: 'One optional finishing piece' },
  ],
  setup: [
    { category: 'anchor', description: 'The main furniture or workspace anchor' },
    { category: 'lighting', description: 'Lighting that supports the intended mood and function' },
    { category: 'accessory', description: 'One optional object that ties the setup together' },
  ],
} satisfies Record<ShoppingDomain, { category: string; description: string }[]>;

/** Offline fallback until the L3 interpreter lands. It produces an editable draft and never confirms it. */
export class FakeIntentDraftService implements IntentDraftService {
  async createDraft(input: IntentDraftInput): Promise<IntentBrief> {
    return IntentBriefSchema.parse({
      id: newId('brief_'),
      domain: input.domain,
      revision: 1,
      status: 'draft',
      input: input.source,
      slots: defaultSlots[input.domain].map((slot, index) => ({
        id: newId('slot_'),
        ...slot,
        description:
          input.source.kind === 'text' && index === 0
            ? `${slot.description}: ${input.source.text.slice(0, 180)}`
            : slot.description,
        required: index < 2,
        visualAttributes: [],
        constraints: [],
      })),
      country: input.country,
      currency: input.currency,
      itemBudget: null,
      sampleOrigin: 'seed',
      createdAt: new Date().toISOString(),
    });
  }
}
