/**
 * Dependency-free container sanitizer for private uploads. Owner: L4 (S1-L4-1).
 *
 * This is NOT a pixel decoder: no image library is installed and dependencies are human-only, so
 * pixels are never decoded or re-encoded (a vision provider decodes them later). What it does:
 * verifies the signature matches the declared type, walks the container structure and checksums,
 * enforces edge and pixel limits from the headers, rejects animation, rebuilds the file from an
 * allowlist of chunks/segments (dropping EXIF, XMP, ICC, text and comments) and discards any bytes
 * after the end marker. The browser already re-encodes; this covers a client that bypasses it.
 * A real decoder can replace it behind the same `ImageNormalizer` seam.
 */
import { crc32 } from 'node:zlib';
import { ASSET_MAX_BYTES, type ImageNormalizer, type NormalizedImage } from './intake';

export const IMAGE_MAX_EDGE_PX = 4096;
export const IMAGE_MAX_PIXELS = 16_000_000;

/** Carries only a fixed reason: never file content. */
export class ImageRejectedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ImageRejectedError';
  }
}

const reject = (reason: string): never => {
  throw new ImageRejectedError(reason);
};

function checkDimensions(width: number, height: number): void {
  if (!(width > 0 && height > 0)) reject('image has no area');
  if (width > IMAGE_MAX_EDGE_PX || height > IMAGE_MAX_EDGE_PX) reject('image edge too long');
  if (width * height > IMAGE_MAX_PIXELS) reject('image has too many pixels');
}

// --- PNG ---------------------------------------------------------------------------------------
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Everything else (tEXt, iTXt, zTXt, eXIf, iCCP, tIME, pHYs, APNG frames) is dropped. */
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);

function sanitizePng(input: Buffer): Buffer {
  const kept: Buffer[] = [PNG_SIGNATURE];
  let offset = PNG_SIGNATURE.length;
  let sawHeader = false;
  let sawData = false;
  let sawEnd = false;
  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset);
    const type = input.toString('latin1', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (length > 0x7fffffff || end > input.length) reject('truncated PNG chunk');
    if (crc32(input.subarray(offset + 4, offset + 8 + length)) !== input.readUInt32BE(end - 4)) {
      reject('PNG chunk checksum mismatch');
    }
    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) reject('PNG must start with IHDR');
      checkDimensions(input.readUInt32BE(offset + 8), input.readUInt32BE(offset + 12));
      sawHeader = true;
    }
    if (type === 'IDAT') sawData = true;
    if (PNG_KEEP.has(type)) kept.push(input.subarray(offset, end));
    offset = end;
    if (type === 'IEND') {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd || !sawData) reject('PNG is incomplete');
  return Buffer.concat(kept);
}

// --- JPEG --------------------------------------------------------------------------------------
const isFrameMarker = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

function sanitizeJpeg(input: Buffer): Buffer {
  const kept: Buffer[] = [input.subarray(0, 2)];
  let offset = 2;
  let sawFrame = false;
  let sawScan = false;
  let sawEnd = false;
  while (offset < input.length) {
    if (input[offset] !== 0xff) reject('expected a JPEG marker');
    while (input[offset + 1] === 0xff) offset++; // fill bytes
    const marker = input[offset + 1];
    if (marker === undefined) reject('truncated JPEG marker');
    if (marker === 0xd9) {
      kept.push(Buffer.from([0xff, 0xd9]));
      sawEnd = true;
      break;
    }
    // Standalone markers cannot appear between segments.
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      reject('unexpected JPEG marker');
    }
    if (offset + 4 > input.length) reject('truncated JPEG segment');
    const length = input.readUInt16BE(offset + 2);
    const end = offset + 2 + length;
    if (length < 2 || end > input.length) reject('bad JPEG segment length');
    const segment = input.subarray(offset, end);
    if (isFrameMarker(marker as number)) {
      if (sawFrame || length < 8) reject('bad JPEG frame header');
      checkDimensions(input.readUInt16BE(offset + 7), input.readUInt16BE(offset + 5));
      sawFrame = true;
    }
    const isMetadata =
      ((marker as number) >= 0xe0 && (marker as number) <= 0xef) || marker === 0xfe;
    // APP14 "Adobe" changes colour interpretation, so it is the one application segment kept.
    const isAdobe = marker === 0xee && segment.toString('latin1', 4, 9) === 'Adobe';
    if (!isMetadata || isAdobe) kept.push(segment);
    offset = end;
    if (marker === 0xda) {
      if (!sawFrame) reject('JPEG scan before frame');
      sawScan = true;
      const start = offset;
      while (offset < input.length) {
        if (input[offset] === 0xff) {
          const next = input[offset + 1];
          if (next === undefined) reject('truncated JPEG scan');
          if (next === 0x00 || (next !== undefined && next >= 0xd0 && next <= 0xd7)) {
            offset += 2;
            continue;
          }
          if (next === 0xff) {
            offset += 1;
            continue;
          }
          break;
        }
        offset += 1;
      }
      kept.push(input.subarray(start, offset));
    }
  }
  if (!sawEnd || !sawFrame || !sawScan) reject('JPEG is incomplete');
  return Buffer.concat(kept);
}

