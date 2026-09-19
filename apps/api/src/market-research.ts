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
  "lululemon.com": "lululemon",
  "oneractive.com": "Oner Active",
  "alphaleteathletics.com": "Alphalete",
  "ryderwear.com": "Ryderwear",
  "blenderbottle.com": "BlenderBottle",
  "therabody.com": "Therabody",
  "manduka.com": "Manduka",
  "hydroflask.com": "Hydro Flask",
};

export type MarketSegment =
  | "activewear"
  | "footwear"
  | "apparel"
  | "coffee"
  | "beauty"
  | "home"
  | "food"
  | "jewelry"
  | "pet"
  | "general";

/** Uses the complete captured profile, so a generic Shopify category such as
 * "Apparel" can still resolve to the merchant's actual market. */
export function marketSegment(profile: Profile): MarketSegment {
  const corpus = [
    profile.name,
    profile.category,
    profile.audience,
    profile.goal,
    ...(profile.research?.products ?? []),
    ...(profile.research?.sources.flatMap((source) => [
      source.title,
      source.span,
    ]) ?? []),
  ].join(" ");
  if (
    /\b(gymshark|activewear|gym ?wear|workout|training|fitness|athleisure|sportswear|performance (?:apparel|wear)|leggings?|sports bra)\b/i.test(
      corpus,
    )
  )
    return "activewear";
  if (/\b(footwear|shoes?|sneakers?|boots?|sandals?|loafers?)\b/i.test(corpus))
    return "footwear";
  if (/\b(coffee|espresso|roast(?:er|ed)?|tea)\b/i.test(corpus))
    return "coffee";
  if (/\b(skincare|cosmetics?|beauty|makeup)\b/i.test(corpus)) return "beauty";
  if (/\b(furniture|home decor|housewares?)\b/i.test(corpus)) return "home";
  if (/\b(food|snacks?|pantry|grocery)\b/i.test(corpus)) return "food";
  if (/\b(jewelry|jewellery)\b/i.test(corpus)) return "jewelry";
  if (/\b(pet food|pets?|dogs?|cats?)\b/i.test(corpus)) return "pet";
  if (/\b(apparel|clothing|fashion|vintage)\b/i.test(corpus)) return "apparel";
  return "general";
}

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
  const segment = marketSegment(profile);
  if (segment === "activewear")
    return {
      competitors: [
        `${profile.name} activewear competitors performance apparel official store`,
        `training apparel gymwear brands ${location} official store`,
      ],
      collaborators: [
        `fitness recovery mobility brand ${location} official store`,
        `workout hydration gym accessories brand ${location} official store`,
        `yoga mat training equipment brand ${location} official store`,
      ],
      competitorSeeds: [
        "https://shop.lululemon.com/",
        "https://www.oneractive.com/collections/shop-all",
        "https://alphaleteathletics.com/collections/womens",
        "https://au.ryderwear.com/collections/womens-gym-wear",
      ],
      collaboratorSeeds: [
        "https://www.blenderbottle.com/",
        "https://www.therabody.com/",
        "https://www.manduka.com/",
        "https://www.hydroflask.com/",
      ],
    };
  if (segment === "footwear")
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
  if (segment === "apparel")
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
      !host.endsWith(`.${ownHost}`) &&
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

const activewearTerms =
  /\b(activewear|gym ?wear|workout (?:wear|clothes)|training (?:wear|apparel)|fitness apparel|athleisure|sportswear|leggings?|sports bras?|performance apparel)\b/i;
const activewearComplementTerms =
  /\b(recovery|massage|mobility|foam roll|hydration|water bottle|shaker|yoga mat|training equipment|gym accessories|resistance band|fitness tech|wearable|gym bag|duffel|nutrition|protein|electrolyte)\b/i;
const unrelatedLifestyleTerms =
  /\b(candles?|fragrance|perfume|home scent|diffuser|jewelry|jewellery|stationery|home decor|tableware|ceramics?)\b/i;

export function isCompatibleCandidate(
  profile: Profile,
  text: string,
  kind: "collaborator" | "competitor",
) {
  const segment = marketSegment(profile);
  if (segment === "footwear" && kind === "collaborator")
    return isValidFootwearCollaborator(text);
  if (segment === "activewear") {
    if (kind === "competitor") return activewearTerms.test(text);
    return (
      activewearComplementTerms.test(text) &&
      !unrelatedLifestyleTerms.test(text) &&
      !activewearTerms.test(text)
    );
  }
  return true;
}

