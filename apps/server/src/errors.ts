/** Typed JSON error bodies. Messages are fixed strings: never shopper text, bytes or provider output. */
import { CollectionRunError, type CollectionRunErrorKind } from '@sei/pipeline';
import { IntentInterpretationError, type IntentInterpretationErrorKind } from '@sei/reason';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export interface ErrorBody {
  error: { code: string; message: string };
}

export const errorBody = (code: string, message: string): ErrorBody => ({
  error: { code, message },
});

export const SESSION_ENDED = errorBody(
  'UNAUTHORIZED',
  'Your private session ended. Start a new one to continue.',
);

interface IntentFailure {
  status: ContentfulStatusCode;
  body: ErrorBody;
}

const INTENT_FAILURES: Record<IntentInterpretationErrorKind, IntentFailure> = {
  invalid_input: {
    status: 400,
    body: errorBody('INVALID_BRIEF', 'Check the description or image and try again.'),
  },
  budget_exhausted: {
    status: 503,
    body: errorBody('INTENT_UNAVAILABLE', 'Interpretation is busy. Try again in a moment.'),
  },
  refusal: {
    status: 422,
    body: errorBody(
      'INTENT_REFUSED',
      'That could not be interpreted. Try a different image or describe it in text.',
    ),
  },
  incomplete: {
    status: 502,
    body: errorBody('INTENT_INVALID_OUTPUT', 'The draft could not be built. Try again.'),
  },
  invalid_output: {
    status: 502,
    body: errorBody('INTENT_INVALID_OUTPUT', 'The draft could not be built. Try again.'),
  },
  transport: {
    status: 502,
    body: errorBody(
      'INTENT_PROVIDER_ERROR',
      'The interpretation service is unreachable. Try again.',
    ),
  },
  timeout: {
    status: 504,
    body: errorBody('INTENT_TIMEOUT', 'Interpretation took too long. Try again.'),
  },
  aborted: {
    status: 503,
    body: errorBody('INTENT_CANCELLED', 'Interpretation was cancelled.'),
  },
};

const RUN_FAILURES: Record<CollectionRunErrorKind, IntentFailure> = {
  invalid_brief: {
    status: 400,
    body: errorBody('INVALID_BRIEF', 'Review the brief fields and constraints.'),
  },
  not_confirmed: {
    status: 409,
    body: errorBody('BRIEF_NOT_CONFIRMED', 'Confirm the brief before searching for products.'),
  },
  stale_revision: {
    status: 409,
    body: errorBody(
      'STALE_REVISION',
      'A newer version of this brief exists. Reload it and search again.',
    ),
  },
};

/** The typed response for a refused collection run, or null when the error is not one. */
export function describeRunFailure(error: unknown): IntentFailure | null {
  return error instanceof CollectionRunError ? RUN_FAILURES[error.kind] : null;
}

/** The typed response for an interpreter failure, or null when the error is not one. */
export function describeIntentFailure(error: unknown): IntentFailure | null {
  return error instanceof IntentInterpretationError ? INTENT_FAILURES[error.kind] : null;
}
