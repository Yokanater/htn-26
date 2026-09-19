/** S1 integration hardening: typed errors, deletion privacy, and env-driven intent provider. */
import { IntentBriefSchema } from '@sei/contracts';
import {
  createIntentInterpreter,
  FakeIntentModel,
  fakeVisionDraft,
  IntentInterpretationError,
  type IntentInterpretationErrorKind,
  type OpenAiIntentModelOptions,
} from '@sei/reason';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { defaultProviders } from '../src/providers';
import {
  IntakeStore,
  type IntentDraftService,
  InterpreterIntentDraftService,
} from '../src/services/intake';

const PRIVATE = 'zebra-striped-private-sentinel';
const TEXT = `A compact desk setup with ${PRIVATE} details`;

async function session(app: ReturnType<typeof createApp>): Promise<string> {
  return (await app.request('/api/session')).headers.get('set-cookie')?.split(';')[0] ?? '';
}
const json = (cookie: string) => ({ cookie, 'Content-Type': 'application/json' });
const createBrief = (app: ReturnType<typeof createApp>, cookie: string, text = TEXT) =>
  app.request('/api/briefs', {
    method: 'POST',
    headers: json(cookie),
    body: JSON.stringify({ domain: 'setup', text }),
  });
const failing = (error: unknown): IntentDraftService => ({
  async createDraft() {
    throw error;
  },
});

describe('typed error responses', () => {
  it.each<[IntentInterpretationErrorKind, number, string]>([
    ['invalid_input', 400, 'INVALID_BRIEF'],
    ['budget_exhausted', 503, 'INTENT_UNAVAILABLE'],
    ['refusal', 422, 'INTENT_REFUSED'],
    ['incomplete', 502, 'INTENT_INVALID_OUTPUT'],
    ['invalid_output', 502, 'INTENT_INVALID_OUTPUT'],
    ['transport', 502, 'INTENT_PROVIDER_ERROR'],
    ['timeout', 504, 'INTENT_TIMEOUT'],
    ['aborted', 503, 'INTENT_CANCELLED'],
  ])('maps interpreter failure %s to %i %s as JSON', async (kind, status, code) => {
    const app = createApp(
      { MILESTONES: 's1' },
      { intent: failing(new IntentInterpretationError(kind, 1)) },
    );
    const response = await createBrief(app, await session(app));
    expect(response.status).toBe(status);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = await response.json();
    expect(body).toEqual({ error: { code, message: expect.any(String) } });
    expect(JSON.stringify(body)).not.toContain(PRIVATE);
  });

  it('returns a generic JSON 500 that never echoes the underlying error', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = createApp(
      { MILESTONES: 's1' },
      { intent: failing(new Error(`provider said: ${PRIVATE}`)) },
    );
    const response = await createBrief(app, await session(app));
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      error: { code: 'INTERNAL_ERROR', message: expect.any(String) },
    });
    expect(text).not.toContain(PRIVATE);
    expect(quiet.mock.calls.flat().join(' ')).not.toContain(PRIVATE);
    quiet.mockRestore();
  });

  it('answers an unknown API path with a JSON 404', async () => {
    const app = createApp({ MILESTONES: 's1' });
    const response = await app.request('/api/does-not-exist');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String) },
    });
  });

  it('rejects a malformed multipart upload with a JSON 400 instead of a 500', async () => {
    const app = createApp({ MILESTONES: 's1' });
    const response = await app.request('/api/assets', {
      method: 'POST',
      headers: { cookie: await session(app), 'content-type': 'multipart/form-data; boundary=x' },
      body: 'this is not a multipart body',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: 'INVALID_UPLOAD', message: expect.any(String) },
    });
  });
});

