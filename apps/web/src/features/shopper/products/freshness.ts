/** Freshness presentation helpers. ProductEvidence has capturedAt only — no stale field. */
export type FreshnessInput = {
  capturedAt: string;
  now: Date;
  ttlMs: number;
};

export function isStaleEvidence({ capturedAt, now, ttlMs }: FreshnessInput): boolean {
  const captured = Date.parse(capturedAt);
  if (Number.isNaN(captured)) return true;
  return now.getTime() - captured > ttlMs;
}

export function formatMoney(price: { amount: number; currency: string } | null): string {
  if (!price) return 'Price unknown';
  const major = (price.amount / 100).toFixed(2);
  return `${price.currency} ${major}`;
}
