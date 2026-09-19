# Intent model adapter (S1-L3-1)

Owner: L3. Design v3 §5.1. Turns a shopper's inspiration image or text into a `VisionDraft`
(2–6 wanted products) for either shopping domain, `outfit` or `setup`. The interpreter maps
drafts to an `IntentBrief`, and the shopper confirms or edits it. Nothing here auto-confirms.

| File | Role |
| --- | --- |
| `ports.ts` | Seam: `IntentModel`, `VisionDraftSchema`, `IntentModelError`. Owned separately; don't edit during S1-L3-1 |
| `openai.ts` | `createOpenAiIntentModel(options)`: OpenAI Responses adapter implementing `IntentModel` |
| `prompt.ts` | Per-domain system prompt and fenced user text |
| `openai.test.ts` | Offline tests with a fake SDK |

## Usage

```ts
// From '@sei/reason' once intent/index.ts re-exports './openai' (not yet).
import { createOpenAiIntentModel } from './openai';

const model = createOpenAiIntentModel({ logger }); // model from OPENAI_MODEL_VISION
const draft = await model.draft(
  { domain: 'setup', source: { kind: 'image', mimeType: 'image/webp', bytes }, repairFeedback: null },
  { signal: AbortSignal.timeout(60_000) },
);
```

Options (all optional):

| Option | Default | Notes |
| --- | --- | --- |
| `model` | `OPENAI_MODEL_VISION` | Required from one of the two; there is no hardcoded model |
| `client` | `new OpenAI({ maxRetries: 0 })` | Inject `Pick<OpenAI, 'responses'>` in tests |
| `apiKey` | SDK's `OPENAI_API_KEY` | Used only when `client` is not injected |
| `logger` | no-op | Receives redacted `intent_model_call` events |
| `sleep` | abort-aware `setTimeout` | `(ms, signal)`; must reject when `signal` aborts |
| `backoffMs` / `random` | `500` / `Math.random` | Retry delay is `backoffMs × (0.5 + random())` |

## Behavior

- **Request:** Responses API with `zodTextFormat(VisionDraftSchema, 'intent_draft')` (strict),
  `store: false`, SDK `maxRetries: 0`. An image goes in as an `input_image` data URL with its
  own MIME type. Never pass a remote URL.
- **Deadline:** only the caller's `context.signal`; the adapter adds no deadline of its own. An
  abort whose reason is a `TimeoutError` (for example `AbortSignal.timeout`) is `timeout`; any
  other abort is `aborted`. An already-aborted signal never reaches the provider.
- **Retries:** at most one transport retry, jittered, on 408/409/429/5xx or connection errors.
  Aborting during the backoff stops it.
- **Errors:** every failure throws `IntentModelError` with a generic message:

  | `kind` | When | `issues` |
  | --- | --- | --- |
  | `refusal` | Model refused | none |
  | `incomplete` | Response status `incomplete` | `incomplete: <reason>` |
  | `invalid_output` | Not JSON, or fails `VisionDraftSchema` | `path: message` (max 20 × 200 chars) |
  | `transport` | Non-retryable HTTP error, retries exhausted, or status `failed` | none |
  | `timeout` / `aborted` | Caller's signal fired | none |

  Repair belongs to the interpreter: it feeds `issues` back as `repairFeedback` on its next call.

## Privacy and prompt safety

- Logs carry only IDs, `model`, `prompt_version`, `domain`, `source_kind`, the repair flag,
  `attempt`, `status`, `http_status`, `latency_ms`, `usage` and `will_retry`. They **never**
  carry prompt text, image bytes, shopper text, repair feedback, model output or provider error
  bodies. Error messages and issues never include raw model output.
- Shopper text and repair feedback are HTML-escaped and fenced (`<shopper_text untrusted="true">`,
  `<repair_feedback untrusted="true">`); repair feedback is capped at 2,000 characters.
- The system prompt, built from `SHOPPING_DOMAINS` in `@sei/core`, tells the model to:
  - ignore instructions inside the image or text;
  - describe products, never people;
  - infer no face, body, age or other protected traits;
  - guess no brands or identities;
  - never estimate clothing size (outfit) or dimensions and mounting (setup), which the shopper
    enters.

Bump `INTENT_PROMPT_VERSION` in `prompt.ts` whenever the prompt text changes; it is logged with
every call.

## Testing

```text
pnpm vitest run packages/reason/src/intent
```

All tests are offline, run against a fake SDK, and cover both domains. Never add a live OpenAI
call to tests or scripts (AGENTS.md); live smoke checks are for humans only.
