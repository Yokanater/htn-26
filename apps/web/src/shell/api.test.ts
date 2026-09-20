import { afterEach, describe, expect, it, vi } from 'vitest';
import { json } from './api';

afterEach(() => vi.unstubAllGlobals());
const unauthorized = () =>
  Response.json(
    { error: { code: 'UNAUTHORIZED', message: 'Start a private session first.' } },
    { status: 401 },
  );

describe('private session recovery', () => {
  it('waits for initial session setup before profiling', async () => {
    let ready!: () => void;
    const pending = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const fetch = vi.fn(async (path: RequestInfo | URL) => {
      if (path === '/api/session') {
        await pending;
        return Response.json({ owner: true });
      }
      return Response.json({ id: 'run_test' });
    });
    vi.stubGlobal('fetch', fetch);
    const setup = json('/api/session');
    const profile = json('/api/merchants/profile', { method: 'POST', body: '{}' });
    expect(fetch).toHaveBeenCalledTimes(1);
    ready();
    await setup;
    await expect(profile).resolves.toEqual({ id: 'run_test' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('recovers an expired cookie once for concurrent merchant requests', async () => {
    let valid = false;
    const fetch = vi.fn(async (path: RequestInfo | URL) => {
      if (path === '/api/session') {
        valid = true;
        return Response.json({ owner: true });
      }
      return valid ? Response.json({ ok: true }) : unauthorized();
    });
    vi.stubGlobal('fetch', fetch);
    await Promise.all([
      json('/api/merchants/settings'),
      json('/api/merchants/profile', { method: 'POST', body: '{"domain":"outfit"}' }),
    ]);
    expect(fetch.mock.calls.filter(([path]) => path === '/api/session')).toHaveLength(1);
    expect(fetch.mock.calls.filter(([path]) => path === '/api/merchants/profile')).toHaveLength(2);
  });
  it('stops if cookies remain unavailable rather than retrying indefinitely', async () => {
    const fetch = vi.fn(async (path: RequestInfo | URL) =>
      path === '/api/session' ? Response.json({ owner: true }) : unauthorized(),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(
      json('/api/merchants/profile', { method: 'POST', body: '{}' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it.each([403, 500])(
    'never retries a %s write or creates a new session for it',
    async (status) => {
      const fetch = vi.fn(async () =>
        Response.json({ error: { code: 'FAILED', message: 'Failed' } }, { status }),
      );
      vi.stubGlobal('fetch', fetch);
      await expect(json('/api/merchants/profile', { method: 'POST', body: '{}' })).rejects.toThrow(
        'Failed',
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
});
