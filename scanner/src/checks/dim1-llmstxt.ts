import type { DimensionResult, Env, SubCheck } from "../types";
import { dimensionScoreOrThrow, gradeFor } from "../scoring";
import { cleanSiteText, detectScoringInjection } from "./llm-safety";
import { MAX_TEXT_BYTES, safeFetch, type SafeResponse } from "../safe-fetch";

const FETCH_TIMEOUT_MS = 8000;

// Security pass 2026-11-04: validated hops, max 3 redirects, one deadline
// covering headers AND body (see ../safe-fetch).
function timedFetch(url: string, init?: RequestInit): Promise<SafeResponse | null> {
  return safeFetch(url, init, { timeoutMs: FETCH_TIMEOUT_MS });
}

function isMarkdowny(body: string): boolean {
  // Crude heuristic: any markdown headings, lists, links, or > blockquotes.
  return /(^|\n)(#|>|\*|-|\d+\.)\s/.test(body) || /\]\(/.test(body);
}

// 1.4.0: every Markdown link [text](url) anywhere in the file counts, not
// only "- [text](url)" bullets (a prose file full of links was reported as
// "empty"). Images (![alt](src)) are not links. Bounded scan: each "](" is
// checked within LINK_TEXT_MAX chars back on its line and LINK_URL_MAX chars
// forward, at most MAX_LINK_ATTEMPTS times, so hostile text stays linear.
const MAX_LINKS_READ = 5000;
const MAX_LINK_ATTEMPTS = 20000;
const LINK_TEXT_MAX = 500;
const LINK_URL_MAX = 2048;
const LF = 10;

export function extractLinks(body: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (let attempts = 0; out.length < MAX_LINKS_READ && attempts < MAX_LINK_ATTEMPTS; attempts++) {
    const j = body.indexOf("](", from);
    if (j < 0) break;
    from = j + 2;
    let open = -1;
    for (let k = j - 1; k >= 0 && k >= j - LINK_TEXT_MAX && body.charCodeAt(k) !== LF; k--) {
      if (body[k] === "[") {
        open = k;
        break;
      }
    }
    if (open < 0 || (open > 0 && body[open - 1] === "!")) continue;
    let close = -1;
    for (let k = j + 2; k < body.length && k <= j + 2 + LINK_URL_MAX && body.charCodeAt(k) !== LF; k++) {
      if (body[k] === ")") {
        close = k;
        break;
      }
    }
    if (close < 0) continue;
    // [text](url "title"): the target is the first token.
    const target = body.slice(j + 2, close).trim().split(/\s+/)[0] ?? "";
    if (target && !target.includes("(")) out.push(target);
  }
  return out;
}

/** curation_quality note (1.4.0) for a non-empty file with no Markdown links. */
export const NO_MARKDOWN_LINKS_NOTE = "the file has no Markdown links ([text](url)) to evaluate";

function extractH1(body: string): string | null {
  for (const line of body.split(/\r?\n/, 50)) {
    const m = line.match(/^\s*#\s+(.+)$/);
    if (m) return m[1].trim();
  }
  return null;
}

// 1.3.3: the whole blockquote (consecutive ">" lines), not just its first
// line. It must still start within the first 10 lines. 1.5.0: a ">" line
// with no text separates paragraphs.
export function extractBlockquoteParagraphs(body: string): string[] | null {
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    if (!/^\s*>\s+\S/.test(lines[i])) continue;
    const paras: string[][] = [[]];
    for (let j = i; j < lines.length; j++) {
      const m = lines[j].match(/^\s*>\s?(.*)$/);
      if (!m) break;
      const t = m[1].trim();
      if (t) paras[paras.length - 1].push(t);
      else if (paras[paras.length - 1].length > 0) paras.push([]);
    }
    return paras.filter((p) => p.length > 0).map((p) => p.join(" "));
  }
  return null;
}

export function extractBlockquote(body: string): string | null {
  const paras = extractBlockquoteParagraphs(body);
  return paras ? paras.join(" ") : null;
}

// Longer than any 250-word summary needs; keeps the work bounded.
const BLOCKQUOTE_MAX_CHARS = 3000;

// 1.5.0: blockquote_eval is scored by fixed rules, not an AI rating (the
// model gave different scores to the same text on different runs). Three
// rules, a third of the score each; the 50-250 word range is the one the AI
// rating was asked to apply.
export const BLOCKQUOTE_MIN_WORDS = 50;
export const BLOCKQUOTE_MAX_WORDS = 250;

/** Lowercase, accents removed, anything but letters and digits as one space. */
function foldForMatch(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Second-level labels under a country code (example.com.br, example.co.uk).
const GENERIC_SLDS = new Set(["com", "net", "org", "co", "gov", "edu", "ac", "gob", "nom"]);

/** The host's main label: "resend" for docs.resend.com, "acme" for acme.com.br. */
export function hostMainLabel(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (labels.length <= 1) return labels[0] ?? "";
  labels.pop();
  if (labels.length >= 2 && GENERIC_SLDS.has(labels[labels.length - 1])) labels.pop();
  return labels[labels.length - 1];
}

/** The site name in an llms.txt H1: the part before a " - ", " | " or ": " separator. */
export function h1SiteName(h1: string): string {
  return cleanSiteText(h1, 200).split(/\s+[|\u2013\u2014-]\s+|:\s/)[0].trim();
}

/** true when `text` contains one of `names` (case- and accent-insensitive, whole words). */
export function namesBusiness(text: string, names: string[]): boolean {
  const t = foldForMatch(text);
  const tCompact = t.replace(/ /g, "");
  return names.some((raw) => {
    const n = foldForMatch(raw);
    if (!n) return false;
    if (` ${t} `.includes(` ${n} `)) return true;
    // "rachel-queiroz" / "RachelQueiroz" written as one word or two.
    const nCompact = n.replace(/ /g, "");
    return nCompact.length >= 4 && tCompact.includes(nCompact);
  });
}

const yesNo = (b: boolean) => (b ? "yes" : "no");

export function evalBlockquote(
  paragraphs: string[],
  names: string[]
): { score: number; note: string } {
  // The blockquote is site-controlled text: clean it and screen it.
  const text = cleanSiteText(paragraphs.join(" "), BLOCKQUOTE_MAX_CHARS);
  if (!text) return { score: 0, note: "blockquote empty after cleaning" };
  if (detectScoringInjection(text) !== null) {
    // The site owner benefits from a high score, so the safe direction is down.
    return { score: 0, note: "blockquote contains instruction-like text; scored 0" };
  }
  const words = text.split(" ").filter(Boolean).length;
  const onePara = paragraphs.filter((p) => cleanSiteText(p, BLOCKQUOTE_MAX_CHARS) !== "").length === 1;
  const lengthOk = words >= BLOCKQUOTE_MIN_WORDS && words <= BLOCKQUOTE_MAX_WORDS;
  const named = namesBusiness(text, names);
  const met = [onePara, lengthOk, named].filter(Boolean).length;
  return {
    score: Math.round((met / 3) * 100),
    note: `${met} of 3 blockquote rules met: one paragraph (${yesNo(onePara)}); ${BLOCKQUOTE_MIN_WORDS} to ${BLOCKQUOTE_MAX_WORDS} words (${yesNo(lengthOk)}, ${words} words); names the business (${yesNo(named)}).`,
  };
}

export async function runDim1(
  targetUrl: string,
  env: Env,
  // 1.4.0: receives the /llms.txt text this check read (null when there is
  // none), so Dim 2 / Dim 3 can look for MCP and API links without a refetch.
  onLlmsTxt?: (text: string | null) => void
): Promise<DimensionResult> {
  const origin = new URL(targetUrl).origin;
  const llmsUrl = `${origin}/llms.txt`;
  const subs: SubCheck[] = [];

  // 1. presence
  const res = await timedFetch(llmsUrl, { headers: { "User-Agent": "AstrantScanner/0.1" } });
  const ct = res?.headers.get("content-type") ?? "";
  const presenceOk = !!res && res.status === 200;
  const ctOk = /^text\/(plain|markdown)/.test(ct);
  const presenceScore = presenceOk ? (ctOk ? 100 : 50) : 0;
  subs.push({
    id: "presence",
    name: "Presence",
    weight: 25,
    score: presenceScore,
    passed: presenceScore >= 70,
    // Evidence from this single request (outreach observation-only claims). Scoring unchanged.
    evidence: {
      status: res ? res.status : null,
      content_type: ct,
      parsed: false,
      requested_url: llmsUrl,
      final_url: res?.url ?? "",
    },
    notes: !res
      ? "fetch failed"
      : res.status !== 200
        ? `status=${res.status}`
        : `status=200, content-type="${ct}"`,
  });

  let body = "";
  const presenceEvidence = subs[subs.length - 1].evidence!;
  presenceEvidence.body_complete = false;
  presenceEvidence.truncated = false;
  if (presenceOk) {
    // Capped read; a read error or the deadline yields "" (as before).
    const b = await res!.body({ maxBytes: MAX_TEXT_BYTES });
    body = b.text;
    presenceEvidence.body_complete = b.complete;
    presenceEvidence.truncated = b.truncated;
  } else {
    res?.discard();
  }
  onLlmsTxt?.(body || null);

  // 2. spec_compliance
  const h1 = body ? extractH1(body) : null;
  const bqParas = body ? extractBlockquoteParagraphs(body) : null;
  const blockquote = bqParas ? bqParas.join(" ") : null;
  const specScore = h1 && blockquote ? 100 : h1 || blockquote ? 50 : 0;
  subs.push({
    id: "spec_compliance",
    name: "Spec compliance (H1 + blockquote)",
    weight: 25,
    score: specScore,
    passed: specScore >= 70,
    notes: `h1=${h1 ? "yes" : "no"}, blockquote=${blockquote ? "yes" : "no"}`,
  });

  // 3. linked_pages_quality
  const links = body ? extractLinks(body) : [];
  let linkedScore = 0;
  let linkedNote = "no links to sample";
  if (links.length > 0) {
    const sample = links.slice(0, 5);
    const results = await Promise.all(
      sample.map(async (l) => {
        try {
          const url = new URL(l, llmsUrl).toString();
          const r = await timedFetch(url, { headers: { Accept: "text/markdown,text/plain,*/*" } });
          if (!r) return false;
          if (r.status !== 200) {
            r.discard();
            return false;
          }
          const t = (await r.body({ maxBytes: MAX_TEXT_BYTES })).text;
          return isMarkdowny(t);
        } catch {
          return false;
        }
      })
    );
    const good = results.filter(Boolean).length;
    linkedScore = Math.round((good / sample.length) * 100);
    linkedNote = `${good}/${sample.length} sampled links return markdown-ish content`;
  }
  subs.push({
    id: "linked_pages_quality",
    name: "Linked pages return useful markdown",
    weight: 20,
    score: linkedScore,
    passed: linkedScore >= 70,
    notes: linkedNote,
  });

  // 4. curation_quality
  // Gate: if the file isn't there, or it loaded but has zero links, the
  // anti-pattern detection below is meaningless — there's nothing to curate.
  // Returning 100/"clean link list" in those cases (the old behavior) was
  // misleading. Instead, score 0 with honest notes so the per-dimension
  // breakdown reflects the missing-file reality.
  let curationScore = 0;
  let curationNotes = "";
  if (!presenceOk) {
    curationNotes = "file missing — no link list to evaluate";
  } else if (!body.trim()) {
    curationNotes = "empty file — no links to evaluate";
  } else if (links.length === 0) {
    curationNotes = NO_MARKDOWN_LINKS_NOTE;
  } else {
    curationScore = 100;
    const antipatterns: string[] = [];
    if (links.length > 100) {
      curationScore -= 20;
      antipatterns.push(`${links.length} links (>100)`);
    }
    if (links.some((l) => /\/tag\//i.test(l))) {
      curationScore -= 20;
      antipatterns.push("tag pages linked");
    }
    if (links.some((l) => /\/archive\//i.test(l))) {
      curationScore -= 20;
      antipatterns.push("archive pages linked");
    }
    if (links.some((l) => /\/search\?/i.test(l))) {
      curationScore -= 20;
      antipatterns.push("search-result URLs linked");
    }
    if (links.some((l) => /\?(?!_pharos_t=)/.test(l))) {
      curationScore -= 20;
      antipatterns.push("links contain query strings");
    }
    curationScore = Math.max(0, curationScore);
    curationNotes =
      antipatterns.length === 0 ? "clean link list" : antipatterns.join("; ");
  }
  subs.push({
    id: "curation_quality",
    name: "Curation quality",
    weight: 15,
    score: curationScore,
    passed: curationScore >= 70,
    notes: curationNotes,
  });

  // 5. blockquote_eval
  let bqScore = 0;
  let bqNote = "no blockquote to evaluate";
  if (bqParas && blockquote) {
    const names = [h1 ? h1SiteName(h1) : "", hostMainLabel(new URL(targetUrl).hostname)];
    const r = evalBlockquote(bqParas, names);
    bqScore = r.score;
    bqNote = r.note;
  }
  subs.push({
    id: "blockquote_eval",
    name: "Blockquote elevator-pitch quality",
    weight: 15,
    score: bqScore,
    passed: bqScore >= 70,
    notes: bqNote,
  });

  const score = dimensionScoreOrThrow(subs);
  return {
    dimension_id: 1,
    dimension_name: "llms.txt Quality",
    score,
    grade: gradeFor(score),
    sub_checks: subs,
  };
}
