/** S2-L4 match routes: ownership, confirmation barrier, resumable SSE, cancel, supersession. */

import { type IntentBrief, IntentBriefSchema, type ShoppingDomain } from '@sei/contracts';
import type { ShoppingCatalog } from '@sei/core';
import type { CollectionRunEvent } from '@sei/pipeline';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { defaultProviders } from '../src/providers';

type App = ReturnType<typeof createApp>;
const S2 = { MILESTONES: 's1,s2' };
const SECRET = 'MATCHER-SECRET upstream said no';

const CASES = [
  {
    domain: 'outfit',
    text: 'A relaxed neutral outfit with a structured bag',
    slot: 'top',
    constraint: { kind: 'size', value: 'M' },
  },
  {
    domain: 'setup',
    text: 'A compact desk setup with warm lighting',
    slot: 'desk',
    constraint: { kind: 'dimension', axis: 'width', maxCm: 120 },
  },
] as const;

const json = (cookie: string) => ({ cookie, 'Content-Type': 'application/json' });
const session = async (app: App) =>
  (await app.request('/api/session')).headers.get('set-cookie')?.split(';')[0] ?? '';

async function draftBrief(app: App, cookie: string, domain: ShoppingDomain, text: string) {
  const response = await app.request('/api/briefs', {
    method: 'POST',
    headers: json(cookie),
    body: JSON.stringify({ domain, text }),
  });
  return IntentBriefSchema.parse(await response.json());
}

/** Saves `changes` as the next revision; slot constraints are keyed by slot category. */
async function patchBrief(
  app: App,
  cookie: string,
  brief: IntentBrief,
  status: 'draft' | 'confirmed',
  constraints: Record<string, unknown[]> = {},
) {
  const response = await app.request(`/api/briefs/${brief.id}`, {
    method: 'PATCH',
    headers: json(cookie),
    body: JSON.stringify({
      expectedRevision: brief.revision,
      status,
      slots: brief.slots.map((slot) => ({
        ...slot,
        constraints: constraints[slot.category] ?? slot.constraints,
      })),
      country: brief.country,
      currency: brief.currency,
      itemBudget: brief.itemBudget,
    }),
  });
  expect(response.status).toBe(200);
  return IntentBriefSchema.parse(await response.json());
}

async function confirmedBrief(app: App, cookie: string, c: (typeof CASES)[number]) {
  const draft = await draftBrief(app, cookie, c.domain, c.text);
  return patchBrief(app, cookie, draft, 'confirmed', { [c.slot]: [c.constraint] });
}

const startRun = (app: App, cookie: string, briefId: string) =>
  app.request(`/api/briefs/${briefId}/matches`, {
    method: 'POST',
    headers: json(cookie),
    body: '{}',
  });

function parseSse(text: string) {
  return text
    .trim()
    .split(/\n\n+/)
    .filter(Boolean)
    .map((block) => {
      const fields = Object.fromEntries(
        block.split('\n').map((line) => {
          const at = line.indexOf(':');
          return [line.slice(0, at), line.slice(at + 1).trim()];
        }),
      );
      return { id: fields.id, event: fields.event, data: JSON.parse(fields.data ?? 'null') };
    });
}

