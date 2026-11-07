// Dim 5 — Agent-Parsable Content
//
// Five sub-checks (weights from OQ-04 §2 Dim 5):
//   1. js_vs_no_js_render_diff (30%)  — paid uses Browser Rendering, free is static-only with disclosure
//   2. page_weight_lcp (15%)          — homepage HTML weight (1.4.0: LCP was never measured)
//   3. markdown_negotiation (25%)     — same on free + paid; 1.5.0: informational (N/A, not scored)
//   4. pricing_text_visibility (20%)  — 1.4.2: pricing page, else prices on the homepage or a
//                                       page it links to; N/A (not measured) with none
//   5. case_study_scannability (10%)  — heuristic only, no LLM (per Slice 2a constraint)
//
// Browser Rendering invocation: REST API per the same pattern audit-fulfill PDF
// generation uses. Reuses CF_API_TOKEN + CF_ACCOUNT_ID. Soft daily cap via the
// br-budget util.

import type { DimensionResult, Env, ScanTier, SubCheck } from "../types";
import { dimensionScoreOrThrow, gradeFor } from "../scoring";
import { MAX_HTML_BYTES, safeFetch, type SafeResponse } from "../safe-fetch";
import { isSameSite, siteBase } from "./site-signals";
import { scanTags } from "./dim3-openapi";
import {
  DAILY_BR_INVOCATION_CAP,
  getDailyBrCount,
  incrementDailyBrCount,
} from "../br-budget";

const FETCH_TIMEOUT_MS = 8000;
const BR_TIMEOUT_MS = 30_000;
const STATIC_UA = "AstrantScanner-Static/1.1.0";

const FREE_TIER_DISCLOSURE =
  "The free Score reads your server's HTML only; the $79 Audit also loads the page in a browser and compares the two.";

// Security pass 2026-11-04: validated hops (incl. homepage-discovered pricing
// and case-study links), max 3 redirects, one deadline covering headers AND
// body, capped body (see ../safe-fetch).
// 1.4.1: `sameSite` keeps every hop of a case-study fetch on the audited site.
function timedFetch(
  url: string,
  init?: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT_MS,
  sameSite?: string
): Promise<SafeResponse | null> {
  return safeFetch(url, init, { timeoutMs, sameSite });
}

/** Capped HTML read; "" on a read error or timeout (as a thrown text() was before). */
async function readHtml(r: SafeResponse): Promise<string> {
  return (await r.body({ maxBytes: MAX_HTML_BYTES })).text;
}

// Rendered HTML from Browser Rendering (JSON-wrapped) can be larger than a
// static page; bounded all the same.
const MAX_BR_BYTES = 10 * 1024 * 1024;
// page_weight_lcp buckets are <1MB / <=3MB / >3MB. When there is no
// Content-Length and the body passes the HTML cap, keep counting (without
// buffering) to just past 3MB so the bucket is unchanged.
const PAGE_WEIGHT_COUNT_UP_TO = 3 * 1024 * 1024 + 1;

const isNameChar = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_]/.test(c);

/**
 * Visible text of an HTML document: script and style blocks and every tag
 * replaced by a space, whitespace collapsed. 1.4.1: a linear scan (the old
 * regex chain took seconds on 120 KB of unclosed "<a " or "<script" and
 * minutes on 2 MB). Same result as the old chain: a <script> / <style> block
 * ends at the next "</script>" / "</style>"; a tag is "<" plus at least one
 * character up to the next ">"; text with no ">" after it stays text.
 */
export function stripTags(html: string): string {
  const lower = html.toLowerCase();
  const parts: string[] = [];
  const closeAt: Record<string, number> = {}; // last search result per raw-text element (-1: none left)
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      parts.push(html.slice(i));
      break;
    }
    parts.push(html.slice(i, lt));
    const gt = html.indexOf(">", lt + 1);
    if (gt === -1) {
      parts.push(html.slice(lt));
      break;
    }
    if (gt === lt + 1) {
      parts.push("<>");
      i = gt + 1;
      continue;
    }
    const raw = lower.startsWith("<script", lt) && !isNameChar(lower[lt + 7])
      ? "script"
      : lower.startsWith("<style", lt) && !isNameChar(lower[lt + 6])
        ? "style"
        : null;
    if (raw) {
      const closeTag = `</${raw}>`;
      let close = closeAt[raw];
      if (close === undefined || (close !== -1 && close <= gt)) {
        close = lower.indexOf(closeTag, gt + 1);
        closeAt[raw] = close;
      }
      if (close !== -1) {
        parts.push(" ");
        i = close + closeTag.length;
        continue;
      }
    }
    parts.push(" ");
    i = gt + 1;
  }
  return parts.join("").replace(/\s+/g, " ").trim();
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9$%./-]+/)
      .filter((t) => t.length >= 4)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

const COMMERCIAL_HEURISTIC_RE =
  /\$\d|pricing|plans?|capabilities|case stud|customers?\b|services?\b/i;

// ── Browser Rendering helpers ─────────────────────────────────────────────

interface BrRenderResult {
  html: string;
  loadEventEndMs: number | null;
}

