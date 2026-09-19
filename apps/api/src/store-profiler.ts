import { createHash } from "node:crypto";
import type {
  ProfileFields,
  ProfileResearch,
} from "../../../packages/contracts/src/index";
import { withBrowserbaseSession } from "./browserbase";
import { assertPublicUrl, assertRobotsAllowed } from "./url-safety";

type PageExtraction = {
  url: string;
  title: string;
  description: string;
  imageUrl: string;
  siteName: string;
  headings: string[];
  text: string;
  links: string[];
  jsonLd: unknown[];
  generator: string;
  shopifyGlobals: boolean;
};

function clean(value: unknown, limit = 240) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, limit)
    : "";
}

function strings(value: unknown, key: string): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item) => strings(item, key));
  const record = value as Record<string, unknown>;
  return [
    ...(typeof record[key] === "string" ? [record[key] as string] : []),
    ...Object.values(record).flatMap((item) => strings(item, key)),
  ];
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => clean(value)).filter(Boolean))];
}

function categoryFrom(pages: PageExtraction[], fallback: string) {
  const candidates = unique(
    pages.flatMap((page) => [
      ...page.jsonLd.flatMap((item) => strings(item, "category")),
      ...page.jsonLd.flatMap((item) => strings(item, "productType")),
    ]),
  );
  if (clean(candidates[0], 120)) return clean(candidates[0], 120);
  const description = pages
    .map((page) => `${page.description} ${page.headings.join(" ")}`)
    .join(" ")
    .toLowerCase();
  const categories: [RegExp, string][] = [
    [
      /\b(activewear|gym wear|gymwear|workout|training (?:wear|clothes)|performance apparel|sportswear|fitness apparel|athleisure)\b/,
      "Activewear & fitness apparel",
    ],
    [/\b(shoes?|sneakers?|footwear)\b/, "Footwear & apparel"],
    [/\b(coffee|espresso|roast(?:er|ed)?)\b/, "Coffee & tea"],
    [/\b(skincare|cosmetics?|beauty|makeup)\b/, "Beauty & personal care"],
    [/\b(apparel|clothing|fashion)\b/, "Apparel"],
    [/\b(furniture|home decor|housewares?)\b/, "Home & living"],
    [/\b(food|snacks?|pantry|grocery)\b/, "Food & beverage"],
    [/\b(jewelry|jewellery|accessories)\b/, "Jewelry & accessories"],
    [/\b(pet food|pets?|dogs?|cats?)\b/, "Pet supplies"],
  ];
  return (
    categories.find(([pattern]) => pattern.test(description))?.[1] ?? fallback
  );
}

function productNames(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(productNames);
  const record = value as Record<string, unknown>;
  const types = Array.isArray(record["@type"])
    ? record["@type"]
    : [record["@type"]];
  const own =
    types.includes("Product") && typeof record.name === "string"
      ? [record.name]
      : [];
  return [...own, ...Object.values(record).flatMap(productNames)];
}

function storeNameFrom(home: PageExtraction, fallback: string) {
  const structured = unique([
    ...home.jsonLd.flatMap((item) => strings(item, "name")),
  ]).find((name) => name.length <= 80);
  const title = clean(home.title.split(/[|–—]/)[0], 80);
  return clean(home.siteName, 80) || structured || title || fallback;
}

async function extract(
  page: import("playwright-core").Page,
): Promise<PageExtraction> {
  // A source string keeps build-tool helper functions out of the remote page.
  return (await page.evaluate(`(() => {
    const meta = (selector) => document.querySelector(selector)?.content?.trim() ?? "";
    const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).flatMap((script) => {
      try {
        const parsed = JSON.parse(script.textContent ?? "null");
        return parsed ? [parsed] : [];
      } catch {
        return [];
      }
    });
    return {
      url: location.href,
      title: document.title,
      description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
      imageUrl: (() => {
        const value = meta('meta[property="og:image:secure_url"]') || meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]');
        try { return value ? new URL(value, location.href).href : ''; } catch { return ''; }
      })(),
      siteName: meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]'),
      headings: Array.from(document.querySelectorAll("h1, h2"))
        .map((node) => node.textContent?.replace(/\\s+/g, " ").trim() ?? "")
        .filter(Boolean)
        .slice(0, 12),
      text: (document.body?.innerText ?? "").replace(/\\s+/g, " ").trim().slice(0, 12000),
      links: Array.from(document.querySelectorAll("a[href]")).map((anchor) => anchor.href).filter(Boolean),
      jsonLd,
      generator: meta('meta[name="generator"]'),
      shopifyGlobals: Boolean(window.Shopify || document.querySelector('[href*="cdn.shopify.com"], [src*="cdn.shopify.com"]')),
    };
  })()`)) as PageExtraction;
}

