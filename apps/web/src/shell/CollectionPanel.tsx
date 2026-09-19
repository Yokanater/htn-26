/**
 * Mounts the shopper collection workspace for a confirmed brief. Owner: L4 (S2-L4-1).
 * Capability-gated: nothing renders unless the server advertises FEATURE_COLLECTION_MATCHING.
 * The run streams over SSE; the workspace ignores events from any other run or brief revision,
 * so a superseded search can never change what is shown. The stream is closed on the result, on
 * `closed`, and when the shopper leaves.
 */
import type { IntentBrief } from '@sei/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PackageSearch, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CollectionRunEvent } from '../features/shopper/collection';
import { json } from './api';
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
        />
      )}
    </section>
  );
}
