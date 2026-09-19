/**
 * Hello page (card M1-L4-0). Replaced by the web shell in card M1-L4-3.
 * Proves the wiring: workspace TS source (@sei/contracts), TanStack Query, Tailwind v4 + shadcn
 * tokens, lucide icons, and the /api dev proxy to the server.
 */
import { SCHEMA_VERSION } from '@sei/contracts';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

async function fetchHealth(): Promise<{ ok: boolean }> {
  const res = await fetch('/api/healthz');
  if (!res.ok) throw new Error(`GET /api/healthz → HTTP ${res.status}`);
  return (await res.json()) as { ok: boolean };
}

export function App() {
  const health = useQuery({ queryKey: ['healthz'], queryFn: fetchHealth, retry: false });
  const status = health.isPending ? 'checking' : health.data?.ok ? 'ok' : 'unreachable';

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-3 p-8">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        <Activity aria-hidden className="size-6" />
        Shopify Ecosystem Intelligence
      </h1>
      <p className="text-muted-foreground">Hello from apps/web · contracts v{SCHEMA_VERSION}</p>
      <p
        className={cn(
          'font-mono text-sm',
          status === 'ok' && 'text-green-700',
          status === 'unreachable' && 'text-destructive',
        )}
      >
        server: {status}
      </p>
    </main>
  );
}
