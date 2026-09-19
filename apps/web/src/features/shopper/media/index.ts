/** Shopper media intake. Owner: L1. Design v3 §5.1. Mounted by L4. */
export {
  MEDIA_TEXT_MAX_LENGTH,
  MediaIntake,
  type MediaIntakeMode,
  type MediaIntakeProps,
  type MediaSelection,
} from './MediaIntake';
export {
  type CanvasLike,
  type ImageBitmapLike,
  MEDIA_MAX_LONG_EDGE_PX,
  type MediaNormalizeBrowser,
  type NormalizeMediaError,
  type NormalizeMediaResult,
  normalizeMediaFile,
  targetDimensions,
} from './normalize';
export {
  ALLOWED_IMAGE_MIME_TYPES,
  type AllowedImageMimeType,
  MEDIA_MAX_BYTES,
  type MediaValidationErrorCode,
  type MediaValidationResult,
  mediaValidationMessage,
  reportedImageMimeType,
  validateMediaFile,
} from './validation';
