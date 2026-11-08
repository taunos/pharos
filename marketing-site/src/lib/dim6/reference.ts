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
// Every extracted identity field gets its own fixed share of the
// REFERENCE_MAX_CHARS budget (REFERENCE_FIELD_BUDGETS), trimmed at a word
// boundary and never omitted, so no field can push another out and the
// judge always sees conflicting evidence (Codex r1 HIGH, r3 HIGH):
//   llms.txt: H1, blockquote
//   JSON-LD Organization / Person / LocalBusiness (and subtypes): each
//     entity gets its own name and description share (Codex r5 HIGH), up to
//     REFERENCE_MAX_ENTITIES distinct entities; more → not verifiable
//     ("too_many_entities", fail closed: we can't tell which one the site is)
//   homepage: <title>, meta description, first <h1>
// Each source is labelled ("From llms.txt:", ...) so the judge can tell
// when sources disagree (it answers UNCLEAR then).
// The scan result carries none of these texts, so two same-site fetches are
// made (llms.txt and the homepage), each through safeFetch (every hop
// validated, byte cap, shared deadline), retried once on a timeout or
// network failure. A response whose final URL is on another site is ignored.
//
// The reference is written by the site owner, who is also the party the
// score is about, so it is untrusted: each part is normalized with line
// breaks kept (so line-anchored patterns still match), the text the judge
// will see is screened for prompt injection in line-preserving and one-line
// form, capped, and fenced in the judge prompt. Tags are found by linear
// indexOf scanning, never by regex over the page (Codex r7).
//   - injected → "injection": AFFIRM answers score 0 (accuracy_blocked=true).
//   - missing, unreadable or too short (< REFERENCE_MIN_WORDS words) →
//     AFFIRM answers score 0 (accuracy_not_checked=true). Fail closed:
//     withholding the description must not restore unchecked credit.

import { capLength, collapseWhitespace, screenUntrustedText, stripUnsafeChars, stripUnsafeCharsKeepLines } from "../llm-safety";
import { safeFetch, type FetchLike, type SafeFetchFailure } from "../safe-fetch";
import { detectAccuracyInjection } from "./accuracy-judge";
import { canonicalDomain } from "./question-set";

export const REFERENCE_FIELD_BUDGETS = {
  llmsH1: 80,
  llmsBlockquote: 220,
  title: 60,
  metaDescription: 120,
  h1: 60,
} as const;
/** Per JSON-LD identity entity. */
export const REFERENCE_ENTITY_BUDGETS = { name: 50, description: 120 } as const;
export const REFERENCE_MAX_ENTITIES = 4;
/**
 * Most content the reference can hold: 540 for the fixed fields plus 170 per
 * entity x 4 = 1220 chars (labels and line breaks come on top). With a 6000-
 * char answer and the instructions the judge prompt stays around 9000 chars
 * (~3000 tokens), well inside the 70B model's context.
 */
export const REFERENCE_MAX_CHARS =
  Object.values(REFERENCE_FIELD_BUDGETS).reduce((a, b) => a + b, 0) +
  REFERENCE_MAX_ENTITIES * (REFERENCE_ENTITY_BUDGETS.name + REFERENCE_ENTITY_BUDGETS.description);
export const REFERENCE_MIN_WORDS = 5;
const FETCH_TIMEOUT_MS = 8000;
// Collection limits (Codex r6: every limit either cannot hide evidence or
// fails closed with its own reason):
//   - homepage body: REFERENCE_HTML_MAX_BYTES; a longer page → "source_too_large"
//     (panel max 1.26 MB, Linear);
//   - llms.txt body: REFERENCE_LLMS_MAX_BYTES; longer → "source_too_large";
//   - homepage unreadable (timeout/network after one retry, non-2xx, off-site
//     final URL, body read error) → "source_unreadable"; llms.txt the same,
//     except a clean non-2xx / off-site / empty llms.txt just means "no llms.txt";
//   - JSON-LD nesting deeper than REFERENCE_JSONLD_MAX_DEPTH → "structured_data_too_deep";
//   - JSON-LD entities: no raw cap; all are collected, then deduplicated
//     (identical name+description),
//     more than REFERENCE_MAX_ENTITIES distinct → "too_many_entities";
//   - script blocks: no limit (all are read); a block that is not valid JSON
//     is skipped, as every JSON-LD consumer does.
export const REFERENCE_HTML_MAX_BYTES = 4 * 1024 * 1024;
export const REFERENCE_LLMS_MAX_BYTES = 512 * 1024;
export const REFERENCE_JSONLD_MAX_DEPTH = 20;