async function browserRenderHtml(
  env: Env,
  url: string
): Promise<BrRenderResult | null> {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return null;
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/content`;
  const res = await timedFetch(
    endpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        gotoOptions: { waitUntil: "networkidle0", timeout: 20_000 },
      }),
    },
    BR_TIMEOUT_MS
  );
  if (!res || !res.ok) {
    res?.discard();
    return null;
  }
  const b = await res.body({ maxBytes: MAX_BR_BYTES });
  if (!b.complete) return null;
  let data: { success?: boolean; result?: string };
  try {
    data = JSON.parse(b.text) as { success?: boolean; result?: string };
  } catch {
    return null;
  }
  if (!data.success || typeof data.result !== "string") return null;
  // /content endpoint doesn't expose timing; LCP measurement omitted from v1
  // (see notes on page_weight_lcp).
  return { html: data.result, loadEventEndMs: null };
}

// ── Sub-check 1: js_vs_no_js_render_diff ─────────────────────────────────

async function runJsVsNoJsRenderDiff(
  url: string,
  env: Env,
  tier: ScanTier,
  staticBody: string | null
): Promise<SubCheck> {
  const id = "js_vs_no_js_render_diff";
  const name = "JS-vs-no-JS render diff";
  const weight = 30;

  // Free-tier: score on static body alone, with disclosure.
  if (tier === "free") {
    const score = scoreStaticAlone(staticBody);
    return {
      id,
      name,
      weight,
      score,
      passed: score >= 70,
      notes: `${describeStaticAlone(staticBody)}. ${FREE_TIER_DISCLOSURE}`,
    };
  }

  // Paid-tier: check daily BR cap before calling.
  const overCap = (await getDailyBrCount(env.CACHE)) >= DAILY_BR_INVOCATION_CAP;
  if (overCap) {
    const score = scoreStaticAlone(staticBody);
    return {
      id,
      name,
      weight,
      score,
      passed: score >= 70,
      notes: `${describeStaticAlone(staticBody)}. The live page rendering limit was reached on this run, so this check was scored on your server's HTML only.`,
    };
  }

  // Paid-tier under cap: invoke Browser Rendering and diff.
  const rendered = await browserRenderHtml(env, url);
  // Increment counter even on failure — we paid for the attempt.
  await incrementDailyBrCount(env.CACHE);

  if (!rendered) {
    const score = scoreStaticAlone(staticBody);
    return {
      id,
      name,
      weight,
      score,
      passed: score >= 70,
      notes: `${describeStaticAlone(staticBody)}. Live page rendering failed on this run, so this check was scored on your server's HTML only.`,
    };
  }

  const staticText = staticBody ? stripTags(staticBody) : "";
  const renderedText = stripTags(rendered.html);
  const overlap = jaccard(tokens(staticText), tokens(renderedText));

  let score: number;
  if (overlap >= 0.8) score = 100;
  else if (overlap >= 0.4) score = 50;
  else score = 0;

  const overlapPct = Math.round(overlap * 100);

  return {
    id,
    name,
    weight,
    score,
    passed: score >= 70,
    notes: renderOverlapNote(overlapPct),
  };
}

/**
 * js_vs_no_js_render_diff note (1.4.1). The figure is the Jaccard overlap of
 * the distinct words (4+ characters) in the two versions, not a share of the
 * rendered text.
 */
export const renderOverlapNote = (pct: number) =>
  `About ${pct}% of the distinct words on your homepage appear in both the HTML your server sends and the page after JavaScript runs.`;

function scoreStaticAlone(body: string | null): number {
  if (!body || body.length < 500) return 0;
  const text = stripTags(body);
  if (text.length < 2000) {
    // Minimal HTML — likely an SPA shell.
    return 0;
  }
  if (COMMERCIAL_HEURISTIC_RE.test(text)) return 100;
  return 50;
}

function describeStaticAlone(body: string | null): string {
  if (!body || body.length < 500) {
    return "Static fetch returned minimal HTML (likely a JS-required SPA shell)";
  }
  const text = stripTags(body);
  const matched = COMMERCIAL_HEURISTIC_RE.test(text);
  return matched
    ? `Static fetch returned ${text.length} chars of body text including pricing/capabilities signals`
    : `Static fetch returned ${text.length} chars of body text but no obvious pricing/capabilities signals`;
}

// ── Sub-check 2: page_weight_lcp ─────────────────────────────────────────

/** page_weight_lcp note (1.4.0). */
export const pageWeightNote = (mb: number, bytes: number) =>
  `Homepage HTML size: ${mb.toFixed(2)} MB (${bytes} bytes). This check looks at page size only; it does not measure loading speed.`;

async function runPageWeightLcp(
  url: string,
  staticBody: string | null,
  staticContentLength: number | null
): Promise<SubCheck> {
  // 1.4.0: named for what it measures. Loading speed (LCP) was never
  // measured, so the name and note no longer mention it (the id stays for
  // consumers).
  const id = "page_weight_lcp";
  const name = "Page weight";
  const weight = 15;

  // Use Content-Length if present, else fall back to body length.
  const bodyBytes =
    staticContentLength != null
      ? staticContentLength
      : staticBody
        ? new TextEncoder().encode(staticBody).length
        : 0;
  const mb = bodyBytes / (1024 * 1024);

  let score: number;
  if (mb < 1) score = 100;
  else if (mb <= 3) score = 50;
  else score = 0;

  return {
    id,
    name,
    weight,
    score,
    passed: score >= 70,
    notes: pageWeightNote(mb, bodyBytes),
  };
}

// ── Sub-check 3: markdown_negotiation ────────────────────────────────────

/** Bytes read to tell markdown from HTML. */
const MD_SNIFF_BYTES = 16 * 1024;

/**
 * 1.4.0: a text/markdown or text/plain response whose body (first
 * MD_SNIFF_BYTES) is not an HTML document. Consumes the body.
 */
