/** OpenAI Responses adapter for IntentModel. Owner: L3 (S1-L3-1). Design v3 §5.1.
 * Ported from workers/analysis/src/llm/openai.ts (origin/eval-release-gates): one jittered transport
 * retry, refusal/incomplete/invalid-output mapping, request-ID logging. Changed: honors only the
 * caller's signal (no private deadline), abort-aware backoff, and logs/errors never carry prompt
 * text, image bytes, shopper text, model output or provider error bodies.
 */
import OpenAI, { APIConnectionError } from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import {
  type IntentModel,
  type IntentModelCallContext,
  IntentModelError,
  type IntentModelRequest,
  type VisionDraft,
  VisionDraftSchema,
} from './ports';
import { buildIntentSystemPrompt, buildIntentUserText, INTENT_PROMPT_VERSION } from './prompt';

export type IntentModelLogger = (event: Record<string, unknown>) => void;

export interface OpenAiIntentModelOptions {
  /** Injected SDK client (tests pass a fake). Default: new OpenAI({ maxRetries: 0 }). */
  client?: Pick<OpenAI, 'responses'>;
  /** Model ID. Default: env OPENAI_MODEL_VISION. Never hardcoded. */
  model?: string;
  /** Used only when `client` is not injected. Default: the SDK's OPENAI_API_KEY lookup. */
  apiKey?: string;
  logger?: IntentModelLogger;
  /** Must reject when `signal` aborts. Default: abort-aware setTimeout. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Base backoff before the single transport retry; jittered to 0.5x–1.5x. Default 500. */
  backoffMs?: number;
  random?: () => number;
}

const SCHEMA_NAME = 'intent_draft';
const TRANSPORT_RETRIES = 1;
const RETRYABLE_STATUS = new Set([408, 409, 429]);
const MAX_ISSUES = 20;
const MAX_ISSUE_CHARS = 200;

const noopLogger: IntentModelLogger = () => {};

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function isRetryable(err: unknown): boolean {
  const status = (err as { status?: unknown }).status;
  if (typeof status === 'number') return RETRYABLE_STATUS.has(status) || status >= 500;
  // SDK errors don't set `name`; match the class. Covers APIConnectionTimeoutError.
  return err instanceof APIConnectionError;
}

/** Timeout when the caller's deadline fired (AbortSignal.timeout), aborted otherwise. */
function abortError(signal: AbortSignal): IntentModelError {
  const reason = signal.reason as { name?: unknown } | undefined;
  return reason?.name === 'TimeoutError'
    ? new IntentModelError('timeout', 'Intent model call timed out')
    : new IntentModelError('aborted', 'Intent model call was aborted');
}

/** Issue paths and zod messages only: never the rejected output itself. */
function schemaIssues(error: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}) {
  return error.issues
    .slice(0, MAX_ISSUES)
    .map((i) =>
      `${i.path.map(String).join('.') || '(root)'}: ${i.message}`.slice(0, MAX_ISSUE_CHARS),
    );
}

export function createOpenAiIntentModel(options: OpenAiIntentModelOptions = {}): IntentModel {
  const model = options.model ?? process.env.OPENAI_MODEL_VISION;
  if (!model) throw new Error('No vision model configured (set OPENAI_MODEL_VISION)');
  const client =
    options.client ??
    new OpenAI({ ...(options.apiKey ? { apiKey: options.apiKey } : {}), maxRetries: 0 });
  const log = options.logger ?? noopLogger;
  const sleep = options.sleep ?? abortableSleep;
  const backoffMs = options.backoffMs ?? 500;
  const random = options.random ?? Math.random;
  const format = zodTextFormat(VisionDraftSchema, SCHEMA_NAME);

  return {
    async draft(
      request: IntentModelRequest,
      context: IntentModelCallContext,
    ): Promise<VisionDraft> {
      const { signal } = context;
      const { source } = request;
      const content = [
        {
          type: 'input_text' as const,
          text: buildIntentUserText({
            domain: request.domain,
            text: source.kind === 'text' ? source.text : null,
            repairFeedback: request.repairFeedback,
          }),
        },
        ...(source.kind === 'image'
          ? [
              {
                type: 'input_image' as const,
                image_url: `data:${source.mimeType};base64,${Buffer.from(source.bytes).toString('base64')}`,
                detail: 'auto' as const,
              },
            ]
          : []),
      ];
      const base = {
        event: 'intent_model_call',
        model,
        prompt_version: INTENT_PROMPT_VERSION,
        domain: request.domain,
        source_kind: source.kind,
        repair: request.repairFeedback !== null,
      };

      for (let attempt = 1; ; attempt++) {
        if (signal.aborted) throw abortError(signal);
        const started = Date.now();
        let response: Awaited<ReturnType<typeof client.responses.create>> & {
          _request_id?: string | null;
        };
        try {
          response = await client.responses.create(
            {
              model,
              instructions: buildIntentSystemPrompt(request.domain),
              input: [{ role: 'user', content }],
              text: { format },
              store: false,
            },
            { signal, maxRetries: 0 },
          );
        } catch (err) {
          const e = err as { status?: number; requestID?: string | null };
          const aborted = signal.aborted;
          const retry = !aborted && attempt <= TRANSPORT_RETRIES && isRetryable(err);
          log({
            ...base,
            attempt,
            status: aborted ? 'aborted' : 'error',
            http_status: typeof e.status === 'number' ? e.status : null,
            request_id: e.requestID ?? null,
            latency_ms: Date.now() - started,
            will_retry: retry,
          });
          if (aborted) throw abortError(signal);
          if (!retry) throw new IntentModelError('transport', 'Intent model request failed');
          try {
            await sleep(backoffMs * (0.5 + random()), signal);
          } catch {
            throw abortError(signal);
          }
          continue;
        }

        log({
          ...base,
          attempt,
          status: response.status ?? 'unknown',
          request_id: response._request_id ?? null,
          response_id: response.id,
          latency_ms: Date.now() - started,
          usage: response.usage ?? null,
        });

        const refused = response.output
          .flatMap((o) => (o.type === 'message' ? o.content : []))
          .some((c) => c.type === 'refusal');
        if (refused) throw new IntentModelError('refusal', 'Intent model refused the request');
        if (response.status === 'incomplete')
          throw new IntentModelError('incomplete', 'Intent model response was incomplete', [
            `incomplete: ${response.incomplete_details?.reason ?? 'unknown'}`,
          ]);
        if (response.status === 'failed')
          throw new IntentModelError('transport', 'Intent model request failed');

        let json: unknown;
        try {
          json = JSON.parse(response.output_text ?? '');
        } catch {
          throw new IntentModelError('invalid_output', 'Intent model output was not valid JSON', [
            '(root): output is not valid JSON',
          ]);
        }
        const parsed = VisionDraftSchema.safeParse(json);
        if (!parsed.success)
          throw new IntentModelError(
            'invalid_output',
            'Intent model output failed schema validation',
            schemaIssues(parsed.error),
          );
        return parsed.data;
      }
    },
  };
}
