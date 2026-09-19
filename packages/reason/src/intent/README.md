# Intent interpretation (L3, S1-L3-1)

Turns a shopper's image or text into a **draft** `IntentBrief` (design v3 §§4, 5.1). The model only
describes items; code owns identity, status, provenance and constraints. The shopper confirms the
brief later in the web brief editor (`apps/web/src/features/shopper/brief/`). Nothing here
auto-confirms, matches products or records demand.

| File | Role |
| --- | --- |
| `ports.ts` | Seam to model adapters: strict `VisionDraftSchema`, `IntentModel`, `IntentModelError`. Coordinator-owned; do not edit. |
| `interpreter.ts` | `createIntentInterpreter()`: validation, budget, deadline, one repair, typed errors. |
| `mapper.ts` | `mapVisionDraft()`: `VisionDraft` to a schema-valid draft brief, or schema issues. |
| `fake.ts` | `FakeIntentModel`: deterministic offline model for tests and demos. |

## Usage

```ts
import { createIntentInterpreter, FakeIntentModel } from '@sei/reason';

const interpreter = createIntentInterpreter({ model: new FakeIntentModel() });
const brief = await interpreter.interpret(
  { domain: 'setup', source: { kind: 'text', text: 'oak desk, warm lamp' }, country: 'CA', currency: 'CAD' },
  context, // ShoppingContext from @sei/core: signal, sampleOrigin, consume()
);
// brief.status === 'draft', brief.revision === 1
```

Options: `model` (required); `clock` (`() => Date`); `ids` (`(prefix) => string`, default `newId`);
`timeoutMs` (default 60 000, one deadline shared by every attempt).

For an image source, pass the owner-checked `InspirationAsset` and its normalized bytes. The brief
stores only `{ kind: 'image', assetId }`; bytes go to the model and nowhere else.

## Guarantees

- **Draft only:** `status: 'draft'`, `revision: 1`, `itemBudget: null`, and code-issued `brief_`/`slot_` IDs.
- **Provenance from the server:** `sampleOrigin` comes from `ShoppingContext`, and `country`/`currency`
  come from the input, never from the model.
- **No guessed fit:** every slot has `constraints: []`. Sizes, dimensions and mounting come only
  from the shopper in the editor, so a cross-domain constraint cannot appear.
- **Cleaned model text:** whitespace is collapsed and control characters removed. Blank or
  duplicate slots and attributes are dropped. Text is truncated to the contract limits
  (category 80, description 500, 12 attributes of 80, at most 6 slots). If the model marks no slot
  required, the first slot becomes required.
- **Schema-checked:** every returned brief passes `IntentBriefSchema`.

## Attempts and failures

1. Invalid input (bad country or currency, empty or over-2000-character text, asset/bytes mismatch)
   throws `invalid_input` before any budget is spent.
2. Every attempt starts with `context.consume('model_call', 1)`. If that throws, the interpreter
   throws `budget_exhausted` without calling the model.
3. The first attempt's output is re-checked against `VisionDraftSchema` and then mapped. If the
   output is invalid, or the model throws `invalid_output`, **one** repair attempt runs. It sends
   the schema issues as `repairFeedback`: at most 10 lines of 200 characters each, JSON-escaped,
   with no shopper text.
4. `refusal`, `incomplete`, `timeout`, `aborted` and `transport` are never retried. A cancelled
   `context.signal` gives `aborted`; the shared deadline gives `timeout`, even when the model
   ignores the signal.

Failures throw `IntentInterpretationError` with `kind`, `attempts`, `issues` and a fixed message.
Messages never contain shopper text, image bytes or model output, so they are safe to log.

## Adapters

A real adapter implements `IntentModel.draft()`. It uses `VisionDraftSchema` as the strict output
format, retries transport errors itself, honors `context.signal`, and maps provider outcomes to
`IntentModelError` kinds. Tests and scripts never call a live provider: use `FakeIntentModel`,
whose script steps are `draft`, `error` and `hang`, plus recorded responses in `fixtures/spikes/`.

## Tests

```sh
pnpm vitest run packages/reason/test/intent.test.ts
```

Both domains are tested with text and image input, along with repair success and exhaustion, every
non-retried error kind, budget checks before the first and repair calls, abort, the shared
timeout, input validation, and mapper limits.
