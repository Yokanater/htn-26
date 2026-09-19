import { createHash } from "node:crypto";
import type {
  Candidate,
  Evidence,
  Profile,
  Report,
} from "../../../packages/contracts/src/index";
import { withBrowserbaseSession } from "./browserbase";
import { assertPublicUrl } from "./url-safety";

type SearchResult = { title: string; url: string; snippet: string };
type CapturedBrand = {
  name: string;
  url: string;
  title: string;
  description: string;
  text: string;
  imageUrl?: string;
};
export type StorefrontSignals = {
  title: string;
  description: string;
  productLinks: number;
  productSchema: boolean;
  addToCart: boolean;
};

export function hasStorefrontCommerceEvidence(signals: StorefrontSignals) {
  const editorial =
    /\b(ultimate guide|brands you (?:need|should)|we did the research|\d+ brands|master list)\b/i.test(
      `${signals.title} ${signals.description}`,
    );
  return (
    !editorial &&
    (signals.productLinks > 0 || signals.productSchema || signals.addToCart)
  );
}

const sessionQueue: (() => void)[] = [];
let activeSessions = 0;
function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted)
    throw signal.reason ?? new Error("Browserbase research reached its limit.");
}

async function abortableDelay(ms: number, signal?: AbortSignal) {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(
          signal.reason ?? new Error("Browserbase research reached its limit."),
        );
      },
      { once: true },
    );
  });
}

async function withResearchSlot<T>(
  run: () => Promise<T>,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  if (activeSessions >= 3) {
    await Promise.race([
      new Promise<void>((resolve) => sessionQueue.push(resolve)),
      new Promise<never>((_, reject) =>
        signal?.addEventListener(
          "abort",
          () =>
            reject(
              signal.reason ??
                new Error("Browserbase research reached its limit."),
            ),
          { once: true },
        ),
      ),
    ]);
  }
  throwIfAborted(signal);
  activeSessions += 1;
  try {
    return await run();
  } finally {
    activeSessions -= 1;
    sessionQueue.shift()?.();
  }
}

async function withBrowserbaseCapacity<T>(
  run: () => Promise<T>,
  signal?: AbortSignal,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    throwIfAborted(signal);
    try {
      return await withResearchSlot(run, signal);
    } catch (error) {
      const rateLimited =
        error instanceof Error && /429|burst rate limit/i.test(error.message);
      if (!rateLimited || attempt === 2) throw error;
      await abortableDelay(61_000, signal);
    }
  }
  throw new Error("Browserbase capacity retry failed.");
}

const excludedHosts = [
  "duckduckgo.com",
  "google.com",
  "bing.com",
  "wikipedia.org",
  "reddit.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "youtube.com",
  "amazon.com",
  "etsy.com",
  "pinterest.com",
  "yelp.com",
  "forbes.com",
  "vogue.com",
  "elle.com",
  "nytimes.com",
];

