import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ImageNormalizer } from './intake';

const exec = promisify(execFile);
/** Local macOS decoder. Decode into fresh pixels and retain only PNG rendering chunks. */
export class SipsImageNormalizer implements ImageNormalizer {
  async normalize(bytes: Uint8Array, declared: string) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(declared))
      throw new Error('Unsupported image');
    const dir = await mkdtemp(join(tmpdir(), 'intent-image-'));
    try {
      const input = join(dir, 'input');
      const output = join(dir, 'normalized.png');
      await writeFile(input, bytes, { mode: 0o600 });
      const { stdout } = await exec(
        '/usr/bin/sips',
        ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'format', input],
        { timeout: 10000 },
      );
      const width = Number(stdout.match(/pixelWidth: (\d+)/)?.[1]);
      const height = Number(stdout.match(/pixelHeight: (\d+)/)?.[1]);
      const format = stdout.match(/format: (\w+)/)?.[1];
      if (
        !width ||
        !height ||
        width * height > 40_000_000 ||
        !['png', 'jpeg', 'webp'].includes(format ?? '')
      )
        throw new Error('Invalid image');
      await exec('/usr/bin/sips', ['-s', 'format', 'png', '-Z', '1600', input, '--out', output], {
        timeout: 15000,
      });
      const png = await readFile(output);
      const chunks: Buffer[] = [png.subarray(0, 8)];
      for (let offset = 8; offset < png.length; ) {
        const length = png.readUInt32BE(offset);
        const end = offset + 12 + length;
        if (end > png.length) throw new Error('Invalid normalized image');
        const type = png.toString('ascii', offset + 4, offset + 8);
        if (['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS'].includes(type))
          chunks.push(png.subarray(offset, end));
        offset = end;
      }
      return { bytes: Buffer.concat(chunks), mimeType: 'image/png' as const };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
