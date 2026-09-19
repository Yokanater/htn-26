/** Composition root: providers are wired here once, in dependency order. Owner: L4. */
import { createInjectedShoppingCatalog } from '@sei/collect';
import {
  type CollectionMatcher,
  type EnvLike,
  featureFlags,
  type ShoppingCatalog,
} from '@sei/core';
import { createCollectionMatcher } from '@sei/enrich';
import {
  type CollectionRunner,
  type CollectionRunnerOptions,
  createCollectionRunner,
  staticCatalog,
} from '@sei/pipeline';
import {
  createIntentInterpreter,
  createOpenAiIntentModel,
  fakeVisionDraft,
  type IntentModel,
  IntentModelError,
  type OpenAiIntentModelOptions,
} from '@sei/reason';
import { loadSeedOffers } from './replay';
import { ContainerImageNormalizer } from './services/image';
import {
  type ImageNormalizer,
  IntakeStore,
  type IntentDraftService,
  InterpreterIntentDraftService,
} from './services/intake';
import { PrivateCheckpointStore, RunRegistry } from './services/runs';
import { OwnerSessions } from './services/session';

export interface AppProviders {
  sessions: OwnerSessions;
  intake: IntakeStore;
  intent: IntentDraftService;
  imageNormalizer: ImageNormalizer | null;
  catalog: ShoppingCatalog;
  matcher: CollectionMatcher;
  checkpoints: PrivateCheckpointStore;
  runs: RunRegistry;
  runner: CollectionRunner;
  now: () => Date;
}

export interface ProviderOptions {
  /** Test seam: inject the OpenAI client/logger/sleep. Never used to reach a live provider. */
  intentModel?: OpenAiIntentModelOptions;
  /** Runner tuning (caps, timeouts). `enabled`, catalog, matcher and events stay wired here. */
  runner?: Partial<
    Omit<CollectionRunnerOptions, 'enabled' | 'openCatalog' | 'matcher' | 'onEvent'>
  >;
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

/** CATALOG_PROVIDER: `fake` (default) serves the synthetic seed offers; live is not wired yet. */
function createCatalog(env: EnvLike): ShoppingCatalog {
  const provider = env.CATALOG_PROVIDER?.trim().toLowerCase() || 'fake';
  if (provider === 'fake') {
    return createInjectedShoppingCatalog({ offers: loadSeedOffers(), sampleOrigin: 'seed' });
  }
  throw new Error(
    `Unsupported CATALOG_PROVIDER "${provider}": only "fake" is available until the live catalog spike lands`,
  );
}

export function defaultProviders(env: EnvLike = {}, options: ProviderOptions = {}): AppProviders {
  const overrides = options.overrides ?? {};
  const now = overrides.now ?? (() => new Date());
  const runs = overrides.runs ?? new RunRegistry();
  const checkpoints = overrides.checkpoints ?? new PrivateCheckpointStore();
  const catalog = overrides.catalog ?? createCatalog(env);
  const matcher = overrides.matcher ?? createCollectionMatcher();
  return {
    sessions: overrides.sessions ?? new OwnerSessions(),
    intake: overrides.intake ?? new IntakeStore(),
    intent: overrides.intent ?? createIntentService(env, options.intentModel, now),
    imageNormalizer:
      overrides.imageNormalizer === undefined
        ? new ContainerImageNormalizer()
        : overrides.imageNormalizer,
    catalog,
    matcher,
    checkpoints,
    runs,
    runner:
      overrides.runner ??
      createCollectionRunner({
        clock: now,
        ...options.runner,
        enabled: featureFlags(env).FEATURE_COLLECTION_MATCHING === true,
        openCatalog: staticCatalog(catalog),
        matcher,
        checkpoints,
        onEvent: (event) => runs.publish(event),
      }),
    now,
  };
}
