// dim6:v5 — reference description of the audited site, for the accuracy judge.
//
// Why: an answer can "know" a domain and still describe the wrong owner. The
// first real run (a clinical psychologist) had 8 of 15 affirmative answers
// describing a famous author, a graphic designer or a dress shop, and all 8
// counted as "named your domain". The accuracy judge (accuracy-judge.ts)
// compares each affirmative answer with what the site says about itself.
//
// Sources, in priority order (earlier sources survive the length cap):
//   1. llms.txt H1 and blockquote
//   2. JSON-LD Organization / Person / LocalBusiness (and subtypes) name and
//      description
//   3. homepage <title>, meta description, first <h1>
// The scan result carries none of these texts, so two same-site fetches are
// made (llms.txt and the homepage), each through safeFetch (every hop
// validated, byte cap, shared deadline). A response whose final URL is on
// another site is ignored.
//
// The reference is written by the site owner, who is also the party the
// score is about, so it is untrusted: unsafe characters stripped, capped at
// REFERENCE_MAX_CHARS, screened for prompt injection, and fenced in the
// judge prompt. Missing, too short (< REFERENCE_MIN_WORDS words) or injected
// → accuracy is "not verifiable" for the run and AFFIRM cells keep the v4
// behaviour, flagged accuracy_not_checked=true.

import { capLength, collapseWhitespace, stripUnsafeChars } from "../llm-safety";
import { safeFetch, type FetchLike } from "../safe-fetch";
import { detectAccuracyInjection } from "./accuracy-judge";
import { canonicalDomain } from "./question-set";

export const REFERENCE_MAX_CHARS = 600;
export const REFERENCE_MIN_WORDS = 5;
const FETCH_TIMEOUT_MS = 8000;
const LLMS_MAX_BYTES = 64 * 1024;
const HTML_MAX_BYTES = 1024 * 1024;

export type SiteReference =
  | { verifiable: true; text: string }
  | { verifiable: false; reason: "missing" | "too_short" | "injection" };

export interface ReferenceSources {
  llmsTxt?: string | null;
  homepageHtml?: string | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function clean(s: unknown): string {
  return typeof s === "string" ? collapseWhitespace(stripUnsafeChars(s)) : "";
}

/** llms.txt: the first-line H1 and the blockquote right after it. */
export function extractLlmsTxtIdentity(txt: string): string[] {
  const lines = txt.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  const h1 = /^#\s+(.+)$/.exec(lines[i]?.trim() ?? "");
  // No H1 on the first non-empty line: not an llms.txt (e.g. an HTML page
  // served for every path).
  if (!h1) return [];
  const out = [clean(h1[1])];
  i++;
  while (i < lines.length && lines[i].trim() === "") i++;
  const quote: string[] = [];
  while (i < lines.length && /^\s*>/.test(lines[i])) {
    quote.push(lines[i].replace(/^\s*>\s?/, ""));
    i++;
  }
  if (quote.length > 0) out.push(clean(quote.join(" ")));
  return out.filter(Boolean);
}

const ENTITY_TYPE = /^(?:Organization|Person|LocalBusiness|Corporation|NGO|ProfessionalService|Store|OnlineStore|[A-Za-z]*(?:Organization|Business))$/;

function typesOf(node: Record<string, unknown>): string[] {
  const t = node["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string").map((x) => x.replace(/^.*[/#]/, ""));
}

function collectEntities(node: unknown, out: Array<Record<string, unknown>>, depth = 0): void {
  if (depth > 6 || out.length >= 8 || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) collectEntities(n, out, depth + 1);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (typesOf(obj).some((t) => ENTITY_TYPE.test(t))) out.push(obj);
  if (obj["@graph"]) collectEntities(obj["@graph"], out, depth + 1);
}

/** Homepage HTML: JSON-LD entity name/description, <title>, meta description, first <h1>. */
export function extractHtmlIdentity(html: string): { jsonLd: string[]; title: string; metaDescription: string; h1: string } {
  const jsonLd: string[] = [];
  const entities: Array<Record<string, unknown>> = [];
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      collectEntities(JSON.parse(m[1]), entities);
    } catch {
      // Invalid JSON-LD block: skip it.
    }
  }
  for (const e of entities) {
    const name = clean(e.name);
    const desc = clean(e.description);
    const line = [name, desc].filter(Boolean).join(": ");
    if (line) jsonLd.push(line);
  }
  const title = clean(decodeEntities(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ""));
  const metaTag = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => /\bname\s*=\s*["']?description["'\s>]/i.test(t));
  const metaDescription = clean(decodeEntities(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(metaTag ?? "")?.slice(1).find((x) => x !== undefined) ?? ""));
  const h1 = clean(decodeEntities((/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "").replace(/<[^>]*>/g, " ")));
  return { jsonLd, title, metaDescription, h1 };
}

/** Build the reference from fetched texts. Pure; see the module comment for the rules. */
export function buildSiteReference(sources: ReferenceSources): SiteReference {
  const parts: string[] = [];
  if (sources.llmsTxt) parts.push(...extractLlmsTxtIdentity(sources.llmsTxt));
  if (sources.homepageHtml) {
    const h = extractHtmlIdentity(sources.homepageHtml);
    parts.push(...h.jsonLd, h.title, h.metaDescription, h.h1);
  }
  const seen = new Set<string>();
  const unique = parts.filter((p) => {
    const k = p.toLowerCase();
    if (!p || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (unique.length === 0) return { verifiable: false, reason: "missing" };
  const text = capLength(unique.join("\n"), REFERENCE_MAX_CHARS);
  if (text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length < REFERENCE_MIN_WORDS) {
    return { verifiable: false, reason: "too_short" };
  }
  if (detectAccuracyInjection(text)) return { verifiable: false, reason: "injection" };
  return { verifiable: true, text };
}

/**
 * Fetch llms.txt and the homepage of the audited site (two requests, in
 * parallel). Never throws; a source that fails, is not 2xx, or ends on
 * another site is null.
 */
export async function fetchReferenceSources(scanUrl: string, fetchImpl?: FetchLike): Promise<ReferenceSources> {
  const domain = canonicalDomain(scanUrl);
  let origin: string;
  try {
    origin = new URL(scanUrl).origin;
  } catch {
    return {};
  }
  if (!domain) return {};
  const get = async (url: string, maxBytes: number, accept: string): Promise<string | null> => {
    try {
      const res = await safeFetch(url, { headers: { accept } }, { timeoutMs: FETCH_TIMEOUT_MS, fetchImpl });
      if (!res) return null;
      if (!res.ok || canonicalDomain(res.url) !== domain) {
        res.discard();
        return null;
      }
      const body = await res.body({ maxBytes });
      return body.text || null;
    } catch {
      return null;
    }
  };
  const [llmsTxt, homepageHtml] = await Promise.all([
    get(`${origin}/llms.txt`, LLMS_MAX_BYTES, "text/plain, text/markdown;q=0.9, */*;q=0.1"),
    get(`${origin}/`, HTML_MAX_BYTES, "text/html"),
  ]);
  return { llmsTxt, homepageHtml };
}

export async function resolveSiteReference(scanUrl: string, fetchImpl?: FetchLike): Promise<SiteReference> {
  return buildSiteReference(await fetchReferenceSources(scanUrl, fetchImpl));
}
