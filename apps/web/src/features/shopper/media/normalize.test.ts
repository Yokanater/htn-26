import { describe, expect, it, vi } from 'vitest';
import { type MediaNormalizeBrowser, normalizeMediaFile, targetDimensions } from './normalize';

function makeFile(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type });
}

function browserWithSize(
  width: number,
  height: number,
  options?: { failDecode?: boolean; failEncode?: boolean },
): MediaNormalizeBrowser {
  const close = vi.fn();
  return {
    createImageBitmap: vi.fn(async () => {
      if (options?.failDecode) throw new Error('decode');
      return { width, height, close };
    }),
    createCanvas: (w, h) => ({
      width: w,
      height: h,
      getContext: () => ({
        drawImage: vi.fn(),
      }),
      toBlob: (cb, type) => {
        if (options?.failEncode) {
          cb(null);
          return;
        }
        cb(new Blob([new Uint8Array([9, 9])], { type: type ?? 'image/jpeg' }));
      },
    }),
  };
}

describe('targetDimensions', () => {
  it('does not resize below the long-edge limit', () => {
    expect(targetDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('scales proportionally above 1600 px and never upscales', () => {
    expect(targetDimensions(3200, 1600)).toEqual({ width: 1600, height: 800 });
    expect(targetDimensions(100, 50, 1600)).toEqual({ width: 100, height: 50 });
  });
});

describe('normalizeMediaFile', () => {
  it('re-encodes to an allowed MIME and releases the bitmap', async () => {
    const close = vi.fn();
    const browser = browserWithSize(640, 480);
    browser.createImageBitmap = vi.fn(async () => ({ width: 640, height: 480, close }));
    const result = await normalizeMediaFile(makeFile('shot.png', 'image/png'), {
      browser,
      outputMimeType: 'image/jpeg',
    });
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.file.type).toBe('image/jpeg');
    expect(result.width).toBe(640);
    expect(close).toHaveBeenCalled();
  });

  it('resizes when the longest edge exceeds 1600 px', async () => {
    const result = await normalizeMediaFile(makeFile('wide.jpg', 'image/jpeg'), {
      browser: browserWithSize(3200, 800),
    });
    expect(result.width).toBe(1600);
    expect(result.height).toBe(400);
  });

  it('surfaces decode failures', async () => {
    await expect(
      normalizeMediaFile(makeFile('x.jpg', 'image/jpeg'), {
        browser: browserWithSize(1, 1, { failDecode: true }),
      }),
    ).rejects.toMatchObject({ code: 'decode_failed' });
  });
});
