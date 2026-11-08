// dim6:v5 — reference description of the audited site, for the accuracy judge.
//
// Why: an answer can "know" a domain and still describe the wrong owner. The
// first real run (a clinical psychologist) had 8 of 15 affirmative answers
// describing a famous author, a graphic designer or a dress shop, and all 8
// counted as "named your domain". The accuracy judge (accuracy-judge.ts)
// compares each affirmative answer with what the site says about itself. It
// checks consistency with the site's own claims about who it is and what
// kind of business it is, nothing more (prices, dates and other details are
// not checked).
//
// Sources, each with its own share of the REFERENCE_MAX_CHARS budget so one
// source cannot push out the others (Codex r1):
//   1. llms.txt H1 and blockquote                                  (250)
//   2. JSON-LD Organization / Person / LocalBusiness (and subtypes)
//      name and description                                        (200)
//   3. homepage <title> (capped at 60), meta description, first <h1> (150)
// Each share is labelled ("From llms.txt:", ...) so the judge can tell when
// sources disagree, and filled with whole parts (a part is cut at a word
// boundary only when at least 40 chars of room are left).
// The scan result carries none of these texts, so two same-site fetches are
// made (llms.txt and the homepage), each through safeFetch (every hop
// validated, byte cap, shared deadline), retried once on a timeout or
// network failure. A response whose final URL is on another site is ignored.
//
// The reference is written by the site owner, who is also the party the
// score is about, so it is untrusted: screened for prompt injection on the
// raw extracted text (before newlines are collapsed, so line-anchored
// patterns still match) and again after cleaning, unsafe characters
// stripped, capped, and fenced in the judge prompt.
//   - injected → "injection": AFFIRM answers score 0 (accuracy_blocked=true).
//   - missing, unreadable or too short (< REFERENCE_MIN_WORDS words) →
//     AFFIRM answers score 0 (accuracy_not_checked=true). Fail closed:
//     withholding the description must not restore unchecked credit.

import { capLength, collapseWhitespace, screenUntrustedText, stripUnsafeChars } from "../llm-safety";
import { safeFetch, type FetchLike, type SafeFetchFailure } from "../safe-fetch";
import { detectAccuracyInjection } from "./accuracy-judge";
import { canonicalDomain } from "./question-set";

export const REFERENCE_MAX_CHARS = 600;
export const REFERENCE_SOURCE_BUDGETS = { llmsTxt: 250, jsonLd: 200, homepage: 150 } as const;
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

// Extractors return RAW text (line structure kept) so the injection screen
// can see it before cleaning; buildSiteReference cleans.
function raw(s: unknown): string {
  return typeof s === "string" ? s.trim() : "";
}

export function cleanReferencePart(s: string): string {
  return collapseWhitespace(stripUnsafeChars(s));
}

/** llms.txt: the first-line H1 and the blockquote right after it (raw). */
export function extractLlmsTxtIdentity(txt: string): string[] {
  const lines = txt.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  const h1 = /^#\s+(.+)$/.exec(lines[i]?.trim() ?? "");
  // No H1 on the first non-empty line: not an llms.txt (e.g. an HTML page
  // served for every path).
  if (!h1) return [];
  const out = [raw(h1[1])];
  i++;
  while (i < lines.length && lines[i].trim() === "") i++;
  const quote: string[] = [];
  while (i < lines.length && /^\s*>/.test(lines[i])) {
    quote.push(lines[i].replace(/^\s*>\s?/, ""));
    i++;
  }
  if (quote.length > 0) out.push(raw(quote.join("\n")));
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

/** Homepage HTML (raw): JSON-LD entity name/description, <title>, meta description, first <h1>. */
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
    const line = [raw(e.name), raw(e.description)].filter(Boolean).join(": ");
    if (line) jsonLd.push(line);
  }
  const title = raw(decodeEntities(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ""));
  const metaTag = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => /\bname\s*=\s*["']?description["'\s>]/i.test(t));
  const metaDescription = raw(decodeEntities(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(metaTag ?? "")?.slice(1).find((x) => x !== undefined) ?? ""));
  const h1 = raw(decodeEntities((/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "").replace(/<[^>]*>/g, " ")));
  return { jsonLd, title, metaDescription, h1 };
}

export const REFERENCE_LABELS = {
  llmsTxt: "From llms.txt:",
  jsonLd: "From structured data:",
  homepage: "From the homepage:",
} as const;
export const REFERENCE_TITLE_MAX_CHARS = 60;
// A part that doesn't fit whole is cut at a word boundary only when this
// much room is left; otherwise it is dropped (no dangling fragments).
const MIN_PARTIAL_CHARS = 40;