export type ReferenceFailure = "source_unreadable" | "source_too_large";

export type SiteReference =
  | { verifiable: true; text: string }
  | {
      verifiable: false;
      reason: "missing" | "too_short" | "injection" | "too_many_entities" | "structured_data_too_deep" | ReferenceFailure;
    };

export interface ReferenceSources {
  llmsTxt?: string | null;
  homepageHtml?: string | null;
  // Set by fetchReferenceSources when a source could not be read in full.
  failure?: ReferenceFailure;
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

// Text past a part's budget that is still screened, for patterns that start
// inside the shown text and end just after the cut.
const SCREEN_SLACK_CHARS = 200;

/**
 * Linear-time normalization that keeps line breaks: unsafe / zero-width
 * characters dropped (NFKC), every run of non-newline whitespace -> one
 * space, every line break with the whitespace around it -> one "\n", trimmed.
 * collapseWhitespace() of the result has the same length (each "\n" becomes
 * one space), so a prefix of it maps one-to-one onto the shown text.
 */
export function normalizeReferencePart(s: string): string {
  return stripUnsafeCharsKeepLines(s)
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n\s*/g, "\n")
    .trim();
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

class JsonLdTooDeep extends Error {}

// Walks top-level arrays and @graph (where a page states its own identity;
// entities nested in properties such as publisher or alumniOf are related
// entities, not the site's claim about itself). No count cap: the walk is
// bounded by the body byte cap. Nesting past REFERENCE_JSONLD_MAX_DEPTH
// throws, so the caller fails closed instead of skipping evidence.
function collectEntities(node: unknown, out: Array<Record<string, unknown>>, depth = 0): void {
  if (node === null || typeof node !== "object") return;
  if (depth > REFERENCE_JSONLD_MAX_DEPTH) throw new JsonLdTooDeep();
  if (Array.isArray(node)) {
    for (const n of node) collectEntities(n, out, depth + 1);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (typesOf(obj).some((t) => ENTITY_TYPE.test(t))) out.push(obj);
  if (obj["@graph"]) collectEntities(obj["@graph"], out, depth + 1);
}

/**
 * Homepage HTML (raw): JSON-LD identity entities (name/description, distinct,
 * in document order), <title>, meta description, first <h1>.
 */
export function extractHtmlIdentity(html: string): {
  jsonLdEntities: Array<{ name: string; description: string }>;
  jsonLdTooDeep: boolean;
  title: string;
  metaDescription: string;
  h1: string;
} {
  const jsonLdEntities: Array<{ name: string; description: string }> = [];
  const seenEntities = new Set<string>();
  const entities: Array<Record<string, unknown>> = [];
  let jsonLdTooDeep = false;
  const lower = html.toLowerCase();
  const blocks: string[] = [];
  for (let from = 0; ; ) {
    const tag = nextTag(html, lower, "script", from);
    if (!tag) break;
    const close = lower.indexOf("</script", tag.end + 1);
    if (close === -1) break; // unclosed: no block content (as a browser treats it)
    if ((tag.attrs.type ?? "").trim().toLowerCase() === "application/ld+json") blocks.push(html.slice(tag.end + 1, close));
    from = close + 8;
  }
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      // Invalid JSON-LD block: unreadable to every JSON-LD consumer; skipped.
      continue;
    }
    try {
      collectEntities(parsed, entities);
    } catch (e) {
      if (e instanceof JsonLdTooDeep) jsonLdTooDeep = true;
      else throw e;
    }
  }
  for (const e of entities) {
    const name = raw(e.name);
    const description = raw(e.description);
    if (!name && !description) continue;
    // The same entity listed twice (identical name and description) is one
    // entity: keeping one copy loses no evidence.
    const k = JSON.stringify([name, description]);
    if (seenEntities.has(k)) continue;
    seenEntities.add(k);
    jsonLdEntities.push({ name, description });
  }
  const title = raw(firstElementText(html, lower, "title"));
  let metaDescription = "";
  for (let from = 0; ; ) {
    const tag = nextTag(html, lower, "meta", from);
    if (!tag) break;
    if ((tag.attrs.name ?? "").trim().toLowerCase() === "description") {
      metaDescription = raw(tag.attrs.content ?? "");
      break;
    }
    from = tag.end + 1;
  }
  const h1 = raw(stripTagsLinear(firstElementText(html, lower, "h1")));
  return { jsonLdEntities, jsonLdTooDeep, title, metaDescription, h1 };
}