// --- WebP --------------------------------------------------------------------------------------
const WEBP_VP8X_ICC = 0x20;
const WEBP_VP8X_EXIF = 0x08;
const WEBP_VP8X_XMP = 0x04;
const WEBP_VP8X_ANIMATION = 0x02;

function webpChunk(fourcc: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(fourcc, 0, 'latin1');
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, Buffer.alloc(data.length % 2)]);
}

function sanitizeWebp(input: Buffer): Buffer {
  if (input.length < 20) reject('truncated WebP');
  const end = input.readUInt32LE(4) + 8;
  if (end < 20 || end > input.length) reject('truncated WebP');
  const kept: Buffer[] = [];
  let sawImage = false;
  let offset = 12;
  while (offset + 8 <= end) {
    const fourcc = input.toString('latin1', offset, offset + 4);
    const size = input.readUInt32LE(offset + 4);
    const dataEnd = offset + 8 + size;
    if (dataEnd > end) reject('truncated WebP chunk');
    const data = input.subarray(offset + 8, dataEnd);
    switch (fourcc) {
      case 'VP8X': {
        if (kept.length > 0 || size < 10) reject('bad WebP extended header');
        const flags = data.readUInt8(0);
        if (flags & WEBP_VP8X_ANIMATION) reject('animated WebP is not supported');
        checkDimensions(1 + data.readUIntLE(4, 3), 1 + data.readUIntLE(7, 3));
        const header = Buffer.from(data);
        header[0] = flags & ~(WEBP_VP8X_ICC | WEBP_VP8X_EXIF | WEBP_VP8X_XMP);
        kept.push(webpChunk(fourcc, header));
        break;
      }
      case 'VP8 ': {
        if (size < 10 || data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) {
          reject('bad WebP lossy header');
        }
        checkDimensions(data.readUInt16LE(6) & 0x3fff, data.readUInt16LE(8) & 0x3fff);
        sawImage = true;
        kept.push(webpChunk(fourcc, data));
        break;
      }
      case 'VP8L': {
        if (size < 5 || data[0] !== 0x2f) reject('bad WebP lossless header');
        const bits = data.readUInt32LE(1);
        checkDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
        sawImage = true;
        kept.push(webpChunk(fourcc, data));
        break;
      }
      case 'ALPH':
        kept.push(webpChunk(fourcc, data));
        break;
      case 'ANIM':
      case 'ANMF':
        reject('animated WebP is not supported');
        break;
      default: // ICCP, EXIF, XMP and unknown chunks are dropped
        break;
    }
    offset = dataEnd + (size % 2);
  }
  if (!sawImage) reject('WebP has no image data');
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...kept]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

// -----------------------------------------------------------------------------------------------
function sniff(bytes: Buffer): NormalizedImage['mimeType'] | null {
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

const SANITIZERS: Record<NormalizedImage['mimeType'], (input: Buffer) => Buffer> = {
  'image/png': sanitizePng,
  'image/jpeg': sanitizeJpeg,
  'image/webp': sanitizeWebp,
};

export class ContainerImageNormalizer implements ImageNormalizer {
  async normalize(input: Uint8Array, declaredMimeType: string): Promise<NormalizedImage> {
    const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    const mimeType = sniff(bytes);
    if (!mimeType || mimeType !== declaredMimeType) reject('image type does not match its content');
    const sanitized = SANITIZERS[mimeType as NormalizedImage['mimeType']](bytes);
    if (sanitized.byteLength > ASSET_MAX_BYTES) reject('image too large');
    return { bytes: new Uint8Array(sanitized), mimeType: mimeType as NormalizedImage['mimeType'] };
  }
}
