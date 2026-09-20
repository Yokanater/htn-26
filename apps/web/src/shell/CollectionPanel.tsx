/**
 * Mounts the shopper collection workspace for a confirmed brief. Owner: L4 (S2-L4-1).
 * Capability-gated: nothing renders unless the server advertises FEATURE_COLLECTION_MATCHING.
 * The run streams over SSE; the workspace ignores events from any other run or brief revision,
 * so a superseded search can never change what is shown. The stream is closed on the result, on
 * `closed`, and when the shopper leaves.
 */
import type { ConsentRecord, IntentBrief } from '@sei/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ConsentPanel } from '../features/shopper/brief';
import type { CollectionRunEvent } from '../features/shopper/collection';
import { decisionRequestBody } from '../features/shopper/collection/decisions';

import { ApiError, json } from './api';
import { ShoppingResults } from './ShoppingResults';

const EVENT_SOURCE_CLOSED = 2;

export function CollectionPanel({ brief, onEdit }: { brief: IntentBrief; onEdit?: () => void }) {
  const [runId, setRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<CollectionRunEvent[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const autoStarted = useRef(false);

  const capabilities = useQuery({
    queryKey: ['capabilities'],
    queryFn: () => json<{ flags?: Record<string, boolean> }>('/api/capabilities'),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const start = useMutation({
    mutationFn: () =>
      json<{ runId: string }>(`/api/briefs/${brief.id}/matches`, { method: 'POST', body: '{}' }),
    onSuccess: ({ runId: id }) => {
      setEvents([]);
      setStreamError(null);
      setRunId(id);
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => json(`/api/runs/${id}`, { method: 'DELETE' }),
  });

  useEffect(() => {
    if (
      capabilities.data?.flags?.FEATURE_COLLECTION_MATCHING === true &&
      !autoStarted.current &&
      !runId
    ) {
      autoStarted.current = true;
      start.mutate();
    }
  }, [capabilities.data?.flags?.FEATURE_COLLECTION_MATCHING, runId, start.mutate]);

  // Consent is independent of searching: a shopper can browse without ever opting in.
  const queryClient = useQueryClient();
  const consent = useQuery({
    queryKey: ['consent'],
    queryFn: () => json<{ consent: ConsentRecord | null }>('/api/consent'),
    retry: false,
  });
  const current = consent.data?.consent ?? null;
  async function setConsentState(state: ConsentRecord['state']) {
    try {
      await json('/api/consent', {
        method: 'PUT',
        body: JSON.stringify({ state, expectedVersion: current?.version ?? null }),
      });
      await queryClient.invalidateQueries({ queryKey: ['consent'] });
      return { ok: true };
    } catch {
      // A conflict means another tab moved first; refetching shows the shopper the truth.
      await queryClient.invalidateQueries({ queryKey: ['consent'] });
      return { ok: false };
    }
  }

  useEffect(() => {
    if (!runId) return;
    const source = new EventSource(`/api/runs/${runId}/events`);
    const receive = (message: { data: string }) => {
      try {
        const event = JSON.parse(message.data) as CollectionRunEvent;
        setEvents((seen) => [...seen, event]);
        if (event.type === 'result') source.close();
      } catch {
        // A malformed frame is ignored; the workspace only trusts well-formed events.
      }
    };
    source.addEventListener('stage', receive);
    source.addEventListener('result', receive);
    source.addEventListener('closed', () => source.close());
    // The browser reconnects with Last-Event-ID on its own; only a dead stream is an error.
    source.onerror = () => {
      if (source.readyState === EVENT_SOURCE_CLOSED)
        setStreamError('Lost the connection to the search. Start it again.');
    };
    return () => source.close();
  }, [runId]);

  if (capabilities.data?.flags?.FEATURE_COLLECTION_MATCHING !== true) return null;

  const flags = capabilities.data?.flags ?? null;
  const error = start.error ?? cancel.error ?? (streamError ? new Error(streamError) : null);
  return (
    <section className="collection-panel" aria-label="Product search">
      {!runId && !error && (
        <section className="search-launch" aria-live="polite" aria-label="Preparing product search">
          <div className="search-orbit" aria-hidden>
            <span>
              <Search />
            </span>
            <i />
            <i />
            <i />
          </div>
          <p className="eyebrow">CURATING YOUR COLLECTION</p>
          <h1>Looking for pieces that fit.</h1>
          <p>Checking products, availability, and the details you care about.</p>
          <div className="search-steps" aria-hidden>
            <span className="active">
              <Sparkles /> Reading your brief
            </span>
            <span>Searching stores</span>
            <span>Building your collection</span>
          </div>
        </section>
      )}
      {error && (
        <div className="search-start-error" role="alert">
          <strong>We couldn’t start the search.</strong>
          <p>{error.message}</p>
          <button type="button" onClick={() => start.mutate()}>
            Try again
          </button>
        </div>
      )}
      {runId && (
        <ShoppingResults
          key={runId}
          brief={brief}
          runId={runId}
          events={events}
          onCancel={() => cancel.mutate(runId)}
          onRetry={() => start.mutate()}
          onEdit={onEdit}
          flags={flags}
          onDecision={async (dto) => {
            try {
              await json(`/api/briefs/${brief.id}/decisions`, {
                method: 'POST',
                body: JSON.stringify(decisionRequestBody(dto, runId, crypto.randomUUID())),
              });
              return { ok: true };
            } catch (cause) {
              // Only a stale brief is recoverable by reloading the current revision.
              return {
                ok: false,
                status: cause instanceof ApiError ? cause.status : 0,
              };
            }
          }}
          onRefreshBrief={onEdit}
        />
      )}
      {(runId || error) && (
        <details className="sharing-disclosure">
          <summary>Privacy & sharing settings</summary>
          <ConsentPanel
            consent={current}
            flags={flags}
            onGrant={() => setConsentState('granted')}
            onWithdraw={() => setConsentState('withdrawn')}
            onDeleteSession={async () => {
              try {
                await json('/api/session', { method: 'DELETE' });
                await queryClient.invalidateQueries({ queryKey: ['consent'] });
                return { ok: true };
              } catch {
                return { ok: false };
              }
            }}
          />
        </details>
      )}
    </section>
  );
}
