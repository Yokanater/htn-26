import type { IntentBrief } from '@sei/contracts';
import type { ShoppingCatalog } from '@sei/core';
import { createIntentInterpreter, createOpenAiIntentModel, FakeIntentModel } from '@sei/reason';
import { SipsImageNormalizer } from './services/image-normalizer';
import {
  type ImageNormalizer,
  IntakeStore,
  type IntentDraftService,
  InterpreterIntentDraftService,
} from './services/intake';
import { liveCatalog } from './services/live-catalog';
import { OwnerSessions } from './services/session';

export interface AppProviders {
  sessions: OwnerSessions;
  intake: IntakeStore;
  intent: IntentDraftService;
  imageNormalizer: ImageNormalizer | null;
  now: () => Date;
  catalog?: (brief: IntentBrief) => Pick<ShoppingCatalog, 'search'>;
}

export function defaultProviders(): AppProviders {
  const now = () => new Date();
  return {
    sessions: new OwnerSessions(),
    intake: new IntakeStore(),
    intent: new InterpreterIntentDraftService(
      createIntentInterpreter({ model: new FakeIntentModel(), clock: now }),
    ),
    imageNormalizer: null,
    now,
  };
}

/** Runtime uses actual inference; absent credentials never silently become demo results. */
export function runtimeProviders(env: Record<string, string | undefined>): AppProviders {
  const providers = defaultProviders();
  providers.catalog = (brief) => liveCatalog(brief, env);
  providers.imageNormalizer = process.platform === 'darwin' ? new SipsImageNormalizer() : null;
  if (env.OPENAI_API_KEY && env.OPENAI_MODEL_VISION) {
    providers.intent = new InterpreterIntentDraftService(
      createIntentInterpreter({
        model: createOpenAiIntentModel({
          apiKey: env.OPENAI_API_KEY,
          model: env.OPENAI_MODEL_VISION,
        }),
      }),
      'live',
    );
  } else {
    providers.intent = {
      async createDraft() {
        throw new Error('VISION_NOT_CONFIGURED');
      },
    };
  }
  return providers;
}
