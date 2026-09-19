/** S1-L3-1 intent interpretation. Offline: FakeIntentModel only. Owner: L3. */
import {
  type InspirationAsset,
  type IntentBrief,
  IntentBriefSchema,
  type SampleOrigin,
  type ShoppingDomain,
} from '@sei/contracts';
import type { InterpretIntentInput, ShoppingContext } from '@sei/core';
import { describe, expect, it } from 'vitest';
import {
  createIntentInterpreter,
  FakeIntentModel,
  type FakeIntentStep,
  fakeVisionDraft,
  IntentInterpretationError,
  IntentModelError,
  mapVisionDraft,
  type VisionDraft,
} from '../src';

const DOMAINS: ShoppingDomain[] = ['outfit', 'setup'];
const NOW = new Date('2026-09-19T12:00:00Z');
const IMAGE_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const ASSET: InspirationAsset = {
  id: 'asset_test_1',
  mimeType: 'image/jpeg',
  byteLength: IMAGE_BYTES.byteLength,
  expiresAt: '2026-09-20T12:00:00Z',
};
const SECRET_TEXT = 'my private inspiration notes 12345';

function makeContext(
  overrides: Partial<ShoppingContext> & { budget?: number } = {},
): ShoppingContext & { consumed: number } {
  const budget = overrides.budget ?? 10;
  const ctx = {
    signal: overrides.signal ?? new AbortController().signal,
    sampleOrigin: overrides.sampleOrigin ?? ('live' as SampleOrigin),
    consumed: 0,
    consume(resource: string, amount: number) {
      expect(resource).toBe('model_call');
      if (ctx.consumed + amount > budget) throw new Error('budget exceeded');
      ctx.consumed += amount;
    },
  };
  return ctx;
}

function textInput(domain: ShoppingDomain, text = SECRET_TEXT): InterpretIntentInput {
  return { domain, source: { kind: 'text', text }, country: 'CA', currency: 'CAD' };
}
function imageInput(domain: ShoppingDomain): InterpretIntentInput {
  return {
    domain,
    source: { kind: 'image', asset: ASSET, bytes: IMAGE_BYTES },
    country: 'CA',
    currency: 'CAD',
  };
}

function setup(script: FakeIntentStep[] = [], timeoutMs?: number) {
  const model = new FakeIntentModel(script);
  let n = 0;
  const interpreter = createIntentInterpreter({
    model,
    clock: () => NOW,
    ids: (prefix) => `${prefix}t${++n}`,
    timeoutMs,
  });
  return { model, interpreter };
}

