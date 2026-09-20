import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ launch: vi.fn(), debug: vi.fn() }));
vi.mock('@browserbasehq/stagehand', () => ({ browserbase: { launch: mocks.launch } }));
vi.mock('@browserbasehq/sdk', () => ({
  default: class {
    sessions = { debug: mocks.debug };
  },
}));

import { createMerchantBrowser } from '../src/merchant/browserbase';

beforeEach(() => vi.resetAllMocks());
function setup() {
  const page = {
    waitForSelector: vi.fn(async () => true),
    goto: vi.fn(),
    url: vi.fn(async () => 'https://store.example/collections/all'),
    evaluate: vi.fn(async () => ({
      text: 'Products',
      links: [
        'https://store.example/products/top?variant=1',
        'https://evil.example/products/bad',
        'https://store.example/products/top',
      ],
    })),
  };
  const browser = {
    sessionId: 'test',
    close: vi.fn(async () => {}),
    context: { setDomainPolicy: vi.fn(), pages: vi.fn(async () => [page]) },
  };
  mocks.launch.mockResolvedValue(browser);
  mocks.debug.mockResolvedValue({ debuggerFullscreenUrl: 'https://www.browserbase.com/live/test' });
  const capture = createMerchantBrowser({
    apiKey: 'test',
    projectId: 'test',
    lookup: async (host) => [{ address: host === 'localhost' ? '127.0.0.1' : '93.184.216.34' }],
  });
  return { page, browser, capture };
}
it('installs network policy before navigating, scopes links and releases the session', async () => {
  const { page, browser, capture } = setup();
  const liveView = vi.fn();
  const result = await capture({
    url: 'https://store.example',
    signal: new AbortController().signal,
    liveView,
  });
  expect(browser.context.setDomainPolicy.mock.invocationCallOrder[0]).toBeLessThan(
    page.goto.mock.invocationCallOrder[0],
  );
  expect(result.productUrls).toEqual(['https://store.example/products/top']);
  expect(liveView).toHaveBeenCalledWith('https://www.browserbase.com/live/test?readOnly=true');
  expect(liveView).toHaveBeenLastCalledWith(null);
  expect(browser.close).toHaveBeenCalledOnce();
});
it('rejects private input before opening a session and closes on navigation failure', async () => {
  const { page, browser, capture } = setup();
  await expect(
    capture({ url: 'https://localhost', signal: new AbortController().signal, liveView: vi.fn() }),
  ).rejects.toThrow();
  expect(mocks.launch).not.toHaveBeenCalled();
  page.goto.mockRejectedValue(new Error('navigation failed'));
  await expect(
    capture({
      url: 'https://store.example',
      signal: new AbortController().signal,
      liveView: vi.fn(),
    }),
  ).rejects.toThrow();
  expect(browser.close).toHaveBeenCalledOnce();
});
it('releases a session that arrives after cancellation and never navigates it', async () => {
  const { page, browser, capture } = setup();
  const controller = new AbortController();
  mocks.launch.mockImplementation(async () => {
    controller.abort();
    return browser;
  });
  await expect(
    capture({ url: 'https://store.example', signal: controller.signal, liveView: vi.fn() }),
  ).rejects.toThrow();
  expect(browser.close).toHaveBeenCalledOnce();
  expect(page.goto).not.toHaveBeenCalled();
});
