/** Shared JSON-LD reading. Owner: L1.
 * Handles the shapes real storefronts emit: one node, an array of nodes, `@graph`, and nodes
 * nested inside other nodes. Malformed blocks are skipped; nothing is inferred from a missing key.
 */

const LD_SCRIPT = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const MAX_DEPTH = 8;

/** Parsed contents of every `application/ld+json` block in the document. */
export function extractJsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  for (const match of html.matchAll(LD_SCRIPT)) {
    try {
      const parsed: unknown = JSON.parse(match[1] ?? 'null');
      if (parsed) out.push(parsed);
    } catch {
      // A malformed block proves nothing; keep reading the rest.
    }
  }
  return out;
}

/** Every object node reachable through arrays, `@graph` and nested values, outermost first. */
export function collectJsonLdNodes(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > MAX_DEPTH || !value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectJsonLdNodes(item, depth + 1));
  const record = value as Record<string, unknown>;
  return [
    record,
    ...Object.values(record).flatMap((child) => collectJsonLdNodes(child, depth + 1)),
  ];
}

/** Lowercased `@type` names with any schema.org URL prefix removed. */
export function jsonLdTypes(node: Record<string, unknown>): string[] {
  const raw = node['@type'];
  return (Array.isArray(raw) ? raw : [raw])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.split(/[/#]/).pop()?.toLowerCase() ?? '')
    .filter(Boolean);
}

export function hasJsonLdType(node: Record<string, unknown>, type: string): boolean {
  return jsonLdTypes(node).includes(type.toLowerCase());
}

export function cleanJsonLdText(value: unknown, limit = 240): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

/** Product names explicitly stated by JSON-LD. A merchant claim, never observed shopper demand. */
export function productNamesFromJsonLd(value: unknown): string[] {
  return collectJsonLdNodes(value)
    .filter((node) => hasJsonLdType(node, 'product'))
    .map((node) => cleanJsonLdText(node.name, 120))
    .filter(Boolean);
}
