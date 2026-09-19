import { describe, expect, it, vi } from 'vitest';
import {
  assertPublicHttpsUrl,
  fetchPublicHttps,
  isBlockedIp,
  UrlSafetyError,
} from '../src/url-safety';

describe('url safety', () => {
  it('rejects HTTP and credentialed URLs', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34' }]);
    await expect(assertPublicHttpsUrl('http://example.com', lookup)).rejects.toMatchObject({
      code: 'https_required',
    });
    await expect(
      assertPublicHttpsUrl('https://user:pass@example.com/x', lookup),
    ).rejects.toMatchObject({ code: 'credentials_forbidden' });
  });

  it('rejects loopback/private targets and accepts public HTTPS', async () => {
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('10.0.0.1')).toBe(true);
    expect(isBlockedIp('192.168.1.1')).toBe(true);
    expect(isBlockedIp('93.184.216.34')).toBe(false);

    const lookup = vi.fn(async () => [{ address: '93.184.216.34' }]);
    const url = await assertPublicHttpsUrl('https://example.com/products/1', lookup);
    expect(url.hostname).toBe('example.com');
  });

  it('rejects a safe URL that redirects to a private address', async () => {
    const lookup = vi.fn(async (hostname: string) => {
      if (hostname === 'safe.example') return [{ address: '93.184.216.34' }];
      return [{ address: '127.0.0.1' }];
    });
    const fetchImpl = vi.fn(async () => {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://evil.example/private' },
      });
    });
    await expect(
      fetchPublicHttps('https://safe.example/start', {
        fetch: fetchImpl as unknown as typeof fetch,
        lookup,
      }),
    ).rejects.toBeInstanceOf(UrlSafetyError);
  });

  it('rejects redirect loops / excess redirects', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34' }]);
    const fetchImpl = vi.fn(async () => {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://example.com/next' },
      });
    });
    await expect(
      fetchPublicHttps(
        'https://example.com/start',
        { fetch: fetchImpl as unknown as typeof fetch, lookup },
        { maxRedirects: 1 },
      ),
    ).rejects.toMatchObject({ code: 'redirect_limit' });
  });

  it('aborts oversized streamed bodies and respects AbortSignal', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34' }]);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(100));
        controller.enqueue(new Uint8Array(100));
        controller.close();
      },
    });
    const fetchImpl = vi.fn(async () => {
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    await expect(
      fetchPublicHttps(
        'https://example.com/big',
        { fetch: fetchImpl as unknown as typeof fetch, lookup },
        { maxBytes: 150, acceptContentTypes: ['application/json'] },
      ),
    ).rejects.toMatchObject({ code: 'body_too_large' });

    const controller = new AbortController();
    controller.abort(new Error('nope'));
    await expect(
      fetchPublicHttps(
        'https://example.com/x',
        {
          fetch: vi.fn() as unknown as typeof fetch,
          lookup,
        },
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
  });

  it('handles unsupported content types', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34' }]);
    const fetchImpl = vi.fn(async () => {
      return new Response('hi', {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      });
    });
    await expect(
      fetchPublicHttps(
        'https://example.com/bin',
        { fetch: fetchImpl as unknown as typeof fetch, lookup },
        { acceptContentTypes: ['application/json'] },
      ),
    ).rejects.toMatchObject({ code: 'content_type' });
  });
});
