import { describe, expect, it } from 'vitest';
import { MEDIA_MAX_BYTES, reportedImageMimeType, validateMediaFile } from './validation';

function makeFile(name: string, type: string, size = 1024): File {
  const buffer = new Uint8Array(Math.max(size, 1));
  return new File([buffer], name, { type });
}

describe('validateMediaFile', () => {
  it.each([
    ['photo.jpg', 'image/jpeg', 'image/jpeg'],
    ['photo.jpeg', 'image/jpeg', 'image/jpeg'],
    ['photo.png', 'image/png', 'image/png'],
    ['photo.webp', 'image/webp', 'image/webp'],
    ['shot.JPEG', 'image/jpeg', 'image/jpeg'],
  ] as const)('accepts %s with %s', (name, type, expectedMime) => {
    const result = validateMediaFile(makeFile(name, type));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reportedMimeType).toBe(expectedMime);
  });

  it.each([
    ['payload.svg', 'image/jpeg'],
    ['payload.svg', 'image/png'],
    ['payload.svg', 'image/webp'],
    ['icon.svg', 'image/svg+xml'],
  ] as const)('rejects SVG named %s declared as %s', (name, type) => {
    const result = validateMediaFile(makeFile(name, type));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('svg_rejected');
  });

  it('rejects unsupported declared MIME even with an allowed extension', () => {
    const result = validateMediaFile(makeFile('payload.jpg', 'application/pdf'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsupported_type');
  });

  it.each([
    ['payload.png', 'image/jpeg'],
    ['payload.jpg', 'image/png'],
    ['payload.webp', 'image/jpeg'],
  ] as const)('rejects mismatched pair %s / %s', (name, type) => {
    const result = validateMediaFile(makeFile(name, type));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsupported_type');
  });

  it('uses allowed extension as fallback when File.type is empty', () => {
    expect(reportedImageMimeType(makeFile('shot.JPEG', ''))).toBe('image/jpeg');
    expect(validateMediaFile(makeFile('shot.png', '')).ok).toBe(true);
    expect(validateMediaFile(makeFile('shot.webp', '')).ok).toBe(true);
  });

  it('rejects empty MIME with .svg', () => {
    const result = validateMediaFile(makeFile('icon.svg', ''));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('svg_rejected');
  });

  it('rejects unsupported types', () => {
    const gif = validateMediaFile(makeFile('anim.gif', 'image/gif'));
    expect(gif.ok).toBe(false);
    if (!gif.ok) expect(gif.code).toBe('unsupported_type');
  });

  it('rejects files larger than 8 MiB', () => {
    const big = validateMediaFile(makeFile('big.jpg', 'image/jpeg', MEDIA_MAX_BYTES + 1));
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.code).toBe('file_too_large');
  });

  it('accepts exactly 8 MiB', () => {
    expect(validateMediaFile(makeFile('ok.jpg', 'image/jpeg', MEDIA_MAX_BYTES)).ok).toBe(true);
  });

  it('rejects a missing file', () => {
    const result = validateMediaFile(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('missing_file');
  });
});
