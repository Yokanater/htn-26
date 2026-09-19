import type { EnvLike } from '@sei/core';
import {
  createIntentInterpreter,
  createOpenAiIntentModel,
  fakeVisionDraft,
  type IntentModel,
  IntentModelError,
  type OpenAiIntentModelOptions,
} from '@sei/reason';
import { ContainerImageNormalizer } from './services/image';
import {
  type ImageNormalizer,
  IntakeStore,
  type IntentDraftService,
  InterpreterIntentDraftService,
} from './services/intake';
import { OwnerSessions } from './services/session';

export interface AppProviders {
  sessions: OwnerSessions;
  intake: IntakeStore;
  intent: IntentDraftService;
  imageNormalizer: ImageNormalizer | null;
  now: () => Date;
}

export interface ProviderOptions {
  /** Test seam: inject the OpenAI client/logger/sleep. Never used to reach a live provider. */
  intentModel?: OpenAiIntentModelOptions;
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

export function defaultProviders(env: EnvLike = {}, options: ProviderOptions = {}): AppProviders {
  const now = () => new Date();
  return {
    sessions: new OwnerSessions(),
    intake: new IntakeStore(),
    intent: createIntentService(env, options.intentModel, now),
    imageNormalizer: new ContainerImageNormalizer(),
    now,
  };
}