// ── Linear HTML scanning (Codex r7 MED) ─────────────────────────────────
// Regexes such as /<meta\b[^>]*>/gi go quadratic on many unclosed "<meta "
// prefixes, and the homepage cap is 4 MB, so tags are found with indexOf and
// read with a single forward pass (same approach as the scanner's
// scanTags / stripTags). Every search starts after the previous match, and a
// tag that never closes ends the scan, so each character is visited a
// bounded number of times.

const isTagSpace = (c: string | undefined) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";

/** Attributes of a tag whose name ends at `i`, up to its closing ">"; null when it never closes. */
function readTagAttrs(html: string, i: number): { attrs: Record<string, string>; end: number } | null {
  const attrs: Record<string, string> = {};
  const n = html.length;
  for (;;) {
    while (i < n && (isTagSpace(html[i]) || html[i] === "/")) i++;
    if (i >= n) return null;
    if (html[i] === ">") return { attrs, end: i };
    const nameStart = i;
    while (i < n && !isTagSpace(html[i]) && html[i] !== "/" && html[i] !== ">" && html[i] !== "=") i++;
    const key = html.slice(nameStart, i).toLowerCase();
    while (i < n && isTagSpace(html[i])) i++;
    let value = "";
    if (html[i] === "=") {
      i++;
      while (i < n && isTagSpace(html[i])) i++;
      const q = html[i];
      if (q === '"' || q === "'") {
        const close = html.indexOf(q, i + 1);
        if (close === -1) return null;
        value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        const vStart = i;
        while (i < n && !isTagSpace(html[i]) && html[i] !== ">") i++;
        value = html.slice(vStart, i);
      }
    }
    if (key && !(key in attrs)) attrs[key] = value;
  }
}

/** The next `<name ...>` tag at or after `from` (`lower` is html lowercased); null when none or unclosed. */
function nextTag(html: string, lower: string, name: string, from: number): { attrs: Record<string, string>; end: number } | null {
  const open = `<${name}`;
  for (let at = lower.indexOf(open, from); at !== -1; at = lower.indexOf(open, at + open.length)) {
    const after = at + open.length;
    const c = html[after];
    if (c !== undefined && !isTagSpace(c) && c !== "/" && c !== ">") continue; // e.g. <metadata>, <h10>
    return readTagAttrs(html, after);
  }
  return null;
}

/** Raw inner HTML of the first <name> element ("" when absent or unclosed). */
function firstElementText(html: string, lower: string, name: string): string {
  const tag = nextTag(html, lower, name, 0);
  if (!tag) return "";
  const close = lower.indexOf(`</${name}`, tag.end + 1);
  return close === -1 ? "" : html.slice(tag.end + 1, close);
}

/** Every tag replaced by a space, in one pass; an unclosed "<" ends the text. */
function stripTagsLinear(s: string): string {
  let out = "";
  for (let i = 0; ; ) {
    const lt = s.indexOf("<", i);
    if (lt === -1) return out + s.slice(i);
    out += `${s.slice(i, lt)} `;
    const gt = s.indexOf(">", lt + 1);
    if (gt === -1) return out;
    i = gt + 1;
  }
}

