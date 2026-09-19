import type {
  CollaborationCandidateDraft, CompetitorProfileDraft, DiscourseThemeDraft, RecommendedAction, SwotItem, SwotReport,
} from "./contracts.js";
import { norm, type EvidenceBundle } from "./evidence.js";

export type ValidationErrorCode =
  | "UNKNOWN_EVIDENCE_ID"
  | "EMPTY_EVIDENCE_IDS"
  | "MISSING_EXPLANATION"
  | "INSUFFICIENT_BUT_CONFIDENT"
  | "FORBIDDEN_ASSERTION"
  | "DUPLICATE_SWOT_ITEM"
  | "SWOT_NOT_ABOUT_MERCHANT"
  | "FIRST_PARTY_IN_DISCOURSE"
  | "SUBSTITUTE_WITHOUT_CONFLICT"
  | "DUPLICATE_ID"
  | "DUPLICATE_ENTITY"
  | "MISSING_THEME_KIND"
  // produced by workflows rather than validateReport:
  | "SCHEMA_INVALID"
  | "PLAN_INVALID";

export interface ValidationError {
  code: ValidationErrorCode;
  path: string; // e.g. "swot.strengths[1]"
  message: string;
  evidence_id?: string;
}

/** Any subset of the report; only what is present is validated. */
export interface ReportSections {
  collaboration?: CollaborationCandidateDraft[];
  competitors?: CompetitorProfileDraft[];
  themes?: DiscourseThemeDraft[];
  swot?: SwotReport;
  actions?: RecommendedAction[];
}

type Claim = {
  id: string;
  claim: string;
  claim_type: "observed" | "inference";
  explanation: string | null;
  evidence_ids: string[];
  confidence: "low" | "medium" | "high";
  insufficient_evidence: boolean;
};

// ---------------------------------------------------------------------------
// Revenue / traffic / market-share assertions.
// Heuristic, sentence-level. A sentence containing a negation ("does not imply market share") is exempt,
// so caveats are allowed but assertions are not. Sources: nothing in the bundle is a licensed data source.
// ---------------------------------------------------------------------------

const FORBIDDEN: { kind: "revenue" | "traffic" | "market_share"; re: RegExp }[] = [
  { kind: "revenue", re: /[$€£]\s?\d[\d,.]*\s?(?:k|m|mm|b|bn|million|billion|thousand)?\b[^.]{0,40}\b(?:revenue|sales|turnover|gmv|arr)\b/i },
  { kind: "revenue", re: /\b(?:revenue|sales|turnover|gmv|arr)\b[^.]{0,40}[$€£]\s?\d/i },
  { kind: "revenue", re: /\b(?:annual|monthly|yearly|quarterly|estimated|reported|total)\s+(?:revenue|sales|turnover)\b/i },
  { kind: "revenue", re: /\b(?:best|top)[- ]selling\b/i },
  { kind: "revenue", re: /\b(?:million|billion)[- ]dollar\b/i },
  { kind: "revenue", re: /\bgenerates?\b[^.]{0,30}\b(?:revenue|sales)\b/i },
  { kind: "traffic", re: /\d[\d,.]*\s?(?:k|m|million|thousand)?\s+(?:monthly|weekly|daily|annual)\s+(?:visitors|visits|users|sessions|pageviews|page views)\b/i },
  { kind: "traffic", re: /\d[\d,.]*\s?(?:k|m|million|thousand)?\s+(?:visitors|visits|pageviews)\s+(?:per|a|each|every)\s+(?:month|week|day)\b/i },
  { kind: "traffic", re: /\b(?:high|heavy|low|massive|huge|significant|strong)[- ]traffic\b/i },
  { kind: "traffic", re: /\b(?:website|site|web|store|organic)\s+traffic\b/i },
  { kind: "traffic", re: /\btraffic\s+(?:volume|rank|numbers|share)\b/i },
  { kind: "traffic", re: /\b(?:similarweb|alexa)\b/i },
  { kind: "market_share", re: /\bmarket[- ]share\b/i },
  { kind: "market_share", re: /\bshare of (?:the )?(?:[a-z-]+ ){0,2}market\b/i },
  { kind: "market_share", re: /\bmarket[- ]leader\b/i },
  { kind: "market_share", re: /\bdominat(?:es|ing|ant)\b[^.]{0,30}\bmarket\b/i },
  { kind: "market_share", re: /\b(?:largest|biggest|leading)\s+(?:share|player|seller|roaster|brand)\b/i },
  { kind: "market_share", re: /\b\d+(?:\.\d+)?\s?%\s+of\s+(?:the\s+)?(?:market|category|sales|revenue|traffic)\b/i },
];