function candidateCategory(text: string) {
  const categories: [RegExp, string][] = [
    [/\b(massage|recovery|mobility|therapy)\b/i, "Recovery & mobility"],
    [/\b(water bottle|hydration|shaker|electrolyte)\b/i, "Hydration"],
    [
      /\b(yoga mat|training equipment|resistance band|gym accessories)\b/i,
      "Training accessories",
    ],
    [
      /\b(activewear|gym ?wear|athleisure|sportswear|leggings?|sports bra)\b/i,
      "Activewear",
    ],
    [/\b(shoes?|footwear|sneakers?|boots?|sandals?)\b/i, "Footwear"],
    [/\b(skincare|beauty|cosmetics?|makeup)\b/i, "Beauty"],
    [/\b(coffee|espresso|tea)\b/i, "Coffee & tea"],
    [/\b(jewelry|jewellery)\b/i, "Jewelry"],
    [/\b(candle|fragrance|perfume)\b/i, "Home fragrance"],
    [/\b(apparel|clothing|fashion)\b/i, "Apparel"],
  ];
  return (
    categories.find(([pattern]) => pattern.test(text))?.[1] ??
    "Independent brand"
  );
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
            const productImage = Array.from(document.querySelectorAll('a[href*="/products/"] img, a[href*="/product/"] img, [data-product-card] img, .product-card img')).find((image) => {
              const value = [image.getAttribute('alt'), image.getAttribute('src'), image.getAttribute('data-src'), image.getAttribute('srcset')].filter(Boolean).join(' ');
              return !/logo|gift|icon|placeholder|\\.svg(?:\\?|$)/i.test(value);
            });
            const srcset = productImage?.getAttribute('srcset') || productImage?.getAttribute('data-srcset') || '';
            const srcsetUrl = srcset.split(',').map((entry) => entry.trim().split(/\\s+/)[0]).filter(Boolean).at(-1) || '';
            const productValue = srcsetUrl || productImage?.getAttribute('data-src') || productImage?.currentSrc || productImage?.getAttribute('src') || '';
            const value = productValue || meta('meta[property="og:image:secure_url"]') || meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]') || document.querySelector('main img[src]')?.src || '';
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
                /^(about(?: us)?|home|shop|official site|all products|products|collections?)$/i.test(
                  extractedName,
                );
              const verifiedName =
                verifiedSeedNames[rootHost] ??
                Object.entries(verifiedSeedNames).find(
                  ([host]) =>
                    rootHost === host || rootHost.endsWith(`.${host}`),
                )?.[1];
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
                name: verifiedName
                  ? verifiedName
                  : genericName
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
  profile: Profile,
): { candidate: Candidate; evidence: Evidence } {
  const domain = hostKey(brand.url);
  const id = createHash("sha256")
    .update(`${kind}:${domain}`)
    .digest("hex")
    .slice(0, 16);
  const evidenceId = `${id}_storefront`;
  const corpus = `${brand.name} ${brand.title} ${brand.description} ${brand.text}`;
  const segment = marketSegment(profile);
  const explicitFit =
    segment === "activewear"
      ? kind === "competitor"
        ? activewearTerms.test(corpus)
        : activewearComplementTerms.test(corpus)
      : segment === "footwear"
        ? kind === "competitor"
          ? footwearTerms.test(corpus)
          : footwearAccessoryTerms.test(corpus) || !footwearTerms.test(corpus)
        : new RegExp(profile.category.split(/\s|&/)[0] || "brand", "i").test(
            corpus,
          );
  const categoryFit = explicitFit ? 94 : 72;
  const evidenceQuality = brand.description.length > 100 ? 86 : 74;
  const score = Math.max(
    64,
    Math.round(
      categoryFit * 0.55 +
        evidenceQuality * 0.3 +
        Math.max(55, 82 - index * 4) * 0.15,
    ),
  );
  const category = candidateCategory(corpus);
  return {
    candidate: {
      id,
      name: brand.name,
      domain,
      category:
        segment === "activewear" && kind === "competitor"
          ? "Activewear"
          : category,
      tagline: brand.description,
      description: brand.description,
      ...(brand.imageUrl
        ? {
            imageUrl: brand.imageUrl,
            imageAlt: `${brand.name} storefront product photography`,
          }
        : {}),
      score,
      confidence: explicitFit && evidenceQuality >= 80 ? "High" : "Medium",
      tone: ["sage", "peach", "lilac", "blue", "yellow"][index % 5],
      mark: ["textile", "bag", "jar", "book", "kettle"][index % 5],
      idea:
        kind === "competitor"
          ? `Map ${brand.name}'s assortment, promise, and price position`
          : segment === "activewear"
            ? `Pair training apparel with ${brand.name}'s ${category.toLowerCase()} experience`
            : `Test a useful cross-brand bundle with ${brand.name}`,
      reason:
        kind === "competitor"
          ? `${brand.name} appeared in live competitor discovery and its storefront describes: ${brand.description}`
          : `${brand.name} appeared in live complementary-brand discovery and its storefront describes: ${brand.description}`,
      caveat:
        "Discovered and captured live. The relationship is a research lead, not a verified partnership or confirmed competitor.",
      evidenceIds: [evidenceId],
      type: kind === "competitor" ? "direct" : undefined,
      components: [
        { label: "Category compatibility", score: categoryFit, weight: 40 },
        { label: "Evidence quality", score: evidenceQuality, weight: 30 },
        {
          label: "Search relevance",
          score: Math.max(55, 82 - index * 4),
          weight: 20,
        },
        { label: "Geographic fit", score: 72, weight: 10 },
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
        .filter((brand) =>
          isCompatibleCandidate(
            profile,
            `${brand.name} ${brand.title} ${brand.description} ${brand.text}`,
            kind,
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
    .map((brand, index) => candidateFrom(brand, kind, index, profile));
}

export type LiveMarketResearch = Pick<
  Report,
  "collaborators" | "competitors" | "evidence" | "themes" | "swot" | "actions"
> & { warning: string | null };

export function buildEvidenceLedStrategy(
  profile: Profile,
  collaborators: Candidate[],
  competitors: Candidate[],
  storeEvidence: Evidence[],
) {
  const primary = storeEvidence[0];
  const evidenceIds = primary ? [primary.id] : [];
  const products = profile.research?.products ?? [];
  const pages = profile.research?.pagesVisited ?? 0;
  const shopifyConfidence = profile.research?.shopifyConfidence ?? 0;
  const segmentLabel =
    marketSegment(profile) === "activewear"
      ? "activewear and training"
      : profile.category.toLowerCase();
  const strengths = primary
    ? [
        {
          id: "live_strength_position",
          title: `Clear ${segmentLabel} position`,
          description: primary.span,
          confidence: "High",
          claimType: "observation" as const,
          evidenceIds,
        },
        ...(storeEvidence.length >= 2
          ? [
              {
                id: "live_strength_consistency",
                title: `Positioning holds across ${storeEvidence.length} captured pages`,
                description: `The storefront, brand pages, and collection pages consistently reinforce the same ${segmentLabel} market position.`,
                confidence: "Medium",
                claimType: "inference" as const,
                evidenceIds: storeEvidence.map((item) => item.id),
              },
            ]
          : []),
        ...(products.length
          ? [
              {
                id: "live_strength_catalog",
                title: `${products.length} products captured for comparison`,
                description: `The storefront exposed products including ${products.slice(0, 3).join(", ")}, giving the analysis concrete assortment signals.`,
                confidence: "High",
                claimType: "observation" as const,
                evidenceIds,
              },
            ]
          : []),
        ...(storeEvidence.some((item) =>
          /\b(community|followers?|members?|manufacturer|based in|founded)\b/i.test(
            item.span,
          ),
        )
          ? [
              {
                id: "live_strength_story",
                title: "A concrete brand story is visible",
                description:
                  "The captured brand material includes company or community proof that can support partnership storytelling.",
                confidence: "Medium",
                claimType: "observation" as const,
                evidenceIds: storeEvidence
                  .filter((item) =>
                    /\b(community|followers?|members?|manufacturer|based in|founded)\b/i.test(
                      item.span,
                    ),
                  )
                  .map((item) => item.id),
              },
            ]
          : []),
        ...(shopifyConfidence >= 60
          ? [
              {
                id: "live_strength_storefront",
                title: "Strong commerce infrastructure signals",
                description: `The capture found ${profile.research?.shopifySignals.join(", ").toLowerCase() || "multiple storefront signals"}, supporting a ready-to-test digital partnership path.`,
                confidence: "Medium",
                claimType: "inference" as const,
                evidenceIds,
              },
            ]
          : []),
      ].slice(0, 3)
    : [];
  const weaknesses = primary
    ? [
        ...(pages < 3
          ? [
              {
                id: "live_weakness_depth",
                title: "Limited storefront evidence depth",
                description: `Only ${pages || 1} storefront page${pages === 1 ? " was" : "s were"} captured, so brand-story and assortment conclusions remain narrow.`,
                confidence: "High",
                claimType: "observation" as const,
                evidenceIds,
              },
            ]
          : []),
        ...(products.length < 4
          ? [
              {
                id: "live_weakness_catalog",
                title: "Thin machine-readable product sample",
                description: `The capture identified ${products.length} named product${products.length === 1 ? "" : "s"}; pricing and assortment breadth need a deeper catalog pass.`,
                confidence: "High",
                claimType: "observation" as const,
                evidenceIds,
              },
            ]
          : []),
        ...(shopifyConfidence < 60
          ? [
              {
                id: "live_weakness_structure",
                title: "Limited structured commerce signals",
                description:
                  "The storefront was identifiable, but the capture exposed limited product-level structure for price and assortment comparison.",
                confidence: "High",
                claimType: "observation" as const,
                evidenceIds,
              },
            ]
          : []),
        {
          id: "live_weakness_audience",
          title: "Audience differentiation needs validation",
          description: `The visible positioning targets “${profile.audience},” but storefront evidence alone cannot show which customer segment converts best.`,
          confidence: "Medium",
          claimType: "inference" as const,
          evidenceIds,
        },
      ].slice(0, 3)
    : [];
  const opportunities = collaborators.slice(0, 3).map((brand) => ({
    id: `opportunity_${brand.id}`,
    title: `${brand.name}: ${brand.category.toLowerCase()} partnership`,
    description: `${brand.idea}. The storefront evidence shows a complementary offer without duplicating ${profile.name}'s core category.`,
    confidence: brand.confidence,
    claimType: "inference" as const,
    evidenceIds: brand.evidenceIds,
  }));
  const threats = competitors.slice(0, 3).map((brand) => ({
    id: `threat_${brand.id}`,
    title: `${brand.name} competes for the same occasion`,
    description: `${brand.reason} Compare assortment, promise, and merchandising before choosing a response.`,
    confidence: brand.confidence,
    claimType: "inference" as const,
    evidenceIds: brand.evidenceIds,
  }));
  const actions = [
    collaborators[0]
      ? {
          title: `Prototype one bundle with ${collaborators[0].name}`,
          experiment: `Create a one-page concept pairing a hero ${profile.category.toLowerCase()} product with ${collaborators[0].category.toLowerCase()}; test message clarity with five target customers before outreach.`,
          effort: "1–2 days · concept test",
          evidenceIds: collaborators[0].evidenceIds,
        }
      : null,
    competitors[0]
      ? {
          title: `Run a positioning teardown of ${competitors[0].name}`,
          experiment:
            "Compare the first-screen promise, hero products, proof points, and price anchors. Write one positioning sentence that the competitor cannot credibly claim.",
          effort: "Half day · desk research",
          evidenceIds: competitors[0].evidenceIds,
        }
      : null,
    primary
      ? {
          title: "Close the biggest evidence gap",
          experiment:
            products.length < 4
              ? "Capture the full catalog and price ladder, then rerun the assortment comparison with product-level evidence."
              : "Interview five recent customers and compare their buying language with the storefront's visible positioning.",
          effort: "2–3 days · validation",
          evidenceIds,
        }
      : null,
  ].filter((action): action is NonNullable<typeof action> => Boolean(action));
  return { swot: { strengths, weaknesses, opportunities, threats }, actions };
}

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
  const strategy = buildEvidenceLedStrategy(
    profile,
    candidates.collaborators,
    candidates.competitors,
    storeEvidence,
  );
  return {
    ...candidates,
    evidence: [...storeEvidence, ...evidence],
    themes: [],
    ...strategy,
    warning: enough
      ? "Candidates were discovered and captured live. Fit scores are deterministic research prioritization—not verified relationships. Independent customer discourse has not been collected yet."
      : "Live research returned too few supported candidates. The report is partial; no fictional brands were substituted.",
  };
}