async function isMarkdownResponse(r: SafeResponse): Promise<boolean> {
  const ct = (r.headers.get("content-type") ?? "").toLowerCase();
  if (!ct.includes("text/markdown") && !ct.includes("text/plain")) {
    r.discard();
    return false;
  }
  const head = (await r.body({ maxBytes: MD_SNIFF_BYTES })).text.trimStart().slice(0, 512).toLowerCase();
  if (!head) return false;
  return !(head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<head") || head.startsWith("<body") || /<html[\s>]/.test(head));
}

/** markdown_negotiation note (1.4.1): names the addresses actually checked. */
export const noMarkdownNote = (checked: string[], page = "the homepage") =>
  `We found no Markdown version at the addresses we checked (${checked.join(", ")} and an Accept: text/markdown request to ${page}). Agents read the HTML instead.`;

/** markdown_negotiation note suffix (1.5.0): the check is informational. */
export const MARKDOWN_INFO_NOTE =
  "Informational only: serving Markdown is an emerging convention most hosts don't support yet, so this is not scored.";

async function runMarkdownNegotiation(url: string): Promise<SubCheck> {
  const id = "markdown_negotiation";
  const name = "Markdown content negotiation";
  const weight = 25;

  // 1. Try Accept: text/markdown.
  const mdRes = await timedFetch(url, {
    headers: { Accept: "text/markdown", "User-Agent": STATIC_UA },
    redirect: "follow",
  });
  const mdCt = (mdRes?.headers.get("content-type") ?? "").toLowerCase();
  const finalUrlIsMd = (mdRes?.url ?? "").toLowerCase().endsWith(".md");

  // 1.4.0: a markdown answer needs a markdown / plain-text content type AND a
  // body that is not HTML (a .md URL or a redirect to one proves nothing).
  if (mdRes && mdRes.ok && (await isMarkdownResponse(mdRes))) {
    return {
      id,
      name,
      weight,
      score: 100,
      passed: true,
      notes: `Accept: text/markdown returns ${mdCt || "markdown"} (${finalUrlIsMd ? "redirected to .md variant" : "directly"}).`,
    };
  }

  // 2. Try common .md slugs.
  // 1.3.3: the root path has no "<path>.md" sibling (it used to build
  // "https://host.md", another host), and /llms.txt is Dim 1's file, not a
  // markdown variant of this page.
  const u = new URL(url);
  const pagePath = u.pathname.replace(/\/$/, "");
  const candidates = [`${u.origin}/index.md`];
  if (pagePath) candidates.push(`${u.origin}${pagePath}.md`);
  for (const c of candidates) {
    const r = await timedFetch(c, {
      headers: { "User-Agent": STATIC_UA },
      redirect: "follow",
    });
    if (!r || !r.ok) r?.discard();
    if (r && r.ok) {
      if (await isMarkdownResponse(r)) {
        return {
          id,
          name,
          weight,
          score: 75,
          passed: true,
          notes: `.md variant exists at ${c} but Accept: text/markdown negotiation isn't wired.`,
        };
      }
    }
  }

  // 3. Fallback — content extractable from HTML?
  const htmlRes = await timedFetch(url, {
    headers: { Accept: "text/html", "User-Agent": STATIC_UA },
    redirect: "follow",
  });
  htmlRes?.discard();
  if (htmlRes && htmlRes.ok) {
    return {
      id,
      name,
      weight,
      score: 25,
      passed: false,
      notes: noMarkdownNote(candidates, pagePath ? url : undefined),
    };
  }

  return {
    id,
    name,
    weight,
    score: 0,
    passed: false,
    notes: "Site did not respond to markdown or HTML requests.",
  };
}

// ── Sub-check 4: pricing_text_visibility ─────────────────────────────────

// 1.3.3: any common currency, not just "$": R$ / US$ / $ / euro / pound /
// yen / rupee signs or an ISO code, before the amount (optional space) or,
// for the euro / pound signs and ISO codes, after it ("99,90 EUR"). Both
// decimal styles (99.90 / 99,90).
const EURO = String.fromCharCode(0x20ac);
const POUND = String.fromCharCode(0xa3);
const YEN = String.fromCharCode(0xa5);
const RUPEE = String.fromCharCode(0x20b9);
const ISO_CURRENCY = "(?:USD|EUR|BRL|GBP|JPY|INR|CAD|AUD|CHF|MXN|ARS|CLP|COP|NZD|SEK|NOK|DKK|PLN|ZAR)";
const PRICE_AMOUNT = String.raw`(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d{1,5}(?:[.,]\d{2,3})?)`;
const PRICE_TOKEN =
  String.raw`(?:(?:R\$|US\$|\$|${EURO}|${POUND}|${YEN}|${RUPEE}|\b${ISO_CURRENCY})\s?${PRICE_AMOUNT}(?!\d)` +
  String.raw`|(?<![\d.,])${PRICE_AMOUNT}\s?(?:${EURO}|${POUND}|${ISO_CURRENCY}\b))`;
// 1.4.0: a billing period after the price, in the forms real pages use:
// "/mo", "/ per user per month", "a month", "monthly", "per seat / year", and
// pt-BR / es / fr / de ("/mês", "por mês", "mensal", "/mes", "/mois",
// "par mois", "/Monat", "pro Monat"). Up to three connector [+ unit] steps,
// then a period word (or a per-seat unit, "per user", as before); or a
// period adverb on its own. Connector and unit words
// must end at a word boundary ("promo" is not "pro" + "mo").
const NOT_LETTER = String.raw`(?![a-zÀ-ɏ])`;
const PERIOD_CONNECTOR = String.raw`(?:\/|(?:per|por|par|pro|a|an|al|ao|au|im|each|cada)${NOT_LETTER})`;
const PERIOD_UNIT = String.raw`(?:users?|seats?|members?|persons?|editors?|agents?|licen[cs]es?|usu[aá]rios?|utilisateurs?|nutzer|benutzer)${NOT_LETTER}`;
const PERIOD_WORD = String.raw`(?:months?|mo|years?|yr|annum|weeks?|wk|m[eê]s|meses|mois|monat|jahr|a[nñ]o|an)${NOT_LETTER}`;
const PERIOD_ADVERB = String.raw`(?:monthly|yearly|annually|weekly|mensal|mensais|mensual|mensuel|monatlich|anual|annuel|j[aä]hrlich)${NOT_LETTER}`;
export const PERIOD_SUFFIX = String.raw`\s*(?:(?:${PERIOD_CONNECTOR}\s*(?:${PERIOD_UNIT}\s*)?){1,3}(?:${PERIOD_WORD}|${PERIOD_UNIT})|${PERIOD_ADVERB})`;
export const PRICE_TEXT_RE = new RegExp(`${PRICE_TOKEN}${PERIOD_SUFFIX}`, "gi");
// 1.4.0: a price marked as one-time needs no period: "one-time", "pagamento
// único", "pago único", "paiement unique", "einmalig", "lifetime", within the
// 80 characters after the price.
const ONE_TIME_RE = /one[-\s]?time|lifetime|pagamento [uú]nico|pago [uú]nico|[uú]nico pagamento|paiement unique|einmalig|vital[ií]cio/i;
const ONE_TIME_WINDOW = 80;

/** Price tokens followed by a billing period or marked one-time. */
export function countPeriodOrOneTimePrices(text: string): number {
  const bare = new RegExp(PRICE_TOKEN, "g");
  const suffix = new RegExp(`^${PERIOD_SUFFIX}`, "i");
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = bare.exec(text)) !== null) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + ONE_TIME_WINDOW);
    if (suffix.test(after.slice(0, 64)) || ONE_TIME_RE.test(after)) n++;
  }
  return n;
}
export const PRICE_BARE_RE = new RegExp(PRICE_TOKEN, "g");
const MODAL_CLASS_RE = /\b(modal|dialog|popup|paywall|login-required|gated)\b/i;

