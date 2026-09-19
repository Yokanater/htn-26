/** Shared ports for the v3 shopper loop. Owner: L3; L1/L2 implement injected providers. */
import type {
  CollectionMatch,
  InspirationAsset,
  IntentBrief,
  MerchantIdentity,
  ProductOffer,
  SampleOrigin,
  ShoppingDomain,
} from '@sei/contracts';

export interface ShoppingContext {
  signal: AbortSignal;
  sampleOrigin: SampleOrigin;
  /** Runtime implementation rejects an over-budget call before invoking the provider. */
  consume(
    resource: 'catalog_query' | 'fetch' | 'browser_session' | 'model_call',
    amount: number,
  ): void;
}

export interface InterpretIntentInput {
  domain: ShoppingDomain;
  source:
    | { kind: 'text'; text: string }
    | {
        kind: 'image';
        asset: InspirationAsset;
        /** Owner-checked normalized bytes, never a browser-supplied remote URL. */
        bytes: Uint8Array;
      };
  country: string;
  currency: string;
}

export interface IntentInterpreter {
  interpret(input: InterpretIntentInput, context: ShoppingContext): Promise<IntentBrief>;
}

export interface ProductQuery {
  slotId: string;
  text: string;
  country: string;
  currency: string;
  limit: number;
}

export interface ShoppingCatalog {
  search(query: ProductQuery, context: ShoppingContext): Promise<ProductOffer[]>;
  profileMerchant(
    domain: string,
    context: ShoppingContext,
  ): Promise<{
    merchant: MerchantIdentity;
    offers: ProductOffer[];
  }>;
}

export interface CollectionMatcher {
  match(
    brief: IntentBrief,
    offers: readonly ProductOffer[],
    context: ShoppingContext,
  ): Promise<CollectionMatch[]>;
}

export interface ShopperStore {
  getBrief(sessionId: string, briefId: string): Promise<IntentBrief | null>;
  /** Must atomically compare revision; null expectedRevision means create only. */
  saveBrief(sessionId: string, brief: IntentBrief, expectedRevision: number | null): Promise<void>;
  /** Implementations enforce ownership and current brief revision on writes. */
  saveMatches(sessionId: string, matches: readonly CollectionMatch[]): Promise<void>;
  getMatches(sessionId: string, briefId: string, revision: number): Promise<CollectionMatch[]>;
  deleteSession(sessionId: string): Promise<void>;
}

export interface PrivateAssetStore {
  put(sessionId: string, asset: InspirationAsset, normalizedBytes: Uint8Array): Promise<void>;
  /** Missing, expired or wrong owner returns null; never returns a public storage URL. */
  read(sessionId: string, assetId: string, now: Date): Promise<Uint8Array | null>;
  deleteSession(sessionId: string): Promise<void>;
}
