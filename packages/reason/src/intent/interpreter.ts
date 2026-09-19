/** IntentInterpreter: budgeted, deadline-bound model call + one schema repair. Owner: L3.
 * Design v3 §5.1, §9. Error messages are fixed strings: never shopper text, bytes or model output.
 */
import {
  CountryCodeSchema,
  CurrencyCodeSchema,
  InspirationAssetSchema,
  type IntentBrief,
} from '@sei/contracts';
import type { IntentInterpreter, InterpretIntentInput, ShoppingContext } from '@sei/core';
import { type IntentIdFactory, mapVisionDraft } from './mapper';
import {
  type IntentModel,
  IntentModelError,
  type IntentModelSource,
  type VisionDraft,
  VisionDraftSchema,
} from './ports';

export const INTENT_MAX_ATTEMPTS = 2;
export const INTENT_DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TEXT = 2000;
const MAX_ISSUES = 10;
const MAX_ISSUE_LENGTH = 200;

export type IntentInterpretationErrorKind =
  | 'invalid_input'
  | 'budget_exhausted'
  | 'refusal'
  | 'incomplete'
  | 'invalid_output'
  | 'transport'
  | 'timeout'
  | 'aborted';

const SAFE_MESSAGES: Record<IntentInterpretationErrorKind, string> = {
  invalid_input: 'Intent input is invalid',
  budget_exhausted: 'Model call budget exhausted',
  refusal: 'The model declined to interpret this input',
  incomplete: 'The model returned an incomplete interpretation',
  invalid_output: 'The model output could not be repaired into a valid brief',
  transport: 'The model provider could not be reached',
  timeout: 'Intent interpretation timed out',
  aborted: 'Intent interpretation was cancelled',
};

export class IntentInterpretationError extends Error {
  readonly kind: IntentInterpretationErrorKind;
  /** Schema-issue messages (paths and rule descriptions only) for invalid output. */
  readonly issues: readonly string[];
  readonly attempts: number;
  constructor(
    kind: IntentInterpretationErrorKind,
    attempts: number,
    issues: readonly string[] = [],
  ) {
    super(SAFE_MESSAGES[kind]);
    this.name = 'IntentInterpretationError';
    this.kind = kind;
    this.attempts = attempts;
    this.issues = issues;
  }
}

export interface IntentInterpreterOptions {
  model: IntentModel;
  clock?: () => Date;
  ids?: IntentIdFactory;
  /** One deadline shared by every attempt, including the repair. */
  timeoutMs?: number;
}

/** Escaped, capped repair feedback so issue text cannot smuggle instructions or blow the prompt. */
export function formatRepairFeedback(issues: readonly string[]): string {
  return issues
    .slice(0, MAX_ISSUES)
    .map((issue) => {
      const escaped = JSON.stringify(issue.slice(0, MAX_ISSUE_LENGTH));
      return `- ${escaped}`;
    })
    .join('\n');
}

function invalidInput(): IntentInterpretationError {
  return new IntentInterpretationError('invalid_input', 0);
}

function prepare(input: InterpretIntentInput): {
  source: IntentModelSource;
  briefInput: IntentBrief['input'];
} {
  if (!CountryCodeSchema.safeParse(input.country).success) throw invalidInput();
  if (!CurrencyCodeSchema.safeParse(input.currency).success) throw invalidInput();
  if (input.source.kind === 'text') {
    const text = input.source.text.trim();
    if (!text || text.length > MAX_TEXT) throw invalidInput();
    return { source: { kind: 'text', text }, briefInput: { kind: 'text', text } };
  }
  const asset = InspirationAssetSchema.safeParse(input.source.asset);
  const bytes = input.source.bytes;
  if (!asset.success || bytes.byteLength === 0 || bytes.byteLength !== asset.data.byteLength) {
    throw invalidInput();
  }
  return {
    source: { kind: 'image', mimeType: asset.data.mimeType, bytes },
    briefInput: { kind: 'image', assetId: asset.data.id },
  };
}

/** Reject as soon as the signal fires, even if the model ignores it. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export function createIntentInterpreter(options: IntentInterpreterOptions): IntentInterpreter {
  const clock = options.clock ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? INTENT_DEFAULT_TIMEOUT_MS;

  return {
    async interpret(input: InterpretIntentInput, context: ShoppingContext): Promise<IntentBrief> {
      const { source, briefInput } = prepare(input);
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(), timeoutMs);
      const signal = AbortSignal.any([context.signal, deadline.signal]);
      let attempts = 0;
      const stopped = () =>
        new IntentInterpretationError(context.signal.aborted ? 'aborted' : 'timeout', attempts);

      try {
        let repairFeedback: string | null = null;
        let issues: readonly string[] = [];
        while (attempts < INTENT_MAX_ATTEMPTS) {
          if (signal.aborted) throw stopped();
          try {
            context.consume('model_call', 1);
          } catch {
            throw new IntentInterpretationError('budget_exhausted', attempts);
          }
          attempts += 1;

          let draft: VisionDraft;
          try {
            const raw: unknown = await untilAborted(
              options.model.draft({ domain: input.domain, source, repairFeedback }, { signal }),
              signal,
            );
            const parsed = VisionDraftSchema.safeParse(raw);
            if (!parsed.success) {
              throw new IntentModelError(
                'invalid_output',
                'Model output failed the vision schema',
                parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
              );
            }
            draft = parsed.data;
          } catch (error) {
            if (signal.aborted) throw stopped();
            if (!(error instanceof IntentModelError)) {
              throw new IntentInterpretationError('transport', attempts);
            }
            if (error.kind !== 'invalid_output') {
              throw new IntentInterpretationError(error.kind, attempts);
            }
            issues = error.issues.length ? error.issues : ['(root): output did not match schema'];
            repairFeedback = formatRepairFeedback(issues);
            continue;
          }

          const mapped = mapVisionDraft(draft, {
            domain: input.domain,
            input: briefInput,
            country: input.country,
            currency: input.currency,
            sampleOrigin: context.sampleOrigin,
            createdAt: clock(),
            ids: options.ids,
          });
          if (mapped.ok) return mapped.brief;
          issues = mapped.issues;
          repairFeedback = formatRepairFeedback(issues);
        }
        throw new IntentInterpretationError(
          'invalid_output',
          attempts,
          issues.slice(0, MAX_ISSUES),
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
