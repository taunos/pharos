// 1.4.0 (report truthfulness r3): API / MCP evidence gathered from what other
// checks already read (Dim 1's /llms.txt, Dim 4's homepage), so Dim 2 and
// Dim 3 never call a site "content-only" or say "no MCP" while the site links
// its own MCP server or API. Only links on the audited site's own host or one
// of its subdomains count (a link to someone else's docs says nothing about
// this site). The fetches here are /robots.txt (1.5.2: stores advertise their
// MCP endpoint in its comments) and the GraphQL probes, which run only when
// the link evidence found nothing.
import { isSameSite, safeFetch } from "../safe-fetch";
import type { HomepageRead } from "./dim3-openapi";

const PROBE_TIMEOUT_MS = 5000;
const PROBE_MAX_BYTES = 64 * 1024;
/** Upper bound on URLs taken from one document (llms.txt or homepage). */
const MAX_URLS_PER_DOC = 5000;
/** Kept per kind; the first few are enough for a note and a probe. */
const MAX_KEPT = 5;

export type SiteSignals = {
  /** MCP endpoint URLs on the site's own host or a subdomain, as linked. */
  mcpUrls: string[];
  /** Human-readable API evidence, e.g. "a link to https://api.acme.com/docs". */
  apiSignals: string[];
};

export const NO_SIGNALS: SiteSignals = { mcpUrls: [], apiSignals: [] };