export const REFERENCE_LABELS = {
  llmsTxt: "From llms.txt:",
  jsonLd: "From structured data:",
  homepage: "From the homepage:",
} as const;
// One reference line: raw parts, each normalized, screened and capped at its
// own budget, joined with `sep`. `html` parts (title, meta, h1) have their
// character references decoded during normalization.
type RefPart = { raw: string; budget: number; html?: boolean };
type RefField = { parts: RefPart[]; sep: string };
const single = (raw: string, budget: number, html = false): RefField => ({ parts: [{ raw, budget, html }], sep: "" });

/**
 * Normalized text of a part, enough of it for `need` visible chars. Works on
 * a raw window that doubles until the output is long enough (or the whole
 * part is used), so a 4 MB field costs about as much as its first few KB
 * unless it is mostly padding, and even then stays linear. Only the last few
 * chars of a window's output can differ from the full normalization (a cut
 * entity, surrogate or combining sequence), so a margin past `need` is kept.
 */
function normalizePartFor(p: RefPart, need: number): string {
  const f = (s: string) => normalizeReferencePart(p.html ? decodeEntities(s) : s);
  const margin = 32;
  for (let len = Math.max(4096, (need + margin) * 4); ; len *= 2) {
    if (len >= p.raw.length) return f(p.raw);
    const out = f(p.raw.slice(0, len));
    if (out.length >= need + margin) return out.slice(0, need).trimEnd();
  }
}

