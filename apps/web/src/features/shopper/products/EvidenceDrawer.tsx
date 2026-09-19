/** Public evidence drawer. Owner: L1 (S2-L1-2 C3). */
import type { ProductEvidence, SampleOrigin } from '@sei/contracts';
import { useEffect, useId, useRef } from 'react';
import { isStaleEvidence } from './freshness';

export type EvidenceDrawerProps = {
  open: boolean;
  title: string;
  evidence: readonly ProductEvidence[];
  sampleOrigin?: SampleOrigin;
  onClose: () => void;
  now?: Date;
  evidenceTtlMs?: number;
  /** Element that opened the drawer; focus returns here on close. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function isFocusable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false;
  if (el.tabIndex < 0 && el.tagName !== 'A' && el.tagName !== 'BUTTON') return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return el.matches('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
}

export function EvidenceDrawer({
  open,
  title,
  evidence,
  sampleOrigin,
  onClose,
  now = new Date(),
  evidenceTtlMs = DEFAULT_TTL_MS,
  returnFocusRef,
}: EvidenceDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current =
      returnFocusRef?.current ?? (document.activeElement as HTMLElement | null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const panel = panelRef.current;
    const focusables = () => (panel ? [...panel.querySelectorAll('*')].filter(isFocusable) : []);

    const focusFirst = () => {
      const items = focusables();
      (items[0] ?? panel)?.focus();
    };
    focusFirst();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      const restore = returnFocusRef?.current ?? previouslyFocused.current;
      restore?.focus?.();
    };
  }, [open, onClose, returnFocusRef]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      ref={panelRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="max-h-[80vh] w-[min(32rem,90vw)] overflow-auto border bg-background p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {sampleOrigin ? (
          <p className="text-sm text-muted-foreground">Sample origin: {sampleOrigin}</p>
        ) : null}
        <ul className="mt-3 flex list-none flex-col gap-3 p-0">
          {evidence.map((ev) => {
            const stale = isStaleEvidence({
              capturedAt: ev.capturedAt,
              now,
              ttlMs: evidenceTtlMs,
            });
            return (
              <li key={ev.id} className="border p-2 text-sm">
                <p>
                  <strong>{ev.field}</strong>: {ev.value}
                </p>
                <p>
                  Method: {ev.method} · Captured: {ev.capturedAt}
                  {stale ? ' · Stale' : ''}
                </p>
                <a href={ev.url} target="_blank" rel="noreferrer">
                  Source
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
