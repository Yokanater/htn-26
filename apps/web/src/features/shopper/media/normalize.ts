/** Client image normalize for shopper media. Owner: L1 (S1-L1-1 A2). Design §5.1.
 * Re-encoding discards embedded metadata. Server still validates signatures/dimensions.
 */

import type { AllowedImageMimeType } from './validation';
import { ALLOWED_IMAGE_MIME_TYPES } from './validation';

export const MEDIA_MAX_LONG_EDGE_PX = 1600;

export type ImageBitmapLike = {
  width: number;
  height: number;
  close?: () => void;
};

export type CanvasLike = {
  width: number;
  height: number;
  getContext: (type: '2d') => {
    drawImage: (image: ImageBitmapLike, dx: number, dy: number, dw: number, dh: number) => void;
  } | null;
  toBlob: (callback: (blob: Blob | null) => void, type?: string, quality?: number) => void;
};

export type MediaNormalizeBrowser = {
  createImageBitmap: (blob: Blob) => Promise<ImageBitmapLike>;
  createCanvas: (width: number, height: number) => CanvasLike;
};

export type NormalizeMediaResult = {
  blob: Blob;
  mimeType: AllowedImageMimeType;
  width: number;
  height: number;
  file: File;
};

export type NormalizeMediaError = {
  code: 'decode_failed' | 'encode_failed' | 'unsupported_output';
  message: string;
};

const DEFAULT_OUTPUT: AllowedImageMimeType = 'image/jpeg';

function defaultBrowser(): MediaNormalizeBrowser {
  return {
    createImageBitmap: (blob) => createImageBitmap(blob),
    createCanvas: (width, height) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas as unknown as CanvasLike;
    },
  };
}

export function targetDimensions(
  width: number,
  height: number,
  maxLongEdge = MEDIA_MAX_LONG_EDGE_PX,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) {
    return { width, height };
  }
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function resolveOutputMime(preferred: string | undefined): AllowedImageMimeType {
  const candidate = (preferred ?? DEFAULT_OUTPUT).toLowerCase();
  if ((ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(candidate)) {
    return candidate as AllowedImageMimeType;
  }
  return DEFAULT_OUTPUT;
}

function canvasToBlob(canvas: CanvasLike, mimeType: AllowedImageMimeType): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('encode_failed'));
            return;
          }
          resolve(blob);
        },
        mimeType,
        mimeType === 'image/jpeg' ? 0.92 : undefined,
      );
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Decode → optional downscale → re-encode. Never upscales.
 * Pass an AbortSignal-friendly generation token via the caller (stale guard lives in the UI).
 */
export async function normalizeMediaFile(
  file: File,
  options?: {
    browser?: MediaNormalizeBrowser;
    outputMimeType?: AllowedImageMimeType;
  },
): Promise<NormalizeMediaResult> {
  const browser = options?.browser ?? defaultBrowser();
  const outputMime = resolveOutputMime(options?.outputMimeType ?? file.type);

  let bitmap: ImageBitmapLike | undefined;
  try {
    bitmap = await browser.createImageBitmap(file);
  } catch {
    const err: NormalizeMediaError = {
      code: 'decode_failed',
      message: 'Could not read that image. Choose a different JPEG, PNG, or WebP file.',
    };
    throw Object.assign(new Error(err.message), err);
  }

  try {
    const { width, height } = targetDimensions(bitmap.width, bitmap.height);
    const canvas = browser.createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      const err: NormalizeMediaError = {
        code: 'encode_failed',
        message: 'Could not prepare the image for upload. Try again.',
      };
      throw Object.assign(new Error(err.message), err);
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    let blob: Blob;
    try {
      blob = await canvasToBlob(canvas, outputMime);
    } catch {
      const err: NormalizeMediaError = {
        code: 'encode_failed',
        message: 'Could not re-encode the image. Try a different file.',
      };
      throw Object.assign(new Error(err.message), err);
    }

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'inspiration';
    const extension =
      outputMime === 'image/png' ? 'png' : outputMime === 'image/webp' ? 'webp' : 'jpg';
    let normalized: File;
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      normalized = new File([bytes], `${baseName}.${extension}`, {
        type: outputMime,
        lastModified: Date.now(),
      });
    } catch {
      const err: NormalizeMediaError = {
        code: 'encode_failed',
        message: 'Could not re-encode the image. Try a different file.',
      };
      throw Object.assign(new Error(err.message), err);
    }

    return {
      blob,
      mimeType: outputMime,
      width,
      height,
      file: normalized,
    };
  } finally {
    bitmap?.close?.();
  }
}
