import { describe, expect, it } from 'vitest';
import { SipsImageNormalizer } from '../src/services/image-normalizer';

describe.skipIf(process.platform !== 'darwin')('native image normalization', () => {
  it('decodes a PNG and emits only rendering chunks', async () => {
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
      'base64',
    );
    const result = await new SipsImageNormalizer().normalize(bytes, 'image/png');
    expect(result.mimeType).toBe('image/png');
    expect(result.bytes.subarray(1, 4).toString()).toBe('PNG');
    for (let offset = 8; offset < result.bytes.length; ) {
      expect(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS']).toContain(
        result.bytes.toString('ascii', offset + 4, offset + 8),
      );
      offset += 12 + result.bytes.readUInt32BE(offset);
    }
  });
  it('rejects fake image bytes', async () => {
    await expect(
      new SipsImageNormalizer().normalize(Buffer.from('not an image'), 'image/png'),
    ).rejects.toThrow();
  });
});