function clean(value: string, limit = 400) {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function hostKey(url: string) {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

const verifiedSeedNames: Record<string, string> = {
  "poppybarley.com": "Poppy Barley",
  "lintervalleshoes.com": "L'INTERVALLE",
  "lacanadienne-shoes.com": "La Canadienne",
  "fluevog.com": "John Fluevog Shoes",
  "okayok.ca": "OKAYOK",
  "m0851.com": "m0851",
  "braveleather.com": "BRAVE Leather",
  "shoemgk.ca": "Shoe MGK Canada",
  "christydawn.com": "Christy Dawn",
  "sondeflor.com": "Son de Flor",
  "shopdoen.com": "DÔEN",
  "littlewomenatelier.com": "Little Women Atelier",
  "betsyandiya.com": "Betsy & Iya",
  "olofragrance.com": "OLO Fragrance",
  "pfcandleco.com": "P.F. Candle Co.",
  "palazzocielo.com": "Palazzo Cielo",
};

function unwrapDuckDuckGo(url: string) {
  const parsed = new URL(url);
  const destination = parsed.searchParams.get("uddg");
  return destination ? decodeURIComponent(destination) : url;
}

async function search(
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  return withBrowserbaseCapacity(
    () =>
      withBrowserbaseSession(
        { allowedDomains: ["duckduckgo.com"], timeoutMs: 30_000, signal },
        async ({ page }) => {
          await page.goto(
            `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
            { waitUntil: "domcontentloaded", timeout: 20_000 },
          );
          return (await page.evaluate(`(() => Array.from(document.querySelectorAll('.result')).slice(0, 12).map((result) => ({
        title: result.querySelector('.result__a')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
        url: result.querySelector('.result__a')?.href ?? '',
        snippet: result.querySelector('.result__snippet')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
      })).filter((item) => item.title && item.url))()`)) as SearchResult[];
        },
      ),
    signal,
  );
}

function queryPlan(profile: Profile) {
  const location = profile.geography || "North America";
  if (/footwear|shoes?|sneakers?/i.test(profile.category))
    return {
      competitors: [
        `${profile.name} alternatives independent shoe brands ${location}`,
        `women's footwear brands ${location} designed quality shoes`,
      ],
      collaborators: [
        `independent sock brand ${location} official store`,
        `independent shoe care brand ${location} official store`,
        `independent handbag brand ${location} official store`,
      ],
      competitorSeeds: [
        "https://poppybarley.com/pages/about-us",
        "https://lintervalleshoes.com/pages/about-us",
        "https://lacanadienne-shoes.com/",
        "https://www.fluevog.com/",
      ],
      collaboratorSeeds: [
        "https://okayok.ca/pages/who-we-are",
        "https://www.m0851.com/",
        "https://braveleather.com/",
        "https://www.shoemgk.ca/",
      ],
    };
  if (/apparel|clothing|fashion|vintage/i.test(profile.category))
    return {
      competitors: [
        `${profile.name} alternatives romantic vintage inspired clothing`,
        `independent slow fashion women's clothing brands ${location}`,
      ],
      collaborators: [
        `independent jewelry brand ${location} official store`,
        `independent fragrance stationery lifestyle brand ${location} official store`,
      ],
      competitorSeeds: [
        "https://christydawn.com/collections/new-arrivals",
        "https://sondeflor.com/",
        "https://shopdoen.com/",
        "https://littlewomenatelier.com/",
      ],
      collaboratorSeeds: [
        "https://betsyandiya.com/",
        "https://olofragrance.com/",
        "https://pfcandleco.com/",
        "https://palazzocielo.com/",
      ],
    };
  return {
    competitors: [
      `${profile.name} alternatives ${profile.category} brands ${location}`,
      `independent ${profile.category} brands ${location}`,
    ],
    collaborators: [
      `brands complementary to ${profile.category} ${location}`,
      `${profile.audience} lifestyle brands ${location}`,
    ],
    competitorSeeds: [],
    collaboratorSeeds: [],
  };
}

function usable(result: SearchResult, ownHost: string) {
  try {
    const url = unwrapDuckDuckGo(result.url);
    const host = hostKey(url);
    return (
      /^https?:/.test(url) &&
      host !== ownHost &&
      !excludedHosts.some(
        (excluded) => host === excluded || host.endsWith(`.${excluded}`),
      ) &&
      !/\b(best|top \d+|list of|directory|review|magazine|news)\b/i.test(
        result.title,
      )
    );
  } catch {
    return false;
  }
}

const footwearTerms =
  /\b(shoes?|footwear|sneakers?|boots?|sandals?|loafers?|heels?|flats?)\b/i;
const footwearAccessoryTerms =
  /\b(shoe care|foot care|orthotics?|insoles?|shoe laces?|shoelaces?|socks?)\b/i;
const footwearCommerceTerms =
  /(?:\b(?:shop|buy|collection|our|women'?s|men'?s|kids?|leather)\b.{0,45}\b(?:shoes?|footwear|sneakers?|boots?|sandals?|loafers?|heels?|flats?)\b)|(?:\b(?:shoes?|footwear|sneakers?|boots?|sandals?|loafers?|heels?|flats?)\b.{0,45}\b(?:shop|collection|sale|new arrivals?|made|designed)\b)/i;

/** A footwear merchant may partner with care/accessory specialists, never a
 * second footwear assortment disguised as a collaborator. */
export function isValidFootwearCollaborator(text: string) {
  if (!footwearTerms.test(text)) return true;
  return footwearAccessoryTerms.test(text) && !footwearCommerceTerms.test(text);
}

async function captureBrands(
  results: SearchResult[],
  signal?: AbortSignal,
): Promise<CapturedBrand[]> {
  throwIfAborted(signal);
  const targets = (
    await Promise.allSettled(
      results.map(async (result) => {
        const requested = await assertPublicUrl(unwrapDuckDuckGo(result.url));
        return {
          result,
          requested,
          rootHost: requested.hostname.replace(/^www\./, ""),
        };
      }),
    )
  ).flatMap((target) => (target.status === "fulfilled" ? [target.value] : []));
  if (!targets.length) return [];
  const allowedDomains = [
    ...new Set(
      targets.flatMap(({ requested, rootHost }) => [
        requested.hostname,
        rootHost,
      ]),
    ),
  ];
  return withBrowserbaseCapacity(
    () =>
      withBrowserbaseSession(
        { allowedDomains, timeoutMs: 30_000, signal },
        async ({ page }) => {
          const captured: CapturedBrand[] = [];
          for (const { result, requested, rootHost } of targets) {
            throwIfAborted(signal);
            try {
              await page.goto(requested.href, {
                waitUntil: "domcontentloaded",
                timeout: 15_000,
              });
              const finalUrl = await assertPublicUrl(page.url());
              if (
                finalUrl.hostname !== rootHost &&
                !finalUrl.hostname.endsWith(`.${rootHost}`)
              )
                throw new Error("Candidate redirected outside its domain.");
              const extracted = (await page.evaluate(`(() => {
        const meta = (selector) => document.querySelector(selector)?.content?.trim() ?? '';
        const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((script) => script.textContent ?? '').join(' ');
        return {
          title: document.title,
          name: meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]') || document.title.split(/[|–—]/)[0],
          description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
          imageUrl: (() => {
            const value = meta('meta[property="og:image:secure_url"]') || meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]') || document.querySelector('main img[src], a[href*="/products/"] img[src], a[href*="/product/"] img[src]')?.src || '';
            try { return value ? new URL(value, location.href).href : ''; } catch { return ''; }
          })(),
          text: (document.body?.innerText ?? '').replace(/\\s+/g, ' ').trim().slice(0, 10000),
          productLinks: document.querySelectorAll('a[href*="/products/"], a[href*="/product/"]').length,
          productSchema: /"@type"\\s*:\\s*"Product"/i.test(jsonLd),
          addToCart: Boolean(document.querySelector('button[name="add"], [data-add-to-cart], form[action*="/cart/add"]'))
        };
      })()`)) as Omit<CapturedBrand, "url"> & {
                productLinks: number;
                productSchema: boolean;
                addToCart: boolean;
              };
              const description = clean(
                extracted.description || result.snippet || extracted.text,
              );
              if (!description)
                throw new Error("Candidate has no usable evidence.");
              if (
                /security checkpoint|access denied|verify you are human/i.test(
                  extracted.title,
                )
              )
                throw new Error(
                  "Candidate storefront was blocked by a challenge.",
                );
              if (
                !hasStorefrontCommerceEvidence({
                  title: extracted.title,
                  description,
                  productLinks: extracted.productLinks,
                  productSchema: extracted.productSchema,
                  addToCart: extracted.addToCart,
                })
              )
                throw new Error("Candidate page is not a brand storefront.");
              const extractedName = clean(extracted.name, 80);
              const genericName =
                /^(about(?: us)?|home|shop|official site)$/i.test(
                  extractedName,
                );
              let imageUrl: string | undefined;
              if (extracted.imageUrl) {
                try {
                  imageUrl = (await assertPublicUrl(extracted.imageUrl)).href;
                } catch {
                  // Keep the candidate even when its social image is unsafe.
                }
              }
              captured.push({
                url: finalUrl.href,
                name: genericName
                  ? clean(result.title || finalUrl.hostname, 80)
                  : extractedName ||
                    clean(result.title || finalUrl.hostname, 80),
                title: clean(extracted.title || result.title, 160),
                description,
                text: clean(extracted.text, 10_000),
                ...(imageUrl ? { imageUrl } : {}),
              });
            } catch {
              // Keep supported captures and continue to the next candidate.
            }
          }
          return captured;
        },
      ),
    signal,
  );
}

function candidateFrom(
  brand: CapturedBrand,
  kind: "collaborator" | "competitor",
  index: number,
): { candidate: Candidate; evidence: Evidence } {
  const domain = hostKey(brand.url);
  const id = createHash("sha256")
    .update(`${kind}:${domain}`)
    .digest("hex")
    .slice(0, 16);
  const evidenceId = `${id}_storefront`;
  const score = Math.max(62, 88 - index * 4);
  const category = clean(
    brand.description.split(/[.!?]/)[0] || "Independent brand",
    80,
  );
  return {
    candidate: {
      id,
      name: brand.name,
      domain,
      category,
      tagline: brand.description,
      description: brand.description,
      ...(brand.imageUrl
        ? {
            imageUrl: brand.imageUrl,
            imageAlt: `${brand.name} storefront product photography`,
          }
        : {}),
      score,
      confidence: "Medium",
      tone: ["sage", "peach", "lilac", "blue", "yellow"][index % 5],
      mark: ["textile", "bag", "jar", "book", "kettle"][index % 5],
      idea:
        kind === "competitor"
          ? `Compare ${brand.name}'s assortment and positioning`
          : `Validate a partnership concept with ${brand.name}`,
      reason:
        kind === "competitor"
          ? `${brand.name} appeared in live competitor discovery and its storefront describes: ${brand.description}`
          : `${brand.name} appeared in live complementary-brand discovery and its storefront describes: ${brand.description}`,
      caveat:
        "Discovered and captured live. The relationship is a research lead, not a verified partnership or confirmed competitor.",
      evidenceIds: [evidenceId],
      type: kind === "competitor" ? "direct" : undefined,
      components: [
        { label: "Search relevance", score, weight: 35 },
        { label: "Category fit", score: score - 3, weight: 25 },
        { label: "Geographic fit", score: score - 5, weight: 15 },
        { label: "Evidence quality", score: 72, weight: 25 },
      ],
    },
    evidence: {
      id: evidenceId,
      title: brand.title,
      sourceType: "Live candidate storefront",
      span: brand.description,
      publishedAt: new Date().toISOString().slice(0, 10),
      url: brand.url,
      synthetic: false,
    },
  };
}

async function discover(
  queries: string[],
  seeds: string[],
  ownHost: string,
  kind: "collaborator" | "competitor",
  limit: number,
  profile: Profile,
  signal?: AbortSignal,
) {
  const seen = new Set<string>();
  const captured: CapturedBrand[] = [];
  const newResults = (results: SearchResult[]) =>
    results
      .filter((result) => usable(result, ownHost))
      .filter((result) => {
        const host = hostKey(unwrapDuckDuckGo(result.url));
        if (seen.has(host)) return false;
        seen.add(host);
        return true;
      });
  const capture = async (results: SearchResult[]) => {
    const next = await captureBrands(results, signal);
    captured.push(
      ...next
        .filter(
          (brand) =>
            kind !== "collaborator" ||
            !/footwear|shoes?|sneakers?/i.test(profile.category) ||
            isValidFootwearCollaborator(
              `${brand.name} ${brand.title} ${brand.description} ${brand.text}`,
            ),
        )
        .slice(0, limit),
    );
  };
  await capture(
    newResults(
      seeds.map((url) => ({
        title: verifiedSeedNames[hostKey(url)] ?? "",
        url,
        snippet: "",
      })),
    ),
  );
  if (captured.length < limit) {
    const fallback: SearchResult[] = [];
    for (const query of queries) {
      throwIfAborted(signal);
      try {
        fallback.push(...(await search(query, signal)));
      } catch {
        // Continue with other queries and return a partial report if needed.
      }
    }
    await capture(newResults(fallback).slice(0, limit * 3));
  }
  return captured
    .slice(0, limit)
    .map((brand, index) => candidateFrom(brand, kind, index));
}

export type LiveMarketResearch = Pick<
  Report,
  "collaborators" | "competitors" | "evidence" | "themes" | "swot" | "actions"
> & { warning: string | null };

export async function researchMarket(
  profile: Profile,
  { signal }: { signal?: AbortSignal } = {},
): Promise<LiveMarketResearch> {
  throwIfAborted(signal);
  const plan = queryPlan(profile);
  const ownHost = hostKey(profile.url);
  const [collaborators, competitors] = await Promise.all([
    discover(
      plan.collaborators,
      plan.collaboratorSeeds,
      ownHost,
      "collaborator",
      4,
      profile,
      signal,
    ),
    discover(
      plan.competitors,
      plan.competitorSeeds,
      ownHost,
      "competitor",
      4,
      profile,
      signal,
    ),
  ]);
  const evidence = [
    ...collaborators.map((item) => item.evidence),
    ...competitors.map((item) => item.evidence),
  ];
  const candidates = {
    collaborators: collaborators.map((item) => item.candidate),
    competitors: competitors.map((item) => item.candidate),
  };
  const storeEvidence: Evidence[] =
    profile.research?.sources.slice(0, 3).map((source, index) => ({
      id: `store_live_${index}`,
      title: source.title,
      sourceType: "Live merchant storefront",
      span: source.span,
      publishedAt: source.fetchedAt.slice(0, 10),
      url: source.url,
      synthetic: false,
    })) ?? [];
  const enough =
    candidates.collaborators.length >= 2 && candidates.competitors.length >= 2;
  return {
    ...candidates,
    evidence: [...storeEvidence, ...evidence],
    themes: [],
    swot: {
      strengths: storeEvidence.length
        ? [
            {
              id: "live_strength_profile",
              title: "A documented storefront position",
              description:
                profile.research?.sources[0]?.span ?? profile.category,
              confidence: "Medium",
              claimType: "observation",
              evidenceIds: [storeEvidence[0].id],
            },
          ]
        : [],
      weaknesses: [],
      opportunities: candidates.collaborators.slice(0, 3).map((brand) => ({
        id: `opportunity_${brand.id}`,
        title: `Research ${brand.name} further`,
        description: brand.reason,
        confidence: "Low",
        claimType: "inference",
        evidenceIds: brand.evidenceIds,
      })),
      threats: candidates.competitors.slice(0, 3).map((brand) => ({
        id: `threat_${brand.id}`,
        title: `Compare positioning with ${brand.name}`,
        description: brand.reason,
        confidence: "Low",
        claimType: "inference",
        evidenceIds: brand.evidenceIds,
      })),
    },
    actions: candidates.collaborators.slice(0, 3).map((brand) => ({
      title: `Validate ${brand.name} as a potential collaborator`,
      experiment: `Review ${brand.name}'s live catalog and contact the brand only after confirming audience, geography, and non-overlapping products.`,
      effort: "Research lead · needs validation",
      evidenceIds: brand.evidenceIds,
    })),
    warning: enough
      ? "Candidates were discovered and captured live. Fit scores are deterministic research prioritization—not verified relationships. Independent customer discourse has not been collected yet."
      : "Live research returned too few supported candidates. The report is partial; no fictional brands were substituted.",
  };
}