describe('deletion privacy', () => {
  it('does not run the default intent path through a request-recording fake', async () => {
    const recording = vi.spyOn(FakeIntentModel.prototype, 'draft');
    const app = createApp({ MILESTONES: 's1' });
    const cookie = await session(app);
    expect((await createBrief(app, cookie)).status).toBe(201);
    await app.request('/api/session', { method: 'DELETE', headers: { cookie } });
    expect(recording).not.toHaveBeenCalled();
    recording.mockRestore();
  });

  it('does not store a brief that finishes after the session was deleted', async () => {
    const inner = new InterpreterIntentDraftService(
      createIntentInterpreter({ model: new FakeIntentModel() }),
    );
    let started!: () => void;
    const hasStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let draftId = '';
    const intent: IntentDraftService = {
      async createDraft(input) {
        started();
        await gate;
        const draft = await inner.createDraft(input);
        draftId = draft.id;
        return draft;
      },
    };
    const intake = new IntakeStore();
    const app = createApp({ MILESTONES: 's1' }, { intent, intake });
    const cookie = await session(app);
    const ownerId = cookie.split('=')[1] ?? '';

    const pending = createBrief(app, cookie);
    await hasStarted;
    await app.request('/api/session', { method: 'DELETE', headers: { cookie } });
    release();
    const response = await pending;

    expect(response.status).toBe(401);
    expect(intake.getBrief(ownerId, draftId)).toBeNull();
  });

  it('does not store an asset that finishes normalizing after the session was deleted', async () => {
    let started!: () => void;
    const hasStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const intake = new IntakeStore();
    const putAsset = vi.spyOn(intake, 'putAsset');
    const app = createApp(
      { MILESTONES: 's1' },
      {
        intake,
        imageNormalizer: {
          async normalize() {
            started();
            await gate;
            return { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' };
          },
        },
      },
    );
    const cookie = await session(app);
    const form = new FormData();
    form.set(
      'image',
      new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' }),
    );

    const pending = app.request('/api/assets', { method: 'POST', headers: { cookie }, body: form });
    await hasStarted;
    await app.request('/api/session', { method: 'DELETE', headers: { cookie } });
    release();

    expect((await pending).status).toBe(401);
    expect(putAsset).not.toHaveBeenCalled();
  });
});

describe('intent provider selection', () => {
  const openAiEnv = {
    VISION_PROVIDER: 'openai',
    OPENAI_MODEL_VISION: 'test-model',
    OPENAI_API_KEY: 'k',
  };
  const fakeClient = () => {
    const create = vi.fn(async () => {
      const text = JSON.stringify({ ...fakeVisionDraft('setup'), ambiguityNote: 'from-model' });
      return {
        id: 'resp_1',
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
        output_text: text,
      };
    });
    return {
      create,
      client: { responses: { create } } as unknown as OpenAiIntentModelOptions['client'],
    };
  };

  it('marks synthetic drafts as seed when no provider is configured', async () => {
    const app = createApp({ MILESTONES: 's1' });
    const brief = IntentBriefSchema.parse(
      await (await createBrief(app, await session(app))).json(),
    );
    expect(brief.sampleOrigin).toBe('seed');
  });

  it('uses the configured OpenAI adapter and marks its drafts live', async () => {
    const { create, client } = fakeClient();
    const providers = defaultProviders(openAiEnv, {
      intentModel: { client, logger: () => {}, sleep: async () => {} },
    });
    const app = createApp({ MILESTONES: 's1', ...openAiEnv }, providers);
    const brief = IntentBriefSchema.parse(
      await (await createBrief(app, await session(app))).json(),
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(brief.sampleOrigin).toBe('live');
  });

  it.each([
    [{ VISION_PROVIDER: 'openai', OPENAI_API_KEY: 'k' }, /OPENAI_MODEL_VISION/],
    [{ VISION_PROVIDER: 'openai', OPENAI_MODEL_VISION: 'm' }, /OPENAI_API_KEY/],
    [{ VISION_PROVIDER: 'banana' }, /VISION_PROVIDER/],
  ])('fails fast on incomplete provider configuration %j', (env, message) => {
    expect(() => defaultProviders(env)).toThrow(message);
  });
});
