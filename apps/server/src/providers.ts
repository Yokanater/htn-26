/** Composition root: providers are wired here once, in dependency order. Owner: L4. */
import { lookup } from 'node:dns/promises';
import {
  createBasetenCatalogExtractor,
  createInjectedShoppingCatalog,
  createLiveMerchantProfiler,
  createMerchantBrowser,
  createMerchantDiscovery,
} from '@sei/collect';
import type { IntentBrief } from '@sei/contracts';
import type { CollectionMatcher, EnvLike, ShoppingCatalog } from '@sei/core';
import {
  createCollectionMatcher,
  createDemandAggregator,
  createOpportunityMapper,
} from '@sei/enrich';
import {
  type CollectionRunner,
  type CollectionRunnerOptions,
  createCollectionRunner,
  staticCatalog,
} from '@sei/pipeline';
import {
  createCollaborationComposer,
  createIntentInterpreter,
  createOpenAiIntentModel,
  fakeVisionDraft,
  type IntentModel,
  IntentModelError,
  type OpenAiIntentModelOptions,
} from '@sei/reason';
import { loadSeedOffers } from './replay';
import { PrivateDemandLedger } from './services/demand';
import { DemandProjectionService } from './services/demand-projection';
import { ContainerImageNormalizer } from './services/image';
import { SipsImageNormalizer } from './services/image-normalizer';
import {
  type ImageNormalizer,
  IntakeStore,
  type IntentDraftService,
  InterpreterIntentDraftService,
} from './services/intake';
import { liveCatalog } from './services/live-catalog';
import { createSeedMerchantProfiler, MerchantWorkspaceService } from './services/merchant';
import { PrivateCheckpointStore, RunRegistry } from './services/runs';
import { OwnerSessions } from './services/session';

export interface AppProviders {
  sessions: OwnerSessions;
  intake: IntakeStore;
  intent: IntentDraftService;
  imageNormalizer: ImageNormalizer | null;
  catalog: ShoppingCatalog | ((brief: IntentBrief) => Pick<ShoppingCatalog, 'search'>);
  matcher: CollectionMatcher;
  checkpoints: PrivateCheckpointStore;
  runs: RunRegistry;
  runner: CollectionRunner;
  demand: PrivateDemandLedger;
  /** Projects the private ledger into consent-gated published snapshots (S3). */
  demandProjection: DemandProjectionService;
  merchants: MerchantWorkspaceService;
  now: () => Date;
}

export interface ProviderOptions {
  /** Test seam: inject the OpenAI client/logger/sleep. Never used to reach a live provider. */
  intentModel?: OpenAiIntentModelOptions;
  /** Runner tuning (caps, timeouts). Catalog, matcher and events stay wired here. */
  runner?: Partial<Omit<CollectionRunnerOptions, 'openCatalog' | 'matcher' | 'onEvent'>>;
  /** Replace individual providers; everything else is still built from the environment. */
  overrides?: Partial<AppProviders>;
}

/**
 * Canned drafts with no memory. The recording FakeIntentModel is a test double: its request
 * history would keep shopper text and image bytes alive after the session is deleted.
 */
export function createSyntheticIntentModel(): IntentModel {
  return {
    async draft(request, { signal }) {
      if (signal.aborted) throw new IntentModelError('aborted', 'Model call aborted');
      return fakeVisionDraft(request.domain);
    },
  };
}

/** Provider events carry IDs, latency and counts only, never prompts, text or image bytes. */
const logIntentEvent = (event: Record<string, unknown>) =>
  console.info('[intent]', JSON.stringify(event));

/** VISION_PROVIDER: `fake` (default; synthetic, origin 'seed') or `openai` (origin 'live'). */
function createIntentService(
  env: EnvLike,
  options: OpenAiIntentModelOptions | undefined,
  now: () => Date,
): IntentDraftService {
  const provider = env.VISION_PROVIDER?.trim().toLowerCase() || 'fake';
  if (provider === 'fake') {
    return new InterpreterIntentDraftService(
      createIntentInterpreter({ model: createSyntheticIntentModel(), clock: now }),
      'seed',
    );
  }
  if (provider === 'openai') {
    const apiKey = env.OPENAI_API_KEY?.trim();
    if (!apiKey && !options?.client) {
      throw new Error('VISION_PROVIDER=openai requires OPENAI_API_KEY');
    }
    const model = createOpenAiIntentModel({
      model: env.OPENAI_MODEL_VISION?.trim() ?? '',
      ...(apiKey ? { apiKey } : {}),
      logger: logIntentEvent,
      ...options,
    });
    return new InterpreterIntentDraftService(
      createIntentInterpreter({ model, clock: now }),
      'live',
    );
  }
  throw new Error(`Unsupported VISION_PROVIDER "${provider}" (expected "fake" or "openai")`);
}

