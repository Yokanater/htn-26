import type { ShoppingContext } from '@sei/core';
import { describe, expect, it, vi } from 'vitest';
import { createFakeBrowserSessionFactory, verifyProductWithBrowser } from '../src/browser-verify';

function context(consume = vi.fn()): ShoppingContext {
  return {
    signal: new AbortController().signal,
    sampleOrigin: 'live',
    consume,
  };
}

describe('verifyProductWithBrowser', () => {
  it('releases the session after success and consumes budget', async () => {
    const release = vi.fn(async () => undefined);
    const createSession = vi.fn(async () => {
      const factory = createFakeBrowserSessionFactory(async () => ({
        title: 'Product',
        text: 'A real product page',
        finalUrl: 'https://shop.example/products/1',
      }));
      const session = await factory({
        allowedDomains: ['shop.example'],
        signal: new AbortController().signal,
        timeoutMs: 1000,
      });
      return { ...session, release };
    });
    const lookup = vi.fn(async () => [{ address: '93.184.216.34' }]);
    const consume = vi.fn();
    const result = await verifyProductWithBrowser(
      'https://shop.example/products/1',
      context(consume),
      { createSession, lookup },
    );
    expect(result.title).toBe('Product');
    expect(result.evidence.every((e) => e.method === 'browser')).toBe(true);
    expect(release).toHaveBeenCalled();
    expect(consume).toHaveBeenCalledWith('browser_session', 1);
  });

  it('releases the session after navigation failure', async () => {
    const release = vi.fn(async () => undefined);
    const createSession = vi.fn(async () => ({
      sessionId: 'bb_fail',
      page: {
        goto: async () => {
          throw new Error('navigation failed');
        },
        url: () => 'https://shop.example/products/1',
        title: async () => '',
        innerText: async () => '',
      },
      release,
    }));
    const lookup = vi.fn(async () => [{ address: '93.184.216.34' }]);
    await expect(
      verifyProductWithBrowser('https://shop.example/products/1', context(), {
        createSession,
        lookup,
      }),
    ).rejects.toThrow(/navigation failed/);
    expect(release).toHaveBeenCalled();
  });

  it('does not create a browser client after prior abort', async () => {
    const controller = new AbortController();
    controller.abort();
    const createSession = vi.fn();
    await expect(
      verifyProductWithBrowser(
        'https://shop.example/products/1',
        { signal: controller.signal, sampleOrigin: 'live', consume: vi.fn() },
        {
          createSession,
          lookup: vi.fn(async () => [{ address: '93.184.216.34' }]),
        },
      ),
    ).rejects.toThrow(/cancelled/i);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('blocks unsafe redirect hosts', async () => {
    const release = vi.fn(async () => undefined);
    const createSession = vi.fn(async () => ({
      sessionId: 'bb_redir',
      page: {
        goto: async () => undefined,
        url: () => 'https://evil.example/phish',
        title: async () => 'x',
        innerText: async () => 'y',
      },
      release,
    }));
    const lookup = vi.fn(async (hostname: string) => {
      if (hostname === 'shop.example') return [{ address: '93.184.216.34' }];
      return [{ address: '93.184.216.35' }];
    });
    await expect(
      verifyProductWithBrowser('https://shop.example/products/1', context(), {
        createSession,
        lookup,
      }),
    ).rejects.toThrow(/allowed product host/i);
    expect(release).toHaveBeenCalled();
  });
});