const NEGATION = /\b(?:no|not|never|cannot|without|unknown|unavailable|nor)\b|n't/i;

export function findForbiddenAssertions(text: string): { kind: string; match: string }[] {
  const hits: { kind: string; match: string }[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (NEGATION.test(sentence)) continue;
    const kinds = new Set<string>();
    for (const { kind, re } of FORBIDDEN) {
      const m = kinds.has(kind) ? null : sentence.match(re);
      if (m) {
        kinds.add(kind);
        hits.push({ kind, match: m[0] });
      }
    }
  }
  return hits;
}

const SKIP_KEYS = new Set(["id", "entity_key", "evidence_ids", "contradicting_evidence_ids"]);

function* strings(value: unknown, path: string): Generator<[string, string]> {
  if (typeof value === "string") yield [path, value];
  else if (Array.isArray(value)) for (const [i, v] of value.entries()) yield* strings(v, `${path}[${i}]`);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) if (!SKIP_KEYS.has(k)) yield* strings(v, `${path}.${k}`);
}

// ---------------------------------------------------------------------------

const STOP = new Set("the and for with that this from are was were has have had but its not you your their they them into than then also can may more most over under about which who what when while where a an of to in on at by is it as be or if so".split(" "));
const tokens = (s: string) => new Set(norm(s).split(" ").filter((t) => t.length > 2 && !STOP.has(t)));

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

const DUPLICATE_THRESHOLD = 0.6;

