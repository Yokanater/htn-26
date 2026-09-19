/** Client-side convenience checks for shopper media intake. Owner: L1 (S1-L1-1).
 * Browser File.type / filename extension are not proof of file signature.
 * L4 must validate MIME signature and dimensions on the server.
 *
 * Empty File.type fallback: an allowed extension (.jpg/.jpeg/.png/.webp) may supply
 * the reported MIME. SVG and unsupported extensions are still rejected.
 */

export const MEDIA_MAX_BYTES = 8 * 1024 * 1024;

export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

const ALLOWED_SET = new Set<string>(ALLOWED_IMAGE_MIME_TYPES);

/** Extension → MIME when File.type is empty (client convenience fallback only). */
const EXTENSION_MIME: Record<string, AllowedImageMimeType> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/** Declared MIME → allowed filename extensions (must agree when type is present). */
const MIME_EXTENSIONS: Record<AllowedImageMimeType, ReadonlySet<string>> = {
  'image/jpeg': new Set(['.jpg', '.jpeg']),
  'image/png': new Set(['.png']),
  'image/webp': new Set(['.webp']),
};

export type MediaValidationErrorCode =
  | 'unsupported_type'
  | 'svg_rejected'
  | 'file_too_large'
  | 'missing_file';

export type MediaValidationResult =
  | { ok: true; file: File; reportedMimeType: AllowedImageMimeType }
  | { ok: false; code: MediaValidationErrorCode; message: string };

export function mediaValidationMessage(code: MediaValidationErrorCode): string {
  switch (code) {
    case 'missing_file':
      return 'Choose one image file to continue.';
    case 'svg_rejected':
      return 'SVG images are not supported. Use a JPEG, PNG, or WebP file.';
    case 'unsupported_type':
      return 'Unsupported file type. Use a JPEG, PNG, or WebP image.';
    case 'file_too_large':
      return 'That image is larger than 8 MiB. Choose a smaller file.';
  }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return '';
  return name.slice(dot).toLowerCase();
}

function isSvgMime(type: string): boolean {
  return type === 'image/svg+xml' || type === 'image/svg';
}

type ResolvedMime =
  | { kind: 'ok'; mime: AllowedImageMimeType }
  | { kind: 'svg' }
  | { kind: 'unsupported' };

/**
 * Resolve a consistent reported MIME from File.type and filename extension.
 * Does not establish the real file signature.
 */
function resolveReportedMime(file: File): ResolvedMime {
  const type = file.type.trim().toLowerCase();
  const ext = extensionOf(file.name);

  if (isSvgMime(type) || ext === '.svg') {
    return { kind: 'svg' };
  }

  if (!type) {
    const fromExt = EXTENSION_MIME[ext];
    if (fromExt) return { kind: 'ok', mime: fromExt };
    return { kind: 'unsupported' };
  }

  if (!ALLOWED_SET.has(type)) {
    return { kind: 'unsupported' };
  }

  const mime = type as AllowedImageMimeType;
  const allowedExts = MIME_EXTENSIONS[mime];
  if (!ext || !allowedExts.has(ext)) {
    return { kind: 'unsupported' };
  }

  return { kind: 'ok', mime };
}

/**
 * Convenience MIME from browser File.type and/or filename extension.
 * Returns null when the pair is inconsistent or unsupported.
 * Does not establish the real file signature.
 */
export function reportedImageMimeType(file: File): AllowedImageMimeType | 'image/svg+xml' | null {
  const resolved = resolveReportedMime(file);
  if (resolved.kind === 'ok') return resolved.mime;
  if (resolved.kind === 'svg') return 'image/svg+xml';
  return null;
}

export function validateMediaFile(file: File | null | undefined): MediaValidationResult {
  if (!file) {
    return { ok: false, code: 'missing_file', message: mediaValidationMessage('missing_file') };
  }

  const resolved = resolveReportedMime(file);
  if (resolved.kind === 'svg') {
    return { ok: false, code: 'svg_rejected', message: mediaValidationMessage('svg_rejected') };
  }
  if (resolved.kind === 'unsupported') {
    return {
      ok: false,
      code: 'unsupported_type',
      message: mediaValidationMessage('unsupported_type'),
    };
  }
  if (file.size > MEDIA_MAX_BYTES) {
    return {
      ok: false,
      code: 'file_too_large',
      message: mediaValidationMessage('file_too_large'),
    };
  }

  return {
    ok: true,
    file,
    reportedMimeType: resolved.mime,
  };
}