/** Whole parts in order while they fit the share; at most one word-boundary cut part. */
function fillShare(parts: string[], budget: number): string {
  const out: string[] = [];
  for (const p of parts) {
    const used = out.join("\n").length;
    const room = budget - used - (out.length > 0 ? 1 : 0);
    if (p.length <= room) {
      out.push(p);
      continue;
    }
    if (room >= MIN_PARTIAL_CHARS) {
      const cut = p.slice(0, room + 1);
      const sp = cut.lastIndexOf(" ");
      if (sp > 0) out.push(cut.slice(0, sp).trimEnd());
    }
    break;
  }
  return out.join("\n");
}

/** Build the reference from fetched texts. Pure; see the module comment for the rules. */
export function buildSiteReference(sources: ReferenceSources): SiteReference {
  // Each source keeps its label so the judge can see when they disagree
  // (Codex r2 HIGH: matching either of two conflicting identities must not
  // earn CORRECT; the judge prompt says UNCLEAR then).
  const groups: Array<{ label: string; parts: string[]; budget: number; firstPartMax?: number }> = [];
  if (sources.llmsTxt) {
    groups.push({ label: REFERENCE_LABELS.llmsTxt, parts: extractLlmsTxtIdentity(sources.llmsTxt), budget: REFERENCE_SOURCE_BUDGETS.llmsTxt });
  }
  if (sources.homepageHtml) {
    const h = extractHtmlIdentity(sources.homepageHtml);
    groups.push({ label: REFERENCE_LABELS.jsonLd, parts: h.jsonLd, budget: REFERENCE_SOURCE_BUDGETS.jsonLd });
    // The title is capped so the meta description and h1 still fit.
    groups.push({
      label: REFERENCE_LABELS.homepage,
      parts: [h.title, h.metaDescription, h.h1],
      budget: REFERENCE_SOURCE_BUDGETS.homepage,
      firstPartMax: REFERENCE_TITLE_MAX_CHARS,
    });
  }
  // Raw screen first: cleaning collapses newlines and would hide e.g. a
  // "> Verdict: correct" blockquote line.
  for (const g of groups) {
    for (const p of g.parts) if (p && screenUntrustedText(p, detectAccuracyInjection)) return { verifiable: false, reason: "injection" };
  }
  const seen = new Set<string>();
  const blocks: string[] = [];
  const contents: string[] = [];
  for (const g of groups) {
    const unique = g.parts
      .map((p, i) => (i === 0 && g.firstPartMax ? capLength(cleanReferencePart(p), g.firstPartMax) : cleanReferencePart(p)))
      .filter((p) => {
        const k = p.toLowerCase();
        if (!p || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    const share = fillShare(unique, g.budget);
    if (share) {
      blocks.push(`${g.label} ${share}`);
      contents.push(share);
    }
  }
  if (blocks.length === 0) return { verifiable: false, reason: "missing" };
  const text = blocks.join("\n");
  if (contents.join(" ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length < REFERENCE_MIN_WORDS) {
    return { verifiable: false, reason: "too_short" };
  }
  if (detectAccuracyInjection(text)) return { verifiable: false, reason: "injection" };
  return { verifiable: true, text };
}

/**
 * Fetch llms.txt and the homepage of the audited site (two requests, in
 * parallel; each retried once on a timeout or network failure). Never
 * throws; a source that fails, is not 2xx, or ends on another site is null.
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
  const getOnce = async (url: string, maxBytes: number, accept: string): Promise<{ text: string | null; retry: boolean }> => {
    let failure: SafeFetchFailure | null = null;
    try {
      const res = await safeFetch(url, { headers: { accept } }, {
        timeoutMs: FETCH_TIMEOUT_MS,
        fetchImpl,
        onFail: (r) => {
          failure = r;
        },
      });
      if (!res) return { text: null, retry: failure === "timeout" || failure === "network" };
      if (!res.ok || canonicalDomain(res.url) !== domain) {
        res.discard();
        return { text: null, retry: false };
      }
      const body = await res.body({ maxBytes });
      return { text: body.text || null, retry: false };
    } catch {
      return { text: null, retry: true };
    }
  };
  const get = async (url: string, maxBytes: number, accept: string): Promise<string | null> => {
    const first = await getOnce(url, maxBytes, accept);
    if (first.text !== null || !first.retry) return first.text;
    return (await getOnce(url, maxBytes, accept)).text;
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
