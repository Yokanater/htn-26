import {
  FakeIntentDraftService,
  type ImageNormalizer,
  IntakeStore,
  type IntentDraftService,
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
  return {
    sessions: new OwnerSessions(),
    intake: new IntakeStore(),
    intent: new FakeIntentDraftService(),
    imageNormalizer: null,
    now: () => new Date(),
  };
}