// 1.4.2: bounds on the pricing check's requests. Homepage pricing links are
// deduplicated, kept on the audited site and tried at most
// MAX_PRICING_LINKS times; at most MAX_PRICE_SAMPLE_PAGES other
// homepage-linked pages are sampled for prices; and discovery plus sampling
// share one time budget (no request starts with under MIN_REQUEST_MS left).
// The read of a found pricing page is one more request with its own deadline.
const MAX_PRICING_LINKS = 3;
const MAX_PRICE_SAMPLE_PAGES = 3;
const PRICING_BUDGET_MS = 25_000;
const MIN_REQUEST_MS = 1000;

type TimeLeft = () => number;
const timeBudget = (ms: number): TimeLeft => {
  const until = Date.now() + ms;
  return () => until - Date.now();
};

/** A same-site GET under the pricing budget; null when the budget is spent. */
function budgetedFetch(url: string, base: string, left: TimeLeft): Promise<SafeResponse | null> {
  const ms = Math.min(FETCH_TIMEOUT_MS, left());
  if (ms < MIN_REQUEST_MS) return Promise.resolve(null);
  return timedFetch(url, { method: "GET", headers: { "User-Agent": STATIC_UA }, redirect: "follow" }, ms, base);
}

/** A URL without its query and fragment, or null when it is not an http(s) URL on the audited site. */
function sameSiteLink(href: string, pageUrl: string, base: string): URL | null {
  try {
    const u = new URL(href, pageUrl);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || !isSameSite(u.hostname, base)) return null;
    u.search = "";
    u.hash = "";
    return u;
  } catch {
    return null;
  }
}

async function findPricingPath(
  url: string,
  homepageHtml: string | null,
  base: string,
  left: TimeLeft,
  /** Filled with every address requested, so price sampling skips them. */
  tried: Set<string>
): Promise<string | null> {
  const u = new URL(url);
  const candidates = [
    `${u.origin}/pricing`,
    `${u.origin}/plans`,
    `${u.origin}/price`,
    `${u.origin}/pricing.html`,
  ];
  for (const c of candidates) {
    tried.add(c);
    const r = await budgetedFetch(c, base, left);
    r?.discard();
    if (r && r.ok) return r.url || c;
  }
  if (homepageHtml) {
    // 1.4.1: the quote-aware tag scanner (linear) and the anchor's text up
    // to </a> (bounded), instead of a regex that took seconds on 120 KB of
    // unclosed "<a ". 1.4.2: same-site links only, each address once, at
    // most MAX_PRICING_LINKS requests.
    let linksTried = 0;
    for (const href of anchorHrefs(homepageHtml, (text) => /pricing|plans|price/i.test(text))) {
      if (linksTried >= MAX_PRICING_LINKS) break;
      const link = sameSiteLink(href, url, base);
      if (!link || isExcludedContentPath(link.pathname)) continue;
      const resolved = link.toString();
      if (tried.has(resolved)) continue;
      tried.add(resolved);
      linksTried++;
      const r = await budgetedFetch(resolved, base, left);
      r?.discard();
      if (r && r.ok) return r.url || resolved;
    }
  }
  return null;
}

// Same paths as Dim 4's product links (/products/x, /product/x, /p/x).
const PRODUCT_LINK_PATH = /^\/(?:products?|p)\/[^/]+\/?$/i;

/**
 * 1.4.2: pages linked from the homepage to sample for prices when there is no
 * pricing page: same-site pages (not the homepage, an asset or an account /
 * cart page, or one already requested), product pages first, then in the order the homepage links
 * them, at most MAX_PRICE_SAMPLE_PAGES.
 */
export function priceSampleLinks(homepageHtml: string, homepageUrl: string, skip: ReadonlySet<string> = new Set()): string[] {
  const base = siteBase(homepageUrl);
  const homePath = new URL(homepageUrl).pathname.replace(/\/+$/, "");
  const product: string[] = [];
  const other: string[] = [];
  for (const href of anchorHrefs(homepageHtml)) {
    if (product.length >= MAX_PRICE_SAMPLE_PAGES) break;
    const link = sameSiteLink(href, homepageUrl, base);
    if (!link) continue;
    const path = link.pathname.replace(/\/+$/, "");
    if (path === homePath || ASSET_EXT.test(path) || isExcludedContentPath(link.pathname)) continue;
    const s = link.toString();
    if (skip.has(s) || product.includes(s) || other.includes(s)) continue;
    (PRODUCT_LINK_PATH.test(link.pathname) ? product : other).push(s);
  }
  return [...product, ...other].slice(0, MAX_PRICE_SAMPLE_PAGES);
}