export async function profileStorefront(input: ProfileFields) {
  const target = await assertPublicUrl(input.url);
  await assertRobotsAllowed(target);
  const allowedDomains = unique([
    target.hostname,
    target.hostname.replace(/^www\./i, ""),
  ]);

  return withBrowserbaseSession(
    { allowedDomains, timeoutMs: 45_000 },
    async ({ page, sessionId }) => {
      const pages: PageExtraction[] = [];
      const visit = async (url: string) => {
        try {
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 20_000,
          });
          const finalUrl = await assertPublicUrl(page.url());
          if (
            !allowedDomains.some(
              (domain) =>
                finalUrl.hostname === domain ||
                finalUrl.hostname.endsWith(`.${domain}`),
            )
          )
            throw new Error(
              "The store redirected outside its approved domain.",
            );
          pages.push(await extract(page));
        } catch (error) {
          if (!pages.length) throw error;
        }
      };

      await visit(target.href);
      const home = pages[0];
      const sameSite = unique(home.links).filter((href) => {
        try {
          const url = new URL(href);
          return allowedDomains.some(
            (domain) =>
              url.hostname === domain || url.hostname.endsWith(`.${domain}`),
          );
        } catch {
          return false;
        }
      });
      const selected = [
        sameSite.find((url) =>
          /\/(?:about|our-story|mission|values)(?:[-_/]|$)/i.test(
            new URL(url).pathname,
          ),
        ),
        sameSite.find((url) =>
          /\/collections?(?:\/|$)/i.test(new URL(url).pathname),
        ),
        ...sameSite
          .filter((url) => /\/products?\//i.test(new URL(url).pathname))
          .slice(0, 3),
      ].filter((url): url is string => Boolean(url));
      for (const url of unique(selected).slice(0, 5)) await visit(url);

      const allText = pages.map((item) => item.text).join(" ");
      const shopifySignals = unique([
        ...pages
          .filter((item) => item.shopifyGlobals)
          .map(() => "Shopify browser runtime or CDN assets"),
        ...pages
          .filter((item) => /shopify/i.test(item.generator))
          .map(() => "Shopify generator metadata"),
        ...(/cdn\.shopify\.com|Shopify\.theme|shopify-section/i.test(allText)
          ? ["Shopify markup signals"]
          : []),
        ...(pages.some((item) =>
          item.jsonLd
            .flatMap((data) => strings(data, "@type"))
            .includes("Product"),
        )
          ? ["Product structured data"]
          : []),
      ]);
      const shopifyConfidence = Math.min(
        100,
        shopifySignals.reduce(
          (score, signal) => score + (signal.includes("runtime") ? 45 : 20),
          0,
        ),
      );
      const fetchedAt = new Date().toISOString();
      const sources = await Promise.all(
        pages.map(async (item) => {
          let imageUrl: string | undefined;
          if (item.imageUrl) {
            try {
              imageUrl = (await assertPublicUrl(item.imageUrl)).href;
            } catch {
              // A page image is optional; unsafe or malformed URLs are omitted.
            }
          }
          return {
            url: item.url,
            title: clean(item.title, 160) || new URL(item.url).hostname,
            span: clean(
              item.description || item.headings.join(" · ") || item.text,
              400,
            ),
            ...(imageUrl ? { imageUrl } : {}),
            sourceType: item === home ? "storefront" : "storefront page",
            fetchedAt,
            contentHash: createHash("sha256").update(item.text).digest("hex"),
          };
        }),
      );
      const products = unique(
        pages.flatMap((item) => item.jsonLd.flatMap(productNames)),
      ).slice(0, 12);
      const research: ProfileResearch = {
        sessionId,
        shopifyConfidence,
        shopifySignals,
        pagesVisited: pages.length,
        sources,
        products,
      };
      return {
        ...input,
        url: home.url,
        name: storeNameFrom(home, input.name),
        category: categoryFrom(pages, input.category),
        audience: clean(home.description, 240) || input.audience,
        research,
      };
    },
  );
}