/** A catalog whose searches wait for the run to be cancelled or superseded. */
function hangingCatalog() {
  const state = { searches: 0, aborted: 0 };
  const catalog: ShoppingCatalog = {
    async search(_query, context) {
      state.searches += 1;
      await new Promise<never>((_, reject) =>
        context.signal.addEventListener(
          'abort',
          () => {
            state.aborted += 1;
            reject(context.signal.reason);
          },
          { once: true },
        ),
      );
      return [];
    },
    async profileMerchant() {
      throw new Error('not used');
    },
  };
  return { catalog, state };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

describe.each(CASES)('$domain match routes', (c) => {
  it('refuses to search an unconfirmed brief and never calls the catalog', async () => {
    const searches: unknown[] = [];
    const catalog: ShoppingCatalog = {
      async search(query) {
        searches.push(query);
        return [];
      },
      async profileMerchant() {
        throw new Error('not used');
      },
    };
    const app = createApp(S2, { catalog });
    const cookie = await session(app);
    const draft = await draftBrief(app, cookie, c.domain, c.text);
    const response = await startRun(app, cookie, draft.id);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: 'BRIEF_NOT_CONFIRMED', message: expect.any(String) },
    });
    expect(searches).toHaveLength(0);
  });

  it('runs a confirmed brief and streams ordered stage events ending in one result', async () => {
    const app = createApp(S2);
    const cookie = await session(app);
    const brief = await confirmedBrief(app, cookie, c);
    const started = await startRun(app, cookie, brief.id);
    expect(started.status).toBe(202);
    const handle = (await started.json()) as { runId: string; briefRevision: number };
    expect(handle.briefRevision).toBe(brief.revision);

    const stream = await app.request(`/api/runs/${handle.runId}/events`, { headers: { cookie } });
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const events = parseSse(await stream.text());
    const seqs = events.map((event) => Number(event.id));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(events.filter((event) => event.event === 'result')).toHaveLength(1);
    const last = events.at(-1)!.data as CollectionRunEvent;
    expect(last.type).toBe('result');
    if (last.type === 'result') {
      expect(last.result).toMatchObject({
        status: 'ready',
        briefRevision: brief.revision,
        sampleOrigin: 'seed',
      });
    }
  });

  it('resumes after Last-Event-ID without replaying earlier events', async () => {
    const app = createApp(S2);
    const cookie = await session(app);
    const brief = await confirmedBrief(app, cookie, c);
    const { runId } = (await (await startRun(app, cookie, brief.id)).json()) as { runId: string };
    const all = parseSse(
      await (await app.request(`/api/runs/${runId}/events`, { headers: { cookie } })).text(),
    );
    const resumeFrom = all[2]!.id;
    const resumed = parseSse(
      await (
        await app.request(`/api/runs/${runId}/events`, {
          headers: { cookie, 'Last-Event-ID': resumeFrom! },
        })
      ).text(),
    );
    expect(resumed.map((event) => event.id)).toEqual(
      all.filter((event) => Number(event.id) > Number(resumeFrom)).map((event) => event.id),
    );
    expect(resumed.at(-1)!.event).toBe('result');
  });

  it('returns the finished result from GET /runs/:id and is idempotent per revision', async () => {
    const app = createApp(S2);
    const cookie = await session(app);
    const brief = await confirmedBrief(app, cookie, c);
    const first = (await (await startRun(app, cookie, brief.id)).json()) as { runId: string };
    const again = (await (await startRun(app, cookie, brief.id)).json()) as { runId: string };
    expect(again.runId).toBe(first.runId);
    await (await app.request(`/api/runs/${first.runId}/events`, { headers: { cookie } })).text();
    const finished = await (
      await app.request(`/api/runs/${first.runId}`, { headers: { cookie } })
    ).json();
    expect(finished).toMatchObject({ runId: first.runId, status: 'ready' });
    expect((finished as { result: { collection: unknown } }).result.collection).not.toBeNull();
  });

  it('hides runs and briefs from a different session', async () => {
    const app = createApp(S2);
    const owner = await session(app);
    const stranger = await session(app);
    const brief = await confirmedBrief(app, owner, c);
    const { runId } = (await (await startRun(app, owner, brief.id)).json()) as { runId: string };
    expect((await startRun(app, stranger, brief.id)).status).toBe(404);
    for (const path of [`/api/runs/${runId}`, `/api/runs/${runId}/events`]) {
      expect((await app.request(path, { headers: { cookie: stranger } })).status).toBe(404);
    }
    expect(
      (await app.request(`/api/runs/${runId}`, { method: 'DELETE', headers: { cookie: stranger } }))
        .status,
    ).toBe(404);
    expect((await startRun(app, owner, 'brief_does_not_exist')).status).toBe(404);
  });

  it('cancels a running search and reports it as cancelled', async () => {
    const { catalog, state } = hangingCatalog();
    const app = createApp(S2, { catalog });
    const cookie = await session(app);
    const brief = await confirmedBrief(app, cookie, c);
    const { runId } = (await (await startRun(app, cookie, brief.id)).json()) as { runId: string };
    await tick();
    expect(state.searches).toBeGreaterThan(0);
    const cancel = await app.request(`/api/runs/${runId}`, {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(cancel.status).toBe(200);
    const events = parseSse(
      await (await app.request(`/api/runs/${runId}/events`, { headers: { cookie } })).text(),
    );
    const final = events.at(-1)!.data as CollectionRunEvent;
    expect(final.type === 'result' && final.result.status).toBe('cancelled');
    expect(state.aborted).toBe(state.searches);
  });

  it('supersedes a running search when the brief is edited and never sends its result', async () => {
    const { catalog } = hangingCatalog();
    const app = createApp(S2, { catalog });
    const cookie = await session(app);
    const brief = await confirmedBrief(app, cookie, c);
    const { runId } = (await (await startRun(app, cookie, brief.id)).json()) as { runId: string };
    await tick();

    await patchBrief(app, cookie, brief, 'confirmed', {
      [c.slot]: [c.constraint],
    });
    const events = parseSse(
      await (await app.request(`/api/runs/${runId}/events`, { headers: { cookie } })).text(),
    );
    expect(events.some((event) => event.event === 'result')).toBe(false);
    expect(events.at(-1)).toMatchObject({ event: 'closed', data: { reason: 'superseded' } });
    const state = await (await app.request(`/api/runs/${runId}`, { headers: { cookie } })).json();
    expect(state).toMatchObject({ status: 'superseded', result: null });
  });

  it('stops serving a finished result once the brief has a newer revision', async () => {
    const app = createApp(S2);
    const cookie = await session(app);
    const brief = await confirmedBrief(app, cookie, c);
    const { runId } = (await (await startRun(app, cookie, brief.id)).json()) as { runId: string };
    await (await app.request(`/api/runs/${runId}/events`, { headers: { cookie } })).text();
    expect(
      await (await app.request(`/api/runs/${runId}`, { headers: { cookie } })).json(),
    ).toMatchObject({
      status: 'ready',
    });

    await patchBrief(app, cookie, brief, 'confirmed', { [c.slot]: [c.constraint] });

    expect(
      await (await app.request(`/api/runs/${runId}`, { headers: { cookie } })).json(),
    ).toMatchObject({
      status: 'superseded',
      result: null,
    });
    const replay = parseSse(
      await (
        await app.request(`/api/runs/${runId}/events`, {
          headers: { cookie, 'Last-Event-ID': '0' },
        })
      ).text(),
    );
    expect(replay.some((event) => event.event === 'result')).toBe(false);
    expect(replay.at(-1)).toMatchObject({ event: 'closed', data: { reason: 'superseded' } });
  });

  it('deleting the session cancels runs and purges derived checkpoints', async () => {
    const providers = defaultProviders(S2);
    const app = createApp(S2, providers);
    const cookie = await session(app);
    const brief = await confirmedBrief(app, cookie, c);
    const { runId } = (await (await startRun(app, cookie, brief.id)).json()) as { runId: string };
    await (await app.request(`/api/runs/${runId}/events`, { headers: { cookie } })).text();
    expect(providers.checkpoints.keys().length).toBeGreaterThan(0);

    await app.request('/api/session', { method: 'DELETE', headers: { cookie } });
    expect(providers.checkpoints.keys()).toEqual([]);
    expect((await app.request(`/api/runs/${runId}`, { headers: { cookie } })).status).toBe(404);
  });

  it('keeps provider failure text out of the event stream', async () => {
    const app = createApp(S2, {
      matcher: {
        async match() {
          throw new Error(SECRET);
        },
      },
    });
    const cookie = await session(app);
    const brief = await confirmedBrief(app, cookie, c);
    const { runId } = (await (await startRun(app, cookie, brief.id)).json()) as { runId: string };
    const text = await (
      await app.request(`/api/runs/${runId}/events`, { headers: { cookie } })
    ).text();
    expect(text).not.toContain(SECRET);
    expect(parseSse(text).at(-1)!.event).toBe('result');
  });
});

describe('match routes are always available', () => {
  it('starts matching even with an obsolete S1-only setting', async () => {
    const app = createApp({ MILESTONES: 's1' });
    const cookie = await session(app);
    const brief = await confirmedBrief(app, cookie, CASES[0]);
    expect((await startRun(app, cookie, brief.id)).status).toBe(202);
    expect((await app.request('/api/runs/run_x', { headers: { cookie } })).status).toBe(404);
  });
});