/** Price tokens in a page's text: the score and the note detail. */
function scorePrices(html: string): { score: number; tokens: number; detail: string } {
  const text = stripTags(html);
  const structuredMatches = countPeriodOrOneTimePrices(text);
  const bareMatches = (text.match(PRICE_BARE_RE) ?? []).length;
  const totalPriceTokens = bareMatches; // structured is a subset of bare

  // Penalize if every price-looking string is wrapped in modal-suggesting classes.
  const allInModal = totalPriceTokens > 0 && MODAL_CLASS_RE.test(html) && bareMatches === 0;

  let score: number;
  let detail: string;
  if (structuredMatches > 0 || (totalPriceTokens >= 2 && !allInModal)) {
    score = 100;
    detail = `${totalPriceTokens} text-based price token(s); ${structuredMatches} with a billing period or marked one-time`;
  } else if (totalPriceTokens >= 1 || (allInModal && totalPriceTokens >= 1)) {
    score = 50;
    detail = allInModal
      ? `prices found but appear inside modal-suggesting markup`
      : `${totalPriceTokens} price token(s) but none with a billing period (such as "/month") or marked one-time`;
  } else {
    score = 0;
    detail = "no price patterns detected on the pricing page";
  }
  return { score, tokens: totalPriceTokens, detail };
}

/** pricing_text_visibility notes (1.4.2) when there is no pricing page. */
export const pricesOnHomepageNote = (pageUrl: string, detail: string) =>
  `No pricing page found, so we checked the prices shown on the homepage (${pageUrl}): ${detail}.`;
export const pricesOnLinkedPageNote = (pageUrl: string, detail: string) =>
  `No pricing page found, so we checked the prices shown on ${pageUrl}, a page linked from the homepage: ${detail}.`;
export const pricingNotMeasuredNote = (sampled: number | null) =>
  sampled === null
    ? "Not measured: we found no pricing page to check, and the homepage could not be read. This check is not counted in your score."
    : sampled === 0
      ? "Not measured: we found no pricing page to check, and no prices on the homepage. This check is not counted in your score."
      : `Not measured: we found no pricing page to check, and no prices on the homepage or on the ${sampled} page(s) it links to that we sampled. This check is not counted in your score.`;

async function runPricingTextVisibility(
  url: string,
  homepageHtml: string | null,
  homepageUrl: string = url
): Promise<SubCheck> {
  const id = "pricing_text_visibility";
  const name = "Pricing text visibility";
  const weight = 20;
  const base = siteBase(url);
  const left = timeBudget(PRICING_BUDGET_MS);

  const tried = new Set<string>();
  const pricingUrl = await findPricingPath(url, homepageHtml, base, left, tried);
  if (!pricingUrl) {
    // 1.4.2: no pricing page is a discovery limit, not a sign the check does
    // not apply. Prices shown on the homepage, or on a page it links to
    // (product pages first), are scored instead; with none, "not measured".
    const na = (notes: string): SubCheck => ({ id, name, weight, score: 0, passed: false, notes, na: true });
    if (!homepageHtml) return na(pricingNotMeasuredNote(null));
    const onHome = scorePrices(homepageHtml);
    if (onHome.tokens > 0) {
      return { id, name, weight, score: onHome.score, passed: onHome.score >= 70, notes: pricesOnHomepageNote(homepageUrl, onHome.detail) };
    }
    let sampled = 0;
    for (const link of priceSampleLinks(homepageHtml, homepageUrl, tried)) {
      const r = await budgetedFetch(link, base, left);
      if (!r || !r.ok) {
        r?.discard();
        continue;
      }
      sampled++;
      const onPage = scorePrices(await readHtml(r));
      if (onPage.tokens > 0) {
        return { id, name, weight, score: onPage.score, passed: onPage.score >= 70, notes: pricesOnLinkedPageNote(r.url || link, onPage.detail) };
      }
    }
    return na(pricingNotMeasuredNote(sampled));
  }

  // 1.4.2: every hop of the pricing page read stays on the audited site.
  const r = await timedFetch(
    pricingUrl,
    { headers: { "User-Agent": STATIC_UA }, redirect: "follow" },
    FETCH_TIMEOUT_MS,
    base
  );
  if (!r || !r.ok) {
    r?.discard();
    return {
      id,
      name,
      weight,
      score: 0,
      passed: false,
      notes: `Detected pricing path ${pricingUrl} but it didn't return 200.`,
    };
  }
  const { score, detail } = scorePrices(await readHtml(r));

  return {
    id,
    name,
    weight,
    score,
    passed: score >= 70,
    notes: `Detected ${pricingUrl}; ${detail}.`,
  };
}

// ── Sub-check 5: case_study_scannability — HEURISTIC ONLY ───────────────

/** case_study_scannability N/A note (1.4.0). */
export const CASE_STUDY_NA_NOTE =
  "No case-study or portfolio page detected (homepage links such as /case-studies, /customers, /work, /portfolio, /casos or /projetos, and the /case-studies, /customers, /success-stories, /work and /portfolio paths). This check is not counted in your score.";

// 1.4.0: account / sign-in / cart / admin pages are never content pages (a
// "Customer login" link was scored as a case study). Any path segment counts.
const EXCLUDED_SEGMENTS = new Set([
  "account", "accounts", "login", "log-in", "signin", "sign-in", "signup", "sign-up", "register",
  "cart", "checkout", "admin", "wp-admin", "wp-login", "wp-login.php", "auth", "oauth", "logout",
]);

