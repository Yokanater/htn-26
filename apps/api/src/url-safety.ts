import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const blockedNames = /(^localhost$|\.localhost$|\.local$|\.internal$)/i;

function blockedIpv4(address: string) {
  const [a, b] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function blockedIp(address: string) {
  if (isIP(address) === 4) return blockedIpv4(address);
  const value = address.toLowerCase().split("%")[0];
  if (value.startsWith("::ffff:")) return blockedIpv4(value.slice(7));
  return (
    value === "::" ||
    value === "::1" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    /^fe[89ab]/.test(value) ||
    value.startsWith("2001:db8:")
  );
}

export async function assertPublicUrl(input: string) {
  const url = new URL(input);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port)) ||
    blockedNames.test(url.hostname) ||
    !url.hostname.includes(".")
  )
    throw new Error(
      "Enter a public HTTP or HTTPS store URL without credentials.",
    );

  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => blockedIp(address)))
    throw new Error("The store URL resolves to a private or reserved address.");
  return url;
}

export async function fetchPublicText(
  input: string,
  { timeoutMs = 8_000, maxBytes = 256_000, redirects = 3 } = {},
) {
  let url = await assertPublicUrl(input);
  for (let count = 0; count <= redirects; count++) {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "GroveResearchBot/0.1" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || count === redirects)
        throw new Error("Too many redirects.");
      url = await assertPublicUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok)
      throw new Error(`Fetch failed with HTTP ${response.status}.`);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > maxBytes)
      throw new Error("Response is larger than the crawl limit.");
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes)
      throw new Error("Response is larger than the crawl limit.");
    return {
      url,
      text,
      contentType: response.headers.get("content-type") ?? "",
    };
  }
  throw new Error("Could not fetch the URL.");
}

export async function assertRobotsAllowed(target: URL) {
  try {
    const { text } = await fetchPublicText(new URL("/robots.txt", target).href);
    const groups = text.split(/^\s*user-agent\s*:/im);
    const wildcard = groups.find((group) =>
      /^\s*\*\s*$/m.test(group.split(/\r?\n/, 1)[0]),
    );
    if (wildcard && /^\s*disallow\s*:\s*\/\s*(?:#.*)?$/im.test(wildcard))
      throw new Error("This site disallows automated crawling in robots.txt.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("disallows"))
      throw error;
    // A missing or unavailable robots.txt does not imply a blanket crawl ban.
  }
}