export function validateReport(output: ReportSections, bundle: EvidenceBundle): ValidationError[] {
  const errors: ValidationError[] = [];
  const docs = new Map(bundle.documents.map((d) => [d.id, d]));
  const push = (code: ValidationErrorCode, path: string, message: string, evidence_id?: string) =>
    errors.push({ code, path, message, ...(evidence_id ? { evidence_id } : {}) });

  const claims: { path: string; item: Claim & Record<string, unknown> }[] = [];
  const add = <T extends Claim>(name: string, items: T[] | undefined) =>
    items?.forEach((item, i) => claims.push({ path: `${name}[${i}]`, item: item as never }));
  add("collaboration", output.collaboration);
  add("competitors", output.competitors);
  add("themes", output.themes);
  for (const q of ["strengths", "weaknesses", "opportunities", "threats"] as const) add(`swot.${q}`, output.swot?.[q]);
  add("actions", output.actions);

  // --- Per-claim rules -------------------------------------------------------
  const seenIds = new Set<string>();
  for (const { path, item } of claims) {
    if (seenIds.has(item.id)) push("DUPLICATE_ID", path, `id "${item.id}" is used more than once; ids must be unique across the report.`);
    seenIds.add(item.id);

    if (item.evidence_ids.length === 0 && !item.insufficient_evidence)
      push("EMPTY_EVIDENCE_IDS", path, "Claim has no evidence_ids. Cite evidence or set insufficient_evidence=true and state what is missing.");

    const cited = [...item.evidence_ids, ...(Array.isArray(item.contradicting_evidence_ids) ? (item.contradicting_evidence_ids as string[]) : [])];
    for (const id of new Set(cited))
      if (!docs.has(id)) push("UNKNOWN_EVIDENCE_ID", path, `Evidence id "${id}" is not in the evidence bundle. Cite only ids you were given.`, id);

    if (item.claim_type === "inference" && !item.explanation?.trim())
      push("MISSING_EXPLANATION", path, "claim_type is 'inference' but explanation is empty. Explain the reasoning from the cited evidence.");

    if (item.insufficient_evidence && item.confidence !== "low")
      push("INSUFFICIENT_BUT_CONFIDENT", path, "insufficient_evidence=true requires confidence 'low'.");

    for (const [p, text] of strings(item, path))
      for (const hit of findForbiddenAssertions(text))
        push("FORBIDDEN_ASSERTION", p, `Asserts ${hit.kind.replace("_", " ")} ("${hit.match}"). Revenue, traffic and market share cannot be claimed without a licensed source; remove it.`);
  }

  // --- Collaboration ------------------------------------------------------------
  output.collaboration?.forEach((c, i) => {
    if (c.is_direct_substitute && !c.conflict_note?.trim())
      push("SUBSTITUTE_WITHOUT_CONFLICT", `collaboration[${i}]`, "Direct substitutes are only allowed with an explicit conflict_note. Replace with a complementary brand or state the conflict.");
  });
  const dupEntities = (name: string, items: { name: string; key: string | null }[] | undefined) => {
    const seen = new Set<string>();
    items?.forEach((it, i) => {
      const key = it.key ?? norm(it.name);
      if (seen.has(key)) push("DUPLICATE_ENTITY", `${name}[${i}]`, `"${it.name}" appears more than once.`);
      seen.add(key);
    });
  };
  dupEntities("collaboration", output.collaboration?.map((c) => ({ name: c.brand_name, key: c.entity_key })));
  dupEntities("competitors", output.competitors?.map((c) => ({ name: c.name, key: c.entity_key })));

  // --- Discourse ------------------------------------------------------------------
  output.themes?.forEach((t, i) => {
    for (const id of [...t.evidence_ids, ...t.contradicting_evidence_ids]) {
      const d = docs.get(id);
      if (d && d.origin !== "independent")
        push("FIRST_PARTY_IN_DISCOURSE", `themes[${i}]`, `"${id}" is ${d.origin === "merchant_owned" ? "the merchant's own" : "a brand's own"} storefront copy, not customer or third-party voice. Do not cite it in discourse themes.`, id);
    }
  });
  if (output.themes) {
    const present = new Set(output.themes.map((t) => t.theme_kind));
    for (const kind of ["praise", "complaint", "switching_trigger", "unmet_need"] as const)
      if (!present.has(kind)) push("MISSING_THEME_KIND", "themes", `No theme of kind "${kind}". Add one, or add an item with insufficient_evidence=true stating what is missing.`);
  }

  // --- SWOT -----------------------------------------------------------------------
  if (output.swot) {
    const brand = norm(bundle.profile.brand_name);
    const shortBrand = brand.replace(/(?: (?:coffee|coffees|co|company|roasters|roasting|shop|store|inc|ltd))+$/, ""); // "alder and ash coffee" -> "alder and ash"
    const names = [brand, shortBrand, norm(bundle.profile.domain), ...bundle.profile.products.map((p) => norm(p.name.split("(")[0] ?? ""))].filter(Boolean);
    const concernsMerchant = (it: SwotItem) => {
      const text = norm(`${it.claim} ${it.explanation ?? ""}`);
      return names.some((n) => text.includes(n)) || it.evidence_ids.some((id) => docs.get(id)?.origin === "merchant_owned");
    };
    for (const q of ["strengths", "weaknesses"] as const)
      output.swot[q].forEach((it, i) => {
        if (it.subject !== "merchant")
          push("SWOT_NOT_ABOUT_MERCHANT", `swot.${q}[${i}]`, `${q} must concern the merchant (subject "merchant"); move market or competitor conditions to opportunities/threats.`);
        else if (!concernsMerchant(it))
          push("SWOT_NOT_ABOUT_MERCHANT", `swot.${q}[${i}]`, `Claim does not mention ${bundle.profile.brand_name} or its products and cites no merchant-owned evidence. Name the merchant in the claim, or move it to opportunities/threats.`);
      });

    const flat = (["strengths", "weaknesses", "opportunities", "threats"] as const).flatMap((q) =>
      output.swot![q].map((it, i) => ({ q, i, tok: tokens(it.claim) })),
    );
    for (let a = 0; a < flat.length; a++)
      for (let b = a + 1; b < flat.length; b++) {
        const x = flat[a]!, y = flat[b]!;
        if (x.q !== y.q && jaccard(x.tok, y.tok) >= DUPLICATE_THRESHOLD)
          push("DUPLICATE_SWOT_ITEM", `swot.${y.q}[${y.i}]`, `Near-duplicate of swot.${x.q}[${x.i}]. Each point may appear in only one quadrant.`);
      }
  }

  return errors;
}

export function formatErrors(errors: ValidationError[]): string {
  return errors.map((e) => `- [${e.code}] ${e.path}: ${e.message}`).join("\n");
}