export function isExcludedContentPath(pathname: string): boolean {
  return pathname
    .toLowerCase()
    .split("/")
    .some((seg) => EXCLUDED_SEGMENTS.has(seg));
}

// 1.4.0: case-study path words, strongest first, in English, pt-BR, es, fr
// and de. A path segment matches when it is the word or starts / ends with
// it as a hyphenated part ("casos-clinicos", "sorrisos-e-casos").
const CASE_STUDY_WORDS = [
  "case-studies", "case-study", "success-stories", "customer-stories", "cases", "casos",
  "customers", "kunden", "references", "realisations", "portfolio",
  "work", "projects", "projetos", "proyectos", "projets", "trabalhos", "clientes",
];

/** Accent-free lower case: "Réalisations" -> "realisations". */
function foldSegment(seg: string): string {
  let d = seg;
  try {
    d = decodeURIComponent(seg);
  } catch {
    // keep the raw segment
  }
  return d.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Rank of the best case-study word in a path's first segment (lower is stronger), or -1. */
export function caseStudyRank(pathname: string): number {
  if (isExcludedContentPath(pathname)) return -1;
  const first = foldSegment(pathname.split("/").filter(Boolean)[0] ?? "");
  if (!first) return -1;
  return CASE_STUDY_WORDS.findIndex(
    (w) => first === w || first.startsWith(w + "-") || first.endsWith("-" + w) || first.includes("-" + w + "-")
  );
}

/** Anchors scanned per document. */
const MAX_ANCHORS = 5000;
const MAX_ANCHOR_TEXT_CHARS = 512;

/**
 * 1.4.1: href values of <a> tags, in order, through Dim 3's quote-aware tag
 * scanner (linear, bounded). With `textTest`, only anchors whose text (up to
 * </a>, at most MAX_ANCHOR_TEXT_CHARS, tags removed) passes it.
 */
export function anchorHrefs(html: string, textTest?: (text: string) => boolean): string[] {
  const out: string[] = [];
  for (const { attrs, end } of scanTags(html, "a")) {
    if (out.length >= MAX_ANCHORS) break;
    const href = attrs.href?.trim();
    if (!href || href.length > 2048) continue;
    if (textTest) {
      let text = html.slice(end + 1, end + 1 + MAX_ANCHOR_TEXT_CHARS);
      const close = text.toLowerCase().indexOf("</a");
      if (close !== -1) text = text.slice(0, close);
      // [^<>]* cannot cross another "<", so this strip is linear.
      if (!textTest(text.replace(/<[^<>]*>/g, " "))) continue;
    }
    out.push(href);
  }
  return out;
}

/** Child pages linked from an index page: same site, one more path segment under the index path, not an asset. */
const ASSET_EXT = /\.(?:svg|png|jpe?g|gif|webp|avif|ico|css|js|json|xml|pdf|txt|mp4|webm|woff2?)$/i;
const MIN_INDEX_CHILDREN = 3;
const MAX_CHILD_LINKS = 50;

export function caseStudyChildren(html: string, pageUrl: string): string[] {
  const page = new URL(pageUrl);
  const base = siteBase(pageUrl);
  const prefix = page.pathname.replace(/\/+$/, "") + "/";
  const out: string[] = [];
  for (const href of anchorHrefs(html)) {
    if (out.length >= MAX_CHILD_LINKS) break;
    let u: URL;
    try {
      u = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (!isSameSite(u.hostname, base) || !u.pathname.startsWith(prefix)) continue;
    const rest = u.pathname.slice(prefix.length).replace(/\/+$/, "");
    if (!rest || rest.includes("/") || ASSET_EXT.test(rest) || isExcludedContentPath(u.pathname)) continue;
    u.search = "";
    u.hash = "";
    const s = u.toString();
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * An app shell or soft-404 ("Loading..." and scripts): under
 * MIN_PAGE_TEXT_CHARS of visible body text and no h1-h3 heading. Not a
 * case-study page, so the next candidate is tried.
 */
const MIN_PAGE_TEXT_CHARS = 200;
function bodyText(html: string): string {
  const bodyAt = html.toLowerCase().indexOf("<body");
  return stripTags(bodyAt >= 0 ? html.slice(bodyAt) : html);
}
function isEmptyShell(html: string): boolean {
  return bodyText(html).length < MIN_PAGE_TEXT_CHARS && !/<h[1-3][\s>]/i.test(html);
}

/**
 * 1.4.1: a sampled case-study page whose server HTML carries less visible
 * text than this builds its content with JavaScript (metalab.com/work/uber:
 * 253 characters), so its structure is not measured from that HTML.
 */
const MIN_CASE_STUDY_TEXT_CHARS = 500;

/** case_study_scannability note (1.4.1) for a JavaScript-built page. */
export const CASE_STUDY_JS_NOTE =
  "Not measured: this page builds its content with JavaScript, so its structure could not be read from the server's HTML.";

/**
 * 1.4.1: path words that also name pages that are not case studies (EFF's
 * /work lists its issues). A page reached through one of them counts only
 * when it looks like a case study.
 */
const AMBIGUOUS_CASE_STUDY_WORDS = new Set(["portfolio", "work", "projects", "projetos", "proyectos", "projets", "trabalhos"]);

function isAmbiguousCaseStudyPath(pathname: string): boolean {
  const rank = caseStudyRank(pathname);
  return rank >= 0 && AMBIGUOUS_CASE_STUDY_WORDS.has(CASE_STUDY_WORDS[rank]);
}

// Client / customer / case / project words (en, pt-BR, es, fr, de) in a
// title or h1; challenge / solution / result headings in an h2 / h3.
const CASE_STUDY_TITLE_RE =
  /\b(?:clients?|customers?|cases?|case stud(?:y|ies)|projects?|clientes?|casos?|projetos?|proyectos?|projets?|kunden?|kundin|fallstudien?)\b/i;
const CASE_STUDY_SECTION_RE =
  /\b(?:challenges?|solutions?|results?|outcomes?|approach|desafios?|solu[cç][aã]o|solu[cç][oõ]es|resultados?|soluci[oó]n|d[eé]fis?|r[eé]sultats?|herausforderung|l[oö]sung|ergebnis(?:se)?)\b/i;
const MAX_SECTION_HEADINGS = 50;

/** Text of the first `<name>` element, at most 512 characters, tags removed. Linear. */
function firstElementText(html: string, lower: string, name: string): string {
  const open = new RegExp(`<${name}(?=[\\s>])`, "i").exec(html);
  if (!open) return "";
  const start = html.indexOf(">", open.index);
  if (start === -1) return "";
  let text = html.slice(start + 1, start + 1 + 512);
  const close = lower.indexOf(`</${name}`, start + 1);
  if (close !== -1 && close < start + 1 + 512) text = html.slice(start + 1, close);
  return text.replace(/<[^<>]*>/g, " ");
}

/**
 * 1.4.1: a page that looks like a case study: a client / customer / case /
 * project word in its title or h1, or h2 / h3 sections such as challenge,
 * solution and results.
 */
export function looksLikeCaseStudy(html: string): boolean {
  const lower = html.toLowerCase();
  if (CASE_STUDY_TITLE_RE.test(firstElementText(html, lower, "title"))) return true;
  if (CASE_STUDY_TITLE_RE.test(firstElementText(html, lower, "h1"))) return true;
  const heading = /<h[23](?=[\s>])/gi;
  for (let k = 0; k < MAX_SECTION_HEADINGS; k++) {
    const m = heading.exec(html);
    if (!m) break;
    const start = html.indexOf(">", m.index);
    if (start === -1) break;
    let text = html.slice(start + 1, start + 1 + 256);
    const close = text.toLowerCase().indexOf("</h");
    if (close !== -1) text = text.slice(0, close);
    if (CASE_STUDY_SECTION_RE.test(text.replace(/<[^<>]*>/g, " "))) return true;
    heading.lastIndex = start + 1;
  }
  return false;
}

/** A static GET of a page on the audited site (every hop same-site). null unless 200. */
async function fetchSitePage(pageUrl: string, base: string): Promise<{ html: string; url: string } | null> {
  const r = await timedFetch(
    pageUrl,
    { method: "GET", headers: { "User-Agent": STATIC_UA }, redirect: "follow" },
    FETCH_TIMEOUT_MS,
    base
  );
  if (!r || !r.ok) {
    r?.discard();
    return null;
  }
  return { html: await readHtml(r), url: r.url || pageUrl };
}

type CaseStudySample = {
  /** The page to score. */
  url: string;
  /** Its server HTML; null when it did not return 200. */
  html: string | null;
  /** The index page it was linked from, when one was sampled. */
  index: string | null;
};

/**
 * 1.4.0: the case-study page to score. Homepage links whose first path
 * segment is a case-study word (any of the languages above) come first, the
 * strongest word winning; then the fixed index paths. A deeper link
 * (/work/acme) is a single study; a one-segment page is fetched and, when it
 * is an index (MIN_INDEX_CHILDREN or more child pages), one linked study is
 * sampled instead. Pages with no visible text (an app shell or soft-404) are
 * skipped. 1.4.1: a page reached through an ambiguous word (/work,
 * /portfolio, /projects) counts only when it loads and looks like a case
 * study; otherwise the next candidate is tried. Every fetch stays on the
 * audited site. Returns at most one page.
 */
async function findCaseStudyPage(url: string, homepageHtml: string | null): Promise<CaseStudySample | null> {
  const u = new URL(url);
  const base = siteBase(url);
  const candidates: string[] = [];
  if (homepageHtml) {
    const ranked: Array<{ url: string; rank: number }> = [];
    for (const href of anchorHrefs(homepageHtml)) {
      try {
        const link = new URL(href, url);
        if (!isSameSite(link.hostname, base)) continue;
        const rank = caseStudyRank(link.pathname);
        if (rank < 0) continue;
        link.search = "";
        link.hash = "";
        if (!ranked.some((r) => r.url === link.toString())) ranked.push({ url: link.toString(), rank });
      } catch {
        // ignore
      }
    }
    ranked.sort((a, b) => a.rank - b.rank);
    candidates.push(...ranked.slice(0, 2).map((r) => r.url));
  }
  for (const p of ["/case-studies", "/customers", "/success-stories", "/work", "/portfolio"]) {
    const c = `${u.origin}${p}`;
    if (!candidates.some((x) => x.replace(/\/+$/, "") === c)) candidates.push(c);
  }
  for (const c of candidates) {
    const ambiguous = isAmbiguousCaseStudyPath(new URL(c).pathname);
    const depth = new URL(c).pathname.split("/").filter(Boolean).length;
    let sample: CaseStudySample;
    if (depth >= 2) {
      const page = await fetchSitePage(c, base);
      sample = { url: page?.url ?? c, html: page?.html ?? null, index: null };
    } else {
      const page = await fetchSitePage(c, base);
      if (!page) continue;
      if (isExcludedContentPath(new URL(page.url).pathname)) continue;
      if (isEmptyShell(page.html)) continue;
      const children = caseStudyChildren(page.html, page.url);
      if (children.length >= MIN_INDEX_CHILDREN) {
        const child = await fetchSitePage(children[0], base);
        sample = { url: children[0], html: child?.html ?? null, index: page.url };
      } else {
        sample = { url: page.url, html: page.html, index: null };
      }
    }
    if (ambiguous && (sample.html === null || !looksLikeCaseStudy(sample.html))) continue;
    return sample;
  }
  return null;
}

interface ScannabilityBreakdown {
  url: string;
  headings: boolean;
  lists: boolean;
  bold: boolean;
  score: number;
}

/** Linear structure checks on a page's HTML. */
function scorePageScannability(pageUrl: string, html: string): ScannabilityBreakdown {
  // 1.4.1: count opening tags only (the old "<h2 ...>" regex rescanned to
  // the end of the document from every unclosed "<h2").
  let h2h3Count = 0;
  const heading = /<h[23]\b/gi;
  while (h2h3Count < 3 && heading.exec(html) !== null) h2h3Count++;
  const headings = h2h3Count >= 3;

  const lists = /<ul\b|<ol\b/i.test(html);
  // Bold with text after it: "<strong" / "<b", its ">", then non-space.
  let bold = false;
  const boldOpen = /<(?:strong|b)\b/gi;
  for (;;) {
    const m = boldOpen.exec(html);
    if (!m) break;
    const gt = html.indexOf(">", m.index);
    if (gt === -1) break;
    if (/^\s*\S/.test(html.slice(gt + 1, gt + 1 + 256))) {
      bold = true;
      break;
    }
    boldOpen.lastIndex = gt + 1;
  }

  // 1.3.3: the "metrics" criterion (%, "x faster", "hours saved") is gone;
  // it rewarded numbers whether or not they were real. The remaining three
  // keep their 30/20/20 proportions, renormalized to 100.
  let raw = 0;
  if (headings) raw += 30;
  if (lists) raw += 20;
  if (bold) raw += 20;
  const score = Math.round((raw * 100) / 70);

  return { url: pageUrl, headings, lists, bold, score };
}

async function runCaseStudyScannability(
  url: string,
  homepageHtml: string | null
): Promise<SubCheck> {
  const id = "case_study_scannability";
  const name = "Case-study scannability";
  const weight = 10;

  const sample = await findCaseStudyPage(url, homepageHtml);
  if (!sample) {
    return {
      id,
      name,
      weight,
      score: 0,
      passed: false,
      notes: CASE_STUDY_NA_NOTE,
      na: true,
    };
  }

  if (sample.html === null) {
    return {
      id,
      name,
      weight,
      score: 0,
      passed: false,
      notes: `Detected case-study paths (${sample.url}) but none returned 200.`,
    };
  }

  // 1.4.1: Browser Rendering renders the homepage only, so a sampled page
  // built with JavaScript is not measured (never scored 0).
  if (bodyText(sample.html).length < MIN_CASE_STUDY_TEXT_CHARS) {
    return { id, name, weight, score: 0, passed: false, notes: CASE_STUDY_JS_NOTE, na: true };
  }

  const b = scorePageScannability(sample.url, sample.html);
  // 1.4.2: plain words instead of the "(h:✗ l:✓ b:✓)" shorthand.
  const yn = (v: boolean) => (v ? "yes" : "no");
  const breakdownStr = `${b.url} → ${b.score} (headings: ${yn(b.headings)}, lists: ${yn(b.lists)}, bold text: ${yn(b.bold)})`;

  return {
    id,
    name,
    weight,
    score: b.score,
    passed: b.score >= 70,
    notes: `Sampled 1 page(s); avg ${b.score}/100. ${breakdownStr}.${sample.index ? ` (A case study linked from the index page ${sample.index}.)` : ""}`,
  };
}

// ── Top-level runDim5 ──────────────────────────────────────────────────────

export async function runDim5(
  targetUrl: string,
  env: Env,
  tier: ScanTier
): Promise<DimensionResult> {
  // One static fetch we share across multiple sub-checks.
  const homeRes = await timedFetch(targetUrl, {
    headers: { Accept: "text/html", "User-Agent": STATIC_UA },
    redirect: "follow",
  });
  let staticBody: string | null = null;
  let contentLength: number | null = null;
  if (homeRes && homeRes.ok) {
    const cl = homeRes.headers.get("content-length");
    contentLength = cl ? parseInt(cl, 10) : null;
    if (Number.isNaN(contentLength)) contentLength = null;
    const b = await homeRes.body({ maxBytes: MAX_HTML_BYTES, countUpTo: PAGE_WEIGHT_COUNT_UP_TO });
    // A read error or timeout is null, as a thrown text() was before.
    staticBody = b.complete || b.truncated ? b.text : null;
    if (b.truncated && contentLength == null) contentLength = b.bytes;
  } else {
    homeRes?.discard();
  }

  const subs: SubCheck[] = [];
  // Sequential where it makes sense (shared homepage fetch already done).
  // Parallel would hammer the target site; serial is fine for v1.
  subs.push(await runJsVsNoJsRenderDiff(targetUrl, env, tier, staticBody));
  subs.push(await runPageWeightLcp(targetUrl, staticBody, contentLength));
  // 1.5.0: informational (weight redistributed), like Dim 2 dns_txt: shown
  // with what was found, not scored.
  const md = await runMarkdownNegotiation(targetUrl);
  subs.push({ ...md, score: 0, passed: false, notes: `${md.notes} ${MARKDOWN_INFO_NOTE}`, na: true });
  subs.push(await runPricingTextVisibility(targetUrl, staticBody, homeRes?.url || targetUrl));
  subs.push(await runCaseStudyScannability(targetUrl, staticBody));

  const score = dimensionScoreOrThrow(subs);
  return {
    dimension_id: 5,
    dimension_name: "Agent-Parsable Content",
    score,
    grade: gradeFor(score),
    sub_checks: subs,
  };
}