/** The audited site's base host: its hostname without a leading "www.". */
export function siteBase(siteUrl: string): string {
  return new URL(siteUrl).hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

/** true when `host` is the site's base host or one of its subdomains (defined in safe-fetch). */
export { isSameSite };

// 1.5.2 (RD-0120): product pages in the languages of the sites we scan. The
// English-only /products/ pattern missed drveit.com.br's /produtos/ page and
// the report said "We found no product pages". A path counts when it is one
// of these words (a product index, or a shop page) or one of them followed
// by one more segment (a product page), with an optional locale prefix
// (/en-br/products/x). "store" / "lojas" are left out: they are often store
// locators, not online shops.
const PRODUCT_WORDS = new Set([
  "product", "products", "produto", "produtos", "producto", "productos", "produit", "produits",
  "produkt", "produkte", "prodotto", "prodotti", "producten", "produkty", "produkter", "tuotteet",
]);
const SHOP_WORDS = new Set(["shop", "loja", "tienda", "boutique", "negozio", "winkel", "sklep", "butik"]);
const LOCALE_SEGMENT = /^[a-z]{2}(?:[-_][a-z]{2})?$/i;

/**
 * "detail" for a product page (/products/x, /produtos/x, /p/x), "listing" for
 * a product index or shop page (/produtos, /shop), null otherwise.
 */
export function productPathKind(pathname: string): "detail" | "listing" | null {
  let segs = pathname.split("/").filter(Boolean);
  let decoded: string[];
  try {
    decoded = segs.map((x) => decodeURIComponent(x).toLowerCase());
  } catch {
    return null;
  }
  if (decoded.length > 1 && LOCALE_SEGMENT.test(decoded[0]) && !PRODUCT_WORDS.has(decoded[0])) {
    decoded = decoded.slice(1);
    segs = segs.slice(1);
  }
  if (decoded.length === 2 && (PRODUCT_WORDS.has(decoded[0]) || decoded[0] === "p")) return "detail";
  if (decoded.length === 1 && (PRODUCT_WORDS.has(decoded[0]) || SHOP_WORDS.has(decoded[0]))) return "listing";
  return null;
}

/** A URL found in a document; `linked` is false for a bare URL in the text. */
export type FoundUrl = { url: URL; linked: boolean };

/** URLs in a text: Markdown link targets, HTML href values and bare http(s) URLs. Linear, bounded. */
export function extractUrls(text: string, base: string): FoundUrl[] {
  const out: FoundUrl[] = [];
  const seen = new Set<string>();
  const add = (raw: string, linked: boolean) => {
    if (out.length >= MAX_URLS_PER_DOC) return;
    // Trailing sentence punctuation is not part of a bare URL.
    const trimmed = raw.trim().replace(/[.,;:!?]+$/, "");
    let u: URL;
    try {
      u = new URL(trimmed, base);
    } catch {
      return;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") return;
    u.hash = "";
    const key = u.toString();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ url: u, linked });
  };
  // Each pattern is a literal prefix followed by one bounded character class,
  // so every exec is a linear forward scan.
  const patterns: Array<[RegExp, boolean]> = [
    [/\]\(([^()\s]{1,2048})\)/g, true], // Markdown [text](url)
    [/\bhref\s*=\s*["']([^"'<>\s]{1,2048})["']/gi, true], // HTML href
    [/https?:\/\/[^\s<>"'`()[\]{}]{1,2048}/g, false], // bare URL
  ];
  for (const [re, linked] of patterns) {
    let m: RegExpExecArray | null;
    let n = 0;
    while ((m = re.exec(text)) !== null && n++ < MAX_URLS_PER_DOC) add(m[1] ?? m[0], linked);
  }
  return out;
}

const API_HOST_LABELS = new Set(["api", "developer", "developers"]);
// "api" counts only as the whole path (/api, a docs page), never as a prefix:
// /api/og?... (social images), /api/auth/... are a site's own plumbing.
const API_PATH_SEGMENTS = new Set(["developer", "developers", "api-reference", "api-docs", "graphql"]);

/** An MCP endpoint URL: a host whose first label is "mcp", or a path segment that is exactly "mcp". */
export function isMcpUrl(u: URL): boolean {
  if (u.hostname.toLowerCase().split(".")[0] === "mcp") return true;
  return u.pathname.toLowerCase().split("/").includes("mcp");
}

function isApiUrl(u: URL, base: string): boolean {
  const host = u.hostname.toLowerCase();
  if (host !== base && API_HOST_LABELS.has(host.split(".")[0])) return true;
  const segs = u.pathname.toLowerCase().split("/").filter(Boolean).map((s) => s.replace(/\.md$/, ""));
  if (segs.length === 1 && (segs[0] === "api" || segs[0] === "apis")) return true;
  if (segs.length > 0 && API_PATH_SEGMENTS.has(segs[0])) return true;
  // /docs/api, /docs/api-reference ...
  return segs.length > 1 && segs[0] === "docs" && (segs[1] === "api" || API_PATH_SEGMENTS.has(segs[1]));
}

/** Link evidence only (no fetch). */
export function linkSignals(
  siteUrl: string,
  // mcpOnly: take MCP endpoint URLs only (robots.txt: its Sitemap / comment
  // URLs are not API documentation links).
  docs: Array<{ text: string; base: string; mcpOnly?: boolean } | null>
): SiteSignals {
  const base = siteBase(siteUrl);
  const mcpUrls: string[] = [];
  const apiSignals: string[] = [];
  for (const doc of docs) {
    if (!doc || !doc.text) continue;
    for (const { url: u, linked } of extractUrls(doc.text, doc.base)) {
      if (!isSameSite(u.hostname, base)) continue;
      const s = u.toString();
      if (isMcpUrl(u)) {
        if (mcpUrls.length < MAX_KEPT && !mcpUrls.includes(s)) mcpUrls.push(s);
      } else if (linked && !doc.mcpOnly && isApiUrl(u, base)) {
        // Only real links: a bare URL in a page's scripts is not a published API.
        const sig = `a link to ${s}`;
        if (apiSignals.length < MAX_KEPT && !apiSignals.includes(sig)) apiSignals.push(sig);
      }
    }
  }
  return { mcpUrls, apiSignals };
}

/** A GraphQL endpoint answers a bare GET with a JSON object carrying "errors" or "data" (HTML never counts). */
async function probeGraphql(url: string, base: string): Promise<boolean> {
  const r = await safeFetch(url, { headers: { Accept: "application/json" } }, { timeoutMs: PROBE_TIMEOUT_MS, sameSite: base });
  if (!r) return false;
  const ct = (r.headers.get("content-type") ?? "").toLowerCase();
  if (!ct.includes("json") || r.status >= 500) {
    r.discard();
    return false;
  }
  const b = await r.body({ maxBytes: PROBE_MAX_BYTES });
  if (!b.complete) return false;
  try {
    const j = JSON.parse(b.text) as unknown;
    return j !== null && typeof j === "object" && !Array.isArray(j) && ("errors" in j || "data" in j);
  } catch {
    return false;
  }
}

/**
 * 1.5.2 (RD-0118): /robots.txt as plain text (64 KB cap, every hop on the
 * site); null when absent, unreadable or not plain text (an HTML soft-404).
 */
async function readRobots(origin: string, base: string): Promise<string | null> {
  const r = await safeFetch(`${origin}/robots.txt`, { headers: { Accept: "text/plain" } }, { timeoutMs: PROBE_TIMEOUT_MS, sameSite: base });
  if (!r) return null;
  const ct = (r.headers.get("content-type") ?? "").toLowerCase();
  if (r.status !== 200 || !ct.includes("text/plain")) {
    r.discard();
    return null;
  }
  const b = await r.body({ maxBytes: PROBE_MAX_BYTES });
  return b.complete || b.truncated ? b.text : null;
}

/**
 * Link evidence from /llms.txt, the homepage and (MCP endpoints only)
 * /robots.txt; when that finds nothing, a
 * GET to /graphql on the site and on api.<site> (2 requests). Never throws.
 */
export async function gatherSiteSignals(
  siteUrl: string,
  llmsTxt: string | null | Promise<string | null>,
  homepage: HomepageRead | null | Promise<HomepageRead | null>
): Promise<SiteSignals> {
  try {
    const origin = new URL(siteUrl).origin;
    const [llms, home, robots] = await Promise.all([
      llmsTxt,
      homepage,
      readRobots(origin, siteBase(siteUrl)).catch(() => null),
    ]);
    const signals = linkSignals(siteUrl, [
      llms ? { text: llms, base: `${origin}/llms.txt` } : null,
      home ? { text: home.html, base: home.url || siteUrl } : null,
      robots ? { text: robots, base: `${origin}/robots.txt`, mcpOnly: true } : null,
    ]);
    if (signals.mcpUrls.length > 0 || signals.apiSignals.length > 0) return signals;
    const probes = [`${origin}/graphql`, `https://api.${siteBase(siteUrl)}/graphql`];
    const answered = await Promise.all(probes.map((p) => probeGraphql(p, siteBase(siteUrl))));
    const g = probes.find((_, i) => answered[i]);
    return g ? { mcpUrls: [], apiSignals: [`a GraphQL endpoint answering at ${g}`] } : signals;
  } catch {
    return NO_SIGNALS;
  }
}
