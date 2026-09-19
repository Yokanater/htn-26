import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { DEFAULT_PORT, serverPort } from '../src/env';

describe('health routes', () => {
  it.each(['/healthz', '/api/healthz'])('GET %s → { ok: true }', async (path) => {
    const res = await createApp().request(path);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('unknown routes 404', async () => {
    const res = await createApp().request('/nope');
    expect(res.status).toBe(404);
  });
});

describe('serverPort', () => {
  it('defaults to 8787 and reads PORT', () => {
    expect(serverPort({})).toBe(DEFAULT_PORT);
    expect(serverPort({ PORT: '' })).toBe(DEFAULT_PORT);
    expect(serverPort({ PORT: '9000' })).toBe(9000);
  });

  it('rejects garbage', () => {
    expect(() => serverPort({ PORT: 'abc' })).toThrow(/PORT="abc"/);
  });
});
