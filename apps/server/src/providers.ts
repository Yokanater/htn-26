import { createIntentInterpreter, FakeIntentModel } from '@sei/reason';
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