/** Live discovery is opt-in; tests and the default application use synthetic inventory. */
function createCatalog(env: EnvLike): AppProviders['catalog'] {
  const provider = env.CATALOG_PROVIDER?.trim().toLowerCase() || 'fake';
  if (provider === 'fake') {
    return createInjectedShoppingCatalog({ offers: loadSeedOffers(), sampleOrigin: 'seed' });
  }
  if (provider === 'openai') {
    if (
      !env.OPENAI_API_KEY?.trim() ||
      !(env.OPENAI_MODEL_SEARCH || env.OPENAI_MODEL_VISION)?.trim()
    ) {
      throw new Error(
        'CATALOG_PROVIDER=openai requires OPENAI_API_KEY and a search or vision model',
      );
    }
    return (brief) => liveCatalog(brief, env);
  }
  throw new Error(`Unsupported CATALOG_PROVIDER "${provider}" (expected "fake" or "openai")`);
}

export function defaultProviders(env: EnvLike = {}, options: ProviderOptions = {}): AppProviders {
  const overrides = options.overrides ?? {};
  const now = overrides.now ?? (() => new Date());
  const runs = overrides.runs ?? new RunRegistry();
  const checkpoints = overrides.checkpoints ?? new PrivateCheckpointStore();
  const catalog = overrides.catalog ?? createCatalog(env);
  const matcher = overrides.matcher ?? createCollectionMatcher();
  const intake = overrides.intake ?? new IntakeStore();
  const demand = overrides.demand ?? new PrivateDemandLedger();
  const sessions = overrides.sessions ?? new OwnerSessions();
  const demandProjection =
    overrides.demandProjection ??
    new DemandProjectionService({
      ledger: demand,
      briefs: (ids) => intake.findBriefs(ids),
      aggregator: createDemandAggregator(),
      minimumSessions: Math.max(5, positiveInt(env.DEMAND_MIN_SESSIONS, 5)),
      snapshotMinutes: positiveInt(env.DEMAND_SNAPSHOT_MINUTES, 15),
      retentionDays: positiveInt(env.DEMAND_RETENTION_DAYS, 30),
      now,
    });
  const merchantLive = env.MERCHANT_PROVIDER === 'browserbase_baseten';
  if (
    merchantLive &&
    !overrides.merchants &&
    (!env.BROWSERBASE_API_KEY ||
      !env.BROWSERBASE_PROJECT_ID ||
      !env.BASETEN_API_KEY ||
      !env.BASETEN_TAGGER_MODEL)
  )
    throw new Error(
      'MERCHANT_PROVIDER=browserbase_baseten requires BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, BASETEN_API_KEY and BASETEN_TAGGER_MODEL',
    );
  const dns = (host: string) => lookup(host, { all: true });
  const merchants =
    overrides.merchants ??
    new MerchantWorkspaceService({
      profiler: merchantLive
        ? createLiveMerchantProfiler({
            fetch,
            lookup: dns,
            now,
            browser: createMerchantBrowser({
              apiKey: env.BROWSERBASE_API_KEY ?? '',
              projectId: env.BROWSERBASE_PROJECT_ID ?? '',
              lookup: dns,
            }),
            extract: createBasetenCatalogExtractor({
              apiKey: env.BASETEN_API_KEY ?? '',
              model: env.BASETEN_TAGGER_MODEL ?? '',
            }),
          })
        : createSeedMerchantProfiler(),
      composer: createCollaborationComposer(
        merchantLive
          ? {
              apiKey: env.BASETEN_API_KEY ?? '',
              model: env.BASETEN_REASONING_MODEL || env.BASETEN_TAGGER_MODEL || '',
            }
          : undefined,
      ),
      mapper: createOpportunityMapper(),
      projection: demandProjection,
      ledger: demand,
      sessions,
      discovery: merchantLive
        ? createMerchantDiscovery({ apiKey: env.BROWSERBASE_API_KEY ?? '', lookup: dns })
        : {
            discover: async (profile) => [
              ...new Set(
                loadSeedOffers()
                  .filter(
                    (offer) =>
                      offer.id.includes(`_${profile.domain}_`) &&
                      offer.merchant.domain !== profile.merchant.domain,
                  )
                  .map((offer) => `https://${offer.merchant.domain}`),
              ),
            ],
          },
      now,
    });
  return {
    sessions,
    merchants,
    intake,
    intent: overrides.intent ?? createIntentService(env, options.intentModel, now),
    imageNormalizer:
      overrides.imageNormalizer === undefined
        ? env.IMAGE_NORMALIZER === 'sips'
          ? new SipsImageNormalizer()
          : new ContainerImageNormalizer()
        : overrides.imageNormalizer,
    catalog,
    matcher,
    checkpoints,
    runs,
    demand,
    demandProjection,
    runner:
      overrides.runner ??
      createCollectionRunner({
        clock: now,
        ...options.runner,
        openCatalog:
          typeof catalog === 'function'
            ? async (_signal, brief) => ({ ...catalog(brief), close: async () => {} })
            : staticCatalog(catalog),
        matcher,
        checkpoints,
        onEvent: (event) => runs.publish(event),
      }),
    now,
  };
}

/** Reads a positive integer policy value, falling back when unset or malformed. */
function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw?.trim());
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
