import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ launch: vi.fn(), debug: vi.fn(), create: vi.fn() }));
vi.mock('@browserbasehq/stagehand', () => ({
  browserbase: { launch: mocks.launch },
  Stagehand: { create: mocks.create },
}));
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
  let attached = false;
  const context = { setDomainPolicy: vi.fn(), pages: vi.fn(async () => [page]) };
  const browser = {
    sessionId: 'test',
    close: vi.fn(async () => {}),
    get context() {
      if (!attached)
        throw new Error(
          'Browser context is unavailable. Attach the browser with await Stagehand.create({ browser }).',
        );
      return context;
    },
  };
  mocks.create.mockImplementation(async ({ browser: handle }) => {
    expect(handle).toBe(browser);
    attached = true;
    return { context };
  });
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
  expect(mocks.create).toHaveBeenCalledOnce();
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

it('keeps localized collection and product paths and accepts a validated www redirect', async () => {
  const { page, capture } = setup();
  page.url.mockResolvedValue('https://www.store.example/en-ca/collections/all');
  page.evaluate.mockResolvedValue({
    text: 'Products',
    links: ['https://www.store.example/en-ca/products/top?variant=1'],
  });
  const result = await capture({
    url: 'https://store.example/en-ca',
    signal: new AbortController().signal,
    liveView: vi.fn(),
  });
  expect(page.goto).toHaveBeenCalledWith(
    'https://store.example/en-ca/collections/all',
    expect.anything(),
  );
  expect(result.productUrls).toEqual(['https://www.store.example/en-ca/products/top']);
});

it('falls back to the supplied storefront when the all-products collection has no links', async () => {
  const { page, capture } = setup();
  page.waitForSelector.mockRejectedValueOnce(new Error('selector timeout'));
  await capture({
    url: 'https://store.example',
    signal: new AbortController().signal,
    liveView: vi.fn(),
  });
  expect(page.goto).toHaveBeenNthCalledWith(2, 'https://store.example/', expect.anything());
});

it('identifies Browserbase access failures without exposing the provider body', async () => {
  const { capture } = setup();
  mocks.launch.mockRejectedValue(
    new Error('extension upload failed', { cause: { status: 403, message: 'secret-api-key' } }),
  );
  await expect(
    capture({
      url: 'https://store.example',
      signal: new AbortController().signal,
      liveView: vi.fn(),
    }),
  ).rejects.toMatchObject({
    code: 'BROWSERBASE_ACCESS',
    message: expect.not.stringContaining('secret-api-key'),
  });
});

it('retains a useful navigation diagnostic when browser cleanup also fails', async () => {
  const { page, browser, capture } = setup();
  page.goto.mockRejectedValue(new Error('navigation failed'));
  browser.close.mockRejectedValue(new Error('secret cleanup failure'));
  await expect(
    capture({
      url: 'https://store.example',
      signal: new AbortController().signal,
      liveView: vi.fn(),
    }),
  ).rejects.toMatchObject({ code: 'STOREFRONT_BROWSER' });
});
