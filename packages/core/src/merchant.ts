import type {
  CollaborationDraft,
  MerchantOpportunity,
  MerchantProfile,
  MerchantProgress,
  ShoppingDomain,
} from '@sei/contracts';

export interface MerchantProfiler {
  readonly origin: 'live' | 'seed';
  profile(input: {
    url: string;
    domain: ShoppingDomain;
    signal: AbortSignal;
    progress: (stage: MerchantProgress['stage'], message: string, count?: number) => void;
    liveView: (url: string | null) => void;
  }): Promise<MerchantProfile>;
}

/** Public candidate URLs only; search snippets never establish product or demand facts. */
export interface MerchantDiscovery {
  discover(profile: MerchantProfile, signal: AbortSignal): Promise<string[]>;
}

export interface CollaborationComposer {
  compose(
    opportunity: MerchantOpportunity,
    signal: AbortSignal,
  ): Promise<
    Pick<
      CollaborationDraft,
      'title' | 'hypothesis' | 'experiment' | 'outreach' | 'generatedBy' | 'warnings'
    >
  >;
}
/** Safe, actionable diagnostic; never expose raw provider errors or credentials to clients. */
export class MerchantScanError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MerchantScanError';
  }
}
