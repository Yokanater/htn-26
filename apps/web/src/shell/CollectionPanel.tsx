/**
 * Mounts the shopper collection workspace for a confirmed brief. Owner: L4 (S2-L4-1).
 * Capability-gated: nothing renders unless the server advertises FEATURE_COLLECTION_MATCHING.
 * The run streams over SSE; the workspace ignores events from any other run or brief revision,
 * so a superseded search can never change what is shown. The stream is closed on the result, on
 * `closed`, and when the shopper leaves.
 */
import type { ConsentRecord, IntentBrief } from '@sei/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackageSearch, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConsentPanel } from '../features/shopper/brief';
import type { CollectionRunEvent } from '../features/shopper/collection';
import { selectionKey } from '../features/shopper/collection';
import { ApiError, json } from './api';
import { ShoppingResults } from './ShoppingResults';

const EVENT_SOURCE_CLOSED = 2;

export function CollectionPanel({ brief, onEdit }: { brief: IntentBrief; onEdit?: () => void }) {
  const [runId, setRunId] = useState<string | null>(null);
  const [events, setEvents] = useState<CollectionRunEvent[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);

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
      {!runId && (
        <button
          className="primary"
          type="button"
          disabled={start.isPending}
          onClick={() => start.mutate()}
        >
          {start.isPending ? (
            <RefreshCw className="spin" aria-hidden />
          ) : (
            <PackageSearch aria-hidden />
          )}{' '}
          Find products
        </button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error.message}
        </p>
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
              // The server assigns identity, time and origin; the browser supplies only the
              // displayed references and an idempotency key so a retry cannot double-count.
              await json(`/api/briefs/${brief.id}/decisions`, {
                method: 'POST',
                body: JSON.stringify({
                  ...dto,
                  runId,
                  idempotencyKey: `${dto.kind}:${dto.matchId}:${selectionKey(dto.selections)}`,
                }),
              });
              return { ok: true };
            } catch (cause) {
              return {
                ok: false,
                status: cause instanceof ApiError && cause.code === 'REVISION_CONFLICT' ? 409 : 400,
              };
            }
          }}
          onRefreshBrief={onEdit}
        />
      )}
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
    </section>
  );
}
