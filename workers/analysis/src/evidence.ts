import type { EvidenceDocument, StoreProfile } from "./contracts.js";

/**
 * merchant_owned: the merchant's own pages (marketing copy). Fine as facts about the merchant, never customer sentiment.
 * brand_owned:    another brand's storefront. Fine as facts about that brand, never customer sentiment.
 * independent:    forum / review / editorial / video / social.
 */
export type Origin = "merchant_owned" | "brand_owned" | "independent";
export type BundleDoc = EvidenceDocument & { origin: Origin };

export interface EvidenceBundle {
  profile: StoreProfile;
  documents: BundleDoc[];
  excluded: { id: string; reason: string }[];
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return url.toLowerCase();
  }
}

export function originOf(doc: EvidenceDocument, profile: StoreProfile): Origin {
  const host = hostOf(doc.source_url);
  const merchant = profile.domain.toLowerCase().replace(/^www\./, "");
  if (host === merchant || host.endsWith(`.${merchant}`)) return "merchant_owned";
  return doc.source_type === "storefront" ? "brand_owned" : "independent";
}

/** Bundle with every document, no selection. Used by tests and when a caller has already curated evidence. */
export function toBundle(profile: StoreProfile, docs: EvidenceDocument[]): EvidenceBundle {
  return { profile, documents: docs.map((d) => ({ ...d, origin: originOf(d, profile) })), excluded: [] };
}

/** Lowercase, "&" -> "and", punctuation stripped. Lets "Alder & Ash's" match "alder and ash". */
export function norm(s: string): string {
  return s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Distinct independent sources = distinct hostnames. */
export function distinctSources(ids: string[], bundle: EvidenceBundle): number {
  const byId = new Map(bundle.documents.map((d) => [d.id, d]));
  return new Set(ids.flatMap((id) => (byId.has(id) ? [hostOf(byId.get(id)!.source_url)] : []))).size;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

const INJECTION_PATTERNS = [
  /\b(?:ignore|disregard|forget)\b[^.]{0,30}\b(?:previous|prior|above|earlier|all)\b[^.]{0,20}\b(?:instructions?|prompts?|rules)\b/i,
  /\bnew instructions\b/i,
  /\byou are now\b/i,
  /\b(?:system|developer) prompt\b/i,
  /^\s*(?:system|assistant)\s*:/im,
];

export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

export interface SelectOptions {
  maxItems: number;
  now?: Date; // for freshness; default: current time
  quarantineInjections?: boolean; // default true: docs that look like prompt injection never reach a model
  maxMerchantOwned?: number; // default: 25% of maxItems, rounded up
}

const FRESHNESS_HALF_LIFE_DAYS = 365;

/**
 * Greedy pick: relevance + freshness, plus bonuses for under-represented source types / stances and a penalty for
 * repeating a host. Merchant-owned pages are capped: they are useful facts about the merchant, but not customer voice.
 */
export function selectEvidence(profile: StoreProfile, evidence: EvidenceDocument[], opts: SelectOptions): EvidenceBundle {
  const now = (opts.now ?? new Date()).getTime();
  const quarantine = opts.quarantineInjections ?? true;
  const maxMerchant = opts.maxMerchantOwned ?? Math.ceil(opts.maxItems * 0.25);
  const excluded: EvidenceBundle["excluded"] = [];

  const seenSpans = new Set<string>();
  const pool: BundleDoc[] = [];
  for (const d of [...evidence].sort((a, b) => (b.enrichment?.relevance ?? 0) - (a.enrichment?.relevance ?? 0))) {
    if (quarantine && looksLikeInjection(`${d.title}\n${d.exact_span}`)) {
      excluded.push({ id: d.id, reason: "possible prompt injection" });
      continue;
    }
    const key = norm(d.exact_span);
    if (seenSpans.has(key)) {
      excluded.push({ id: d.id, reason: "duplicate exact_span" });
      continue;
    }
    seenSpans.add(key);
    pool.push({ ...d, origin: originOf(d, profile) });
  }

  const freshness = (d: BundleDoc) => {
    if (!d.published_at) return 0.25;
    const ageDays = Math.max(0, (now - Date.parse(d.published_at)) / 86_400_000);
    return 0.5 ** (ageDays / FRESHNESS_HALF_LIFE_DAYS);
  };

  const picked: BundleDoc[] = [];
  const typeCount = new Map<string, number>();
  const hostCount = new Map<string, number>();
  const stanceCount = new Map<string, number>();
  let merchantCount = 0;
  let independentCount = 0;

  while (picked.length < opts.maxItems && pool.length) {
    let best = -1;
    let bestScore = -Infinity;
    pool.forEach((d, i) => {
      if (d.origin === "merchant_owned" && merchantCount >= maxMerchant) return;
      let score = 0.5 * (d.enrichment?.relevance ?? 0.3) + 0.25 * freshness(d);
      score += 0.15 / (1 + (typeCount.get(d.source_type) ?? 0));
      score -= 0.1 * (hostCount.get(hostOf(d.source_url)) ?? 0);
      if (d.origin === "independent" && d.enrichment) {
        const share = (stanceCount.get(d.enrichment.sentiment.label) ?? 0) / Math.max(1, independentCount);
        score += 0.1 * (1 - share);
      }
      if (score > bestScore) [best, bestScore] = [i, score];
    });
    if (best < 0) break;
    const [d] = pool.splice(best, 1) as [BundleDoc];
    picked.push(d);
    typeCount.set(d.source_type, (typeCount.get(d.source_type) ?? 0) + 1);
    hostCount.set(hostOf(d.source_url), (hostCount.get(hostOf(d.source_url)) ?? 0) + 1);
    if (d.origin === "merchant_owned") merchantCount++;
    if (d.origin === "independent") {
      independentCount++;
      if (d.enrichment) stanceCount.set(d.enrichment.sentiment.label, (stanceCount.get(d.enrichment.sentiment.label) ?? 0) + 1);
    }
  }
  for (const d of pool) excluded.push({ id: d.id, reason: d.origin === "merchant_owned" && merchantCount >= maxMerchant ? "merchant-owned cap" : "below maxItems cut-off" });

  return { profile, documents: picked.sort((a, b) => a.id.localeCompare(b.id)), excluded };
}

/** The only docs that may feed customer-sentiment analysis: never the merchant's (or any brand's) own copy. */
export function customerVoice(bundle: EvidenceBundle): BundleDoc[] {
  return bundle.documents.filter((d) => d.origin === "independent");
}

// ---------------------------------------------------------------------------
// Prompt rendering: every document is fenced as untrusted data
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attr = (s: string) => esc(s).replace(/"/g, "&quot;");

export function renderEvidence(docs: BundleDoc[]): string {
  const body = [...docs]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((d) => {
      const e = d.enrichment;
      const meta = [
        `id="${attr(d.id)}"`,
        `source_type="${d.source_type}"`,
        `origin="${d.origin}"`,
        `host="${attr(hostOf(d.source_url))}"`,
        `published="${d.published_at?.slice(0, 10) ?? "unknown"}"`,
        ...(e ? [`sentiment="${e.sentiment.label}"`, `relevance="${e.relevance}"`, `topics="${attr(e.topics.map((t) => t.label).join("; "))}"`] : []),
      ].join(" ");
      return `<evidence ${meta}>\n<title>${esc(d.title)}</title>\n<span>${esc(d.exact_span)}</span>\n</evidence>`;
    })
    .join("\n");
  return `<evidence_bundle untrusted="true">\n${body}\n</evidence_bundle>`;
}