async function rejection(promise: Promise<unknown>): Promise<IntentInterpretationError> {
  const error = await promise.then(
    () => {
      throw new Error('expected rejection');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(IntentInterpretationError);
  const typed = error as IntentInterpretationError;
  expect(typed.message).not.toContain(SECRET_TEXT);
  return typed;
}

function oneSlotDraft(domain: ShoppingDomain): VisionDraft {
  const draft = fakeVisionDraft(domain);
  return { ...draft, slots: draft.slots.slice(0, 1) };
}

describe.each(DOMAINS)('%s interpretation', (domain) => {
  it('text input yields a schema-valid draft brief', async () => {
    const { model, interpreter } = setup();
    const context = makeContext();
    const brief = await interpreter.interpret(textInput(domain), context);

    expect(IntentBriefSchema.safeParse(brief).success).toBe(true);
    expect(brief).toMatchObject({
      domain,
      revision: 1,
      status: 'draft',
      input: { kind: 'text', text: SECRET_TEXT },
      country: 'CA',
      currency: 'CAD',
      itemBudget: null,
      sampleOrigin: 'live',
      createdAt: NOW.toISOString(),
    });
    expect(brief.id).toMatch(/^brief_/);
    expect(brief.slots.every((slot) => slot.id.startsWith('slot_'))).toBe(true);
    expect(context.consumed).toBe(1);
    expect(model.requests[0]).toMatchObject({ domain, repairFeedback: null });
  });

  it('image input yields the same shape, referencing the asset and never embedding bytes', async () => {
    const { model, interpreter } = setup();
    const fromImage = await interpreter.interpret(imageInput(domain), makeContext());
    const fromText = await setup().interpreter.interpret(textInput(domain), makeContext());

    expect(IntentBriefSchema.safeParse(fromImage).success).toBe(true);
    expect(fromImage.input).toEqual({ kind: 'image', assetId: ASSET.id });
    expect(fromImage.slots.map(({ id: _, ...s }) => s)).toEqual(
      fromText.slots.map(({ id: _, ...s }) => s),
    );
    expect(model.requests[0]?.source).toEqual({
      kind: 'image',
      mimeType: 'image/jpeg',
      bytes: IMAGE_BYTES,
    });
  });

  it('sampleOrigin comes from the context, not the model or input', async () => {
    const { interpreter } = setup();
    for (const origin of ['seed', 'replay'] as const) {
      const brief = await interpreter.interpret(
        textInput(domain),
        makeContext({ sampleOrigin: origin }),
      );
      expect(brief.sampleOrigin).toBe(origin);
    }
  });

  it('repairs once with schema-issue feedback when the mapped brief is invalid', async () => {
    const { model, interpreter } = setup([{ kind: 'draft', draft: oneSlotDraft(domain) }]);
    const context = makeContext();
    const brief = await interpreter.interpret(textInput(domain), context);

    expect(brief.slots).toHaveLength(2);
    expect(context.consumed).toBe(2);
    expect(model.requests).toHaveLength(2);
    expect(model.requests[0]?.repairFeedback).toBeNull();
    expect(model.requests[1]?.repairFeedback).toContain('slots');
    expect(model.requests[1]?.repairFeedback).not.toContain(SECRET_TEXT);
  });

  it('repairs once when the model throws invalid_output', async () => {
    const { model, interpreter } = setup([
      { kind: 'error', error: new IntentModelError('invalid_output', 'bad json', ['slots: bad']) },
    ]);
    const brief = await interpreter.interpret(textInput(domain), makeContext());
    expect(brief.status).toBe('draft');
    expect(model.requests[1]?.repairFeedback).toContain('slots: bad');
  });

  it('fails as invalid_output after the single repair is exhausted', async () => {
    const { model, interpreter } = setup([
      { kind: 'draft', draft: oneSlotDraft(domain) },
      { kind: 'draft', draft: { slots: [], ambiguityNote: null } },
    ]);
    const context = makeContext();
    const error = await rejection(interpreter.interpret(textInput(domain), context));
    expect(error.kind).toBe('invalid_output');
    expect(error.attempts).toBe(2);
    expect(error.issues.length).toBeGreaterThan(0);
    expect(model.requests).toHaveLength(2);
    expect(context.consumed).toBe(2);
  });

  it.each(['refusal', 'incomplete', 'timeout', 'aborted', 'transport'] as const)(
    'does not retry a %s model error',
    async (kind) => {
      const { model, interpreter } = setup([
        { kind: 'error', error: new IntentModelError(kind, `provider said: ${SECRET_TEXT}`) },
      ]);
      const error = await rejection(interpreter.interpret(textInput(domain), makeContext()));
      expect(error.kind).toBe(kind);
      expect(model.requests).toHaveLength(1);
    },
  );

  it('checks the budget before the first call', async () => {
    const { model, interpreter } = setup();
    const error = await rejection(
      interpreter.interpret(textInput(domain), makeContext({ budget: 0 })),
    );
    expect(error.kind).toBe('budget_exhausted');
    expect(model.requests).toHaveLength(0);
  });

  it('checks the budget before the repair attempt', async () => {
    const { model, interpreter } = setup([{ kind: 'draft', draft: oneSlotDraft(domain) }]);
    const error = await rejection(
      interpreter.interpret(textInput(domain), makeContext({ budget: 1 })),
    );
    expect(error.kind).toBe('budget_exhausted');
    expect(model.requests).toHaveLength(1);
  });

  it('aborts when the caller signal fires mid-call and passes the signal to the model', async () => {
    const { model, interpreter } = setup([{ kind: 'hang' }]);
    const controller = new AbortController();
    const pending = interpreter.interpret(
      textInput(domain),
      makeContext({ signal: controller.signal }),
    );
    await Promise.resolve();
    controller.abort();
    const error = await rejection(pending);
    expect(error.kind).toBe('aborted');
    expect(model.requests).toHaveLength(1);
  });

  it('does not call the model when already aborted', async () => {
    const { model, interpreter } = setup();
    const controller = new AbortController();
    controller.abort();
    const context = makeContext({ signal: controller.signal });
    const error = await rejection(interpreter.interpret(textInput(domain), context));
    expect(error.kind).toBe('aborted');
    expect(model.requests).toHaveLength(0);
    expect(context.consumed).toBe(0);
  });

  it('times out on the shared deadline, even across a repair', async () => {
    const { model, interpreter } = setup(
      [{ kind: 'draft', draft: oneSlotDraft(domain) }, { kind: 'hang' }],
      30,
    );
    const error = await rejection(interpreter.interpret(textInput(domain), makeContext()));
    expect(error.kind).toBe('timeout');
    expect(model.requests).toHaveLength(2);
  });

  it('never emits constraints, so a cross-domain constraint is impossible', async () => {
    const other = domain === 'outfit' ? 'height 90cm, no drilling' : 'size M';
    const draft = fakeVisionDraft(domain);
    for (const slot of draft.slots) slot.visualAttributes.push(other);
    const { interpreter } = setup([{ kind: 'draft', draft }]);
    const brief = await interpreter.interpret(textInput(domain), makeContext());
    expect(brief.slots.every((slot) => slot.constraints.length === 0)).toBe(true);
    expect(IntentBriefSchema.safeParse(brief).success).toBe(true);
  });

  it('treats model-supplied constraints as invalid output (strict schema) and repairs', async () => {
    const draft = fakeVisionDraft(domain) as unknown as {
      slots: Record<string, unknown>[];
    };
    draft.slots[0]!.constraints =
      domain === 'outfit'
        ? [{ kind: 'mounting', value: 'freestanding' }]
        : [{ kind: 'size', value: 'M' }];
    const { model, interpreter } = setup([{ kind: 'draft', draft }]);
    const brief = await interpreter.interpret(textInput(domain), makeContext());
    expect(model.requests).toHaveLength(2);
    expect(brief.slots.every((slot) => slot.constraints.length === 0)).toBe(true);
  });
});

describe('mapper', () => {
  const base = {
    input: { kind: 'text', text: 'x' } as const,
    country: 'CA',
    currency: 'CAD',
    sampleOrigin: 'seed' as const,
    createdAt: NOW,
  };

  it.each(DOMAINS)('%s: never confirmed and always has a required slot', (domain) => {
    const draft = fakeVisionDraft(domain);
    for (const slot of draft.slots) slot.requiredSuggested = false;
    const result = mapVisionDraft(draft, { ...base, domain });
    expect(result.ok).toBe(true);
    const brief = (result as { brief: IntentBrief }).brief;
    expect(brief.status).toBe('draft');
    expect(brief.slots[0]?.required).toBe(true);
    expect(brief.slots.filter((slot) => slot.required)).toHaveLength(1);
    expect(brief.slots.every((slot) => slot.constraints.length === 0)).toBe(true);
    expect(IntentBriefSchema.safeParse(brief).success).toBe(true);
  });

  it('trims, dedupes and truncates to schema limits', () => {
    const slot = fakeVisionDraft('setup').slots[0]!;
    const many = Array.from({ length: 9 }, (_, i) => ({
      ...slot,
      category: `  cat\n${i % 8}  `,
      description: 'd'.repeat(700),
      visualAttributes: [
        ' Oak ',
        'oak',
        '',
        'x'.repeat(120),
        ...Array.from({ length: 20 }, (_, j) => `a${j}`),
      ],
    }));
    const result = mapVisionDraft(
      { slots: many, ambiguityNote: null },
      { ...base, domain: 'setup' },
    );
    expect(result.ok).toBe(true);
    const brief = (result as { brief: IntentBrief }).brief;
    expect(brief.slots).toHaveLength(6);
    expect(brief.slots[0]?.category).toBe('cat 0');
    expect(brief.slots[0]?.description).toHaveLength(500);
    const attributes = brief.slots[0]?.visualAttributes ?? [];
    expect(attributes).toHaveLength(12);
    expect(attributes[0]).toBe('Oak');
    expect(attributes[1]).toHaveLength(80);
    expect(IntentBriefSchema.safeParse(brief).success).toBe(true);
  });

  it('drops blank or duplicate slots and reports too few slots as issues', () => {
    const slot = fakeVisionDraft('outfit').slots[0]!;
    const result = mapVisionDraft(
      {
        slots: [slot, { ...slot, category: ' TOP ' }, { ...slot, category: '   ' }],
        ambiguityNote: null,
      },
      { ...base, domain: 'outfit' },
    );
    expect(result.ok).toBe(false);
    expect((result as { issues: string[] }).issues.join(' ')).toContain('slots');
  });
});

describe('input validation', () => {
  it.each([
    ['empty text', textInput('outfit', '   ')],
    ['oversized text', textInput('setup', 'x'.repeat(2001))],
    ['bad country', { ...textInput('outfit'), country: 'canada' }],
    [
      'byte length mismatch',
      { ...imageInput('setup'), source: { kind: 'image', asset: ASSET, bytes: new Uint8Array(3) } },
    ],
  ] as [string, InterpretIntentInput][])('rejects %s before any model call', async (_, input) => {
    const { model, interpreter } = setup();
    const context = makeContext();
    const error = await rejection(interpreter.interpret(input, context));
    expect(error.kind).toBe('invalid_input');
    expect(model.requests).toHaveLength(0);
    expect(context.consumed).toBe(0);
  });
});

describe('FakeIntentModel', () => {
  it('returns distinct deterministic drafts per domain', () => {
    const outfit = fakeVisionDraft('outfit').slots.map((s) => s.category);
    const setupCats = fakeVisionDraft('setup').slots.map((s) => s.category);
    expect(outfit).toEqual(['top', 'bag']);
    expect(setupCats).toEqual(['desk', 'lighting']);
    expect(fakeVisionDraft('outfit')).toEqual(fakeVisionDraft('outfit'));
  });
});
