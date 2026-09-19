/** Honest bootstrap landing page. L4 shell; shopper components are split across L1/L3. */
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
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-5 p-8">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        <Activity aria-hidden className="size-6" />
        Shopify Intent Studio
      </h1>
      <p>From shopper inspiration to evidence-backed merchant collaborations.</p>
      <section aria-labelledby="shopper-heading" className="rounded-lg border p-4">
        <h2 id="shopper-heading" className="font-semibold">
          For shoppers
        </h2>
        <p>
          Outfits and room or desk setups: confirm what you want, then find a collection across
          stores.
        </p>
      </section>
      <section aria-labelledby="merchant-heading" className="rounded-lg border p-4">
        <h2 id="merchant-heading" className="font-semibold">
          For merchants
        </h2>
        <p>Find collaboration opportunities from aggregate, opted-in shopper choices.</p>
      </section>
      <p className="text-sm text-muted-foreground">
        Bootstrap preview · contracts v{SCHEMA_VERSION}. Uploads, matching and merchant insights are
        planned, not yet available.
      </p>
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