/** Build the reference from fetched texts. Pure; see the module comment for the rules. */
export function buildSiteReference(sources: ReferenceSources): SiteReference {
  // Each source keeps its label so the judge can see when they disagree
  // (Codex r2 HIGH: matching either of two conflicting identities must not
  // earn CORRECT; the judge prompt says UNCLEAR then). Each field, and each
  // JSON-LD entity's name and description, has its own budget, so every
  // non-empty field appears (Codex r3, r5 HIGH).
  const groups: Array<{ label: string; fields: RefField[] }> = [];
  let tooManyEntities = false;
  let jsonLdTooDeep = false;
  if (sources.llmsTxt) {
    const [h1 = "", quote = ""] = extractLlmsTxtIdentity(sources.llmsTxt);
    groups.push({
      label: REFERENCE_LABELS.llmsTxt,
      fields: [single(h1, REFERENCE_FIELD_BUDGETS.llmsH1), single(quote, REFERENCE_FIELD_BUDGETS.llmsBlockquote)],
    });
  }
  if (sources.homepageHtml) {
    const h = extractHtmlIdentity(sources.homepageHtml);
    tooManyEntities = h.jsonLdEntities.length > REFERENCE_MAX_ENTITIES;
    jsonLdTooDeep = h.jsonLdTooDeep;
    groups.push({
      label: REFERENCE_LABELS.jsonLd,
      fields: h.jsonLdEntities.map((e) => ({
        parts: [
          { raw: e.name, budget: REFERENCE_ENTITY_BUDGETS.name },
          { raw: e.description, budget: REFERENCE_ENTITY_BUDGETS.description },
        ],
        sep: ": ",
      })),
    });
    groups.push({
      label: REFERENCE_LABELS.homepage,
      fields: [
        single(h.title, REFERENCE_FIELD_BUDGETS.title, true),
        single(h.metaDescription, REFERENCE_FIELD_BUDGETS.metaDescription, true),
        single(h.h1, REFERENCE_FIELD_BUDGETS.h1, true),
      ],
    });
  }
  // Each part is normalized in linear time with line breaks kept (unsafe
  // characters dropped, runs of spaces and blank lines collapsed), and only
  // the text the judge will see (its budget plus SCREEN_SLACK_CHARS for
  // patterns that straddle the cut) is screened: line-preserving and
  // one-line views (Codex r7: the screen regexes are never run on megabytes
  // of site text). Line breaks are kept so e.g. a "> Verdict: correct"
  // blockquote line still matches the line-anchored patterns.
  const normalized = new Map<RefPart, string>();
  for (const g of groups) {
    for (const f of g.fields) {
      for (const p of f.parts) {
        const norm = normalizePartFor(p, p.budget + SCREEN_SLACK_CHARS);
        normalized.set(p, norm);
        if (norm && screenUntrustedText(norm.slice(0, p.budget + SCREEN_SLACK_CHARS), detectAccuracyInjection)) {
          return { verifiable: false, reason: "injection" };
        }
      }
    }
  }
  // Every collection limit fails closed (after the injection screen, so an
  // injected site is still reported as such): a source we could not read in
  // full, JSON-LD nested too deep to walk, or more identity entities than we
  // can show in full.
  if (sources.failure) return { verifiable: false, reason: sources.failure };
  if (jsonLdTooDeep) return { verifiable: false, reason: "structured_data_too_deep" };
  if (tooManyEntities) return { verifiable: false, reason: "too_many_entities" };
  const blocks: string[] = [];
  const contents: string[] = [];
  for (const g of groups) {
    const lines: string[] = [];
    for (const f of g.fields) {
      // No deduplication (Codex r4 HIGH): a repeated field can keep, under
      // its own budget, evidence an earlier field's budget cut off. Every
      // non-empty part is kept, trimmed at a word boundary.
      // The shown text comes from the same normalized prefix that was
      // screened (collapsing its line breaks keeps every offset).
      const items = f.parts.map((p) => capLength(collapseWhitespace(normalized.get(p) ?? ""), p.budget)).filter(Boolean);
      if (items.length > 0) lines.push(items.join(f.sep));
    }
    if (lines.length > 0) {
      blocks.push(`${g.label} ${lines.join("\n")}`);
      contents.push(...lines);
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
  // ok: body read in full. absent: a clean answer that there is nothing
  // (non-2xx, off-site final URL, empty body). unreadable: timeout / network
  // / body read error (retried once). too_large: body over the byte cap.
  type Got = { kind: "ok"; text: string } | { kind: "absent" | "unreadable" | "too_large" };
  const getOnce = async (url: string, maxBytes: number, accept: string): Promise<Got> => {
    let failure: SafeFetchFailure | null = null;
    try {
      const res = await safeFetch(url, { headers: { accept } }, {
        timeoutMs: FETCH_TIMEOUT_MS,
        fetchImpl,
        onFail: (r) => {
          failure = r;
        },
      });
      if (!res) return { kind: failure === "unsafe_url" ? "absent" : "unreadable" };
      if (!res.ok || canonicalDomain(res.url) !== domain) {
        res.discard();
        return { kind: "absent" };
      }
      const body = await res.body({ maxBytes });
      if (body.truncated) return { kind: "too_large" };
      if (!body.complete) return { kind: "unreadable" };
      return body.text ? { kind: "ok", text: body.text } : { kind: "absent" };
    } catch {
      return { kind: "unreadable" };
    }
  };
  const get = async (url: string, maxBytes: number, accept: string): Promise<Got> => {
    const first = await getOnce(url, maxBytes, accept);
    return first.kind === "unreadable" ? getOnce(url, maxBytes, accept) : first;
  };
  const [llms, home] = await Promise.all([
    get(`${origin}/llms.txt`, REFERENCE_LLMS_MAX_BYTES, "text/plain, text/markdown;q=0.9, */*;q=0.1"),
    get(`${origin}/`, REFERENCE_HTML_MAX_BYTES, "text/html"),
  ]);
  const out: ReferenceSources = {
    llmsTxt: llms.kind === "ok" ? llms.text : null,
    homepageHtml: home.kind === "ok" ? home.text : null,
  };
  // Fail closed when evidence went unread: a source over its byte cap, an
  // llms.txt that failed to load, or a homepage that is not a readable 2xx
  // page on this site (the homepage is the core evidence; a missing
  // llms.txt is normal).
  if (llms.kind === "too_large" || home.kind === "too_large") out.failure = "source_too_large";
  else if (llms.kind === "unreadable" || home.kind !== "ok") out.failure = "source_unreadable";
  return out;
}

export async function resolveSiteReference(scanUrl: string, fetchImpl?: FetchLike): Promise<SiteReference> {
  return buildSiteReference(await fetchReferenceSources(scanUrl, fetchImpl));
}
