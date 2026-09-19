/** MediaIntake with validation (A1), normalize/preview (A2), and text path (A3). Owner: L1. */
import { type ChangeEvent, useEffect, useId, useRef, useState } from 'react';
import {
  type MediaNormalizeBrowser,
  type NormalizeMediaResult,
  normalizeMediaFile,
} from './normalize';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  type MediaValidationErrorCode,
  validateMediaFile,
} from './validation';

export const MEDIA_TEXT_MAX_LENGTH = 2000;

export type MediaIntakeMode = 'image' | 'text';

export type MediaSelection =
  | {
      kind: 'image';
      file: File;
      width: number;
      height: number;
      mimeType: string;
    }
  | { kind: 'text'; text: string };

export type MediaIntakeProps = {
  onSelectionChange?: (selection: MediaSelection | null) => void;
  onValidationError?: (code: string | null, message: string | null) => void;
  label?: string;
  textLabel?: string;
  id?: string;
  disabled?: boolean;
  /** Initial input choice. Integration shells may prefer text while server decoding is unavailable. */
  initialMode?: MediaIntakeMode;
  /** Inject browser primitives for deterministic tests. Production uses real APIs. */
  browser?: MediaNormalizeBrowser;
  /** When false, A1-only behavior: accept raw file without normalize (tests). Default true. */
  normalize?: boolean;
};

export function MediaIntake({
  onSelectionChange,
  onValidationError,
  label = 'Inspiration image',
  textLabel = 'Describe the collection',
  id,
  disabled = false,
  initialMode = 'image',
  browser,
  normalize = true,
}: MediaIntakeProps) {
  const autoId = useId();
  const inputId = id ?? `media-intake-${autoId}`;
  const textId = `${inputId}-text`;
  const errorId = `${inputId}-error`;
  const helpId = `${inputId}-help`;
  const previewId = `${inputId}-preview`;
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const generationRef = useRef(0);

  const [mode, setMode] = useState<MediaIntakeMode>(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  function revokePreview() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
  }

  function setPreviewFromBlob(blob: Blob) {
    revokePreview();
    const url = URL.createObjectURL(blob);
    previewUrlRef.current = url;
    setPreviewUrl(url);
  }

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

  function clearInputValue() {
    const el = inputRef.current;
    if (el) el.value = '';
  }

  function reportError(code: string | null, message: string | null) {
    setError(message);
    onValidationError?.(code, message);
  }

  function clearImageState() {
    clearInputValue();
    setSelectedName(null);
    revokePreview();
  }

  async function acceptValidatedFile(file: File) {
    const generation = ++generationRef.current;
    if (!normalize) {
      setSelectedName(file.name);
      reportError(null, null);
      onSelectionChange?.({
        kind: 'image',
        file,
        width: 0,
        height: 0,
        mimeType: file.type,
      });
      return;
    }

    setBusy(true);
    try {
      const result: NormalizeMediaResult = await normalizeMediaFile(file, { browser });
      if (generation !== generationRef.current) {
        return;
      }
      setSelectedName(result.file.name);
      setPreviewFromBlob(result.blob);
      reportError(null, null);
      onSelectionChange?.({
        kind: 'image',
        file: result.file,
        width: result.width,
        height: result.height,
        mimeType: result.mimeType,
      });
    } catch (err) {
      if (generation !== generationRef.current) {
        return;
      }
      clearImageState();
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: string }).code)
          : 'decode_failed';
      const message =
        code === 'decode_failed' || code === 'encode_failed' || code === 'unsupported_output'
          ? err instanceof Error
            ? err.message
            : 'Could not prepare that image. Try a different file.'
          : 'Could not prepare that image. Try a different file.';
      reportError(code, message);
      onSelectionChange?.(null);
    } finally {
      if (generation === generationRef.current) {
        setBusy(false);
      }
    }
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    const result = validateMediaFile(file);
    if (!result.ok) {
      generationRef.current += 1;
      setSelectedName(null);
      revokePreview();
      reportError(result.code, result.message);
      onSelectionChange?.(null);
      clearInputValue();
      return;
    }

    void acceptValidatedFile(result.file);
  }

  function handleClearImage() {
    generationRef.current += 1;
    clearImageState();
    reportError(null, null);
    onSelectionChange?.(null);
  }

  function handleModeChange(next: MediaIntakeMode) {
    if (next === mode) return;
    generationRef.current += 1;
    setMode(next);
    reportError(null, null);
    if (next === 'image') {
      setText('');
      onSelectionChange?.(null);
    } else {
      clearImageState();
      onSelectionChange?.(null);
    }
  }

  function handleTextChange(value: string) {
    const next = value.slice(0, MEDIA_TEXT_MAX_LENGTH);
    setText(next);
    if (next.trim().length === 0) {
      reportError(null, null);
      onSelectionChange?.(null);
      return;
    }
    reportError(null, null);
    onSelectionChange?.({ kind: 'text', text: next });
  }

  const accept = ALLOWED_IMAGE_MIME_TYPES.join(',');

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2" disabled={disabled}>
        <legend className="text-sm font-medium">Inspiration input</legend>
        <div className="flex gap-4 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name={`${inputId}-mode`}
              checked={mode === 'image'}
              onChange={() => handleModeChange('image')}
            />
            Image
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name={`${inputId}-mode`}
              checked={mode === 'text'}
              onChange={() => handleModeChange('text')}
            />
            Text description
          </label>
        </div>
      </fieldset>

      {mode === 'image' ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={inputId} className="text-sm font-medium">
            {label}
          </label>
          <p id={helpId} className="text-sm text-muted-foreground">
            Choose one JPEG, PNG, or WebP image up to 8 MiB. Client type checks are convenience
            only; the server verifies the real file. Images are resized and re-encoded before upload
            to remove embedded metadata.
          </p>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={accept}
            disabled={disabled || busy}
            aria-describedby={error ? `${helpId} ${errorId}` : helpId}
            aria-invalid={error ? true : undefined}
            onChange={handleChange}
          />
          {busy ? <p className="text-sm">Preparing image…</p> : null}
          {previewUrl ? (
            <img
              id={previewId}
              src={previewUrl}
              alt={selectedName ? `Preview of ${selectedName}` : 'Normalized inspiration preview'}
              className="max-h-64 max-w-full object-contain"
            />
          ) : null}
          {selectedName ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>Selected: {selectedName}</span>
              <button type="button" onClick={handleClearImage} disabled={disabled || busy}>
                Remove
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor={textId} className="text-sm font-medium">
            {textLabel}
          </label>
          <p id={`${textId}-help`} className="text-sm text-muted-foreground">
            Describe the products or collection in up to {MEDIA_TEXT_MAX_LENGTH} characters.
            Interpretation and brief construction happen after you continue.
          </p>
          <textarea
            id={textId}
            value={text}
            maxLength={MEDIA_TEXT_MAX_LENGTH}
            rows={5}
            disabled={disabled}
            aria-describedby={`${textId}-help`}
            onChange={(event) => handleTextChange(event.target.value)}
          />
          <p className="text-sm text-muted-foreground">
            {text.length}/{MEDIA_TEXT_MAX_LENGTH}
          </p>
        </div>
      )}

      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export type { MediaValidationErrorCode };
