// Dim 5 — Agent-Parsable Content
//
// Five sub-checks (weights from OQ-04 §2 Dim 5):
//   1. js_vs_no_js_render_diff (30%)  — paid uses Browser Rendering, free is static-only with disclosure
//   2. page_weight_lcp (15%)          — homepage HTML weight (1.4.0: LCP was never measured)
//   3. markdown_negotiation (25%)     — same on free + paid
//   4. pricing_text_visibility (20%)  — N/A if no pricing page found (weight redistributed)
//   5. case_study_scannability (10%)  — heuristic only, no LLM (per Slice 2a constraint)
//
// Browser Rendering invocation: REST API per the same pattern audit-fulfill PDF
// generation uses. Reuses CF_API_TOKEN + CF_ACCOUNT_ID. Soft daily cap via the
// br-budget util.

import type { DimensionResult, Env, ScanTier, SubCheck } from "../types";
import { dimensionScoreOrThrow, gradeFor } from "../scoring";
import { MAX_HTML_BYTES, safeFetch, type SafeResponse } from "../safe-fetch";
import { isSameSite, siteBase } from "./site-signals";
import {
  DAILY_BR_INVOCATION_CAP,
  getDailyBrCount,
  incrementDailyBrCount,
} from "../br-budget";

const FETCH_TIMEOUT_MS = 8000;
const BR_TIMEOUT_MS = 30_000;
const STATIC_UA = "AstrantScanner-Static/1.1.0";

const FREE_TIER_DISCLOSURE =
  "Free-tier signal: static fetch only. Full render diff (Puppeteer-vs-static) available in $79 Audit.";

// Security pass 2026-11-04: validated hops (incl. homepage-discovered pricing
// and case-study links), max 3 redirects, one deadline covering headers AND
// body, capped body (see ../safe-fetch).
function timedFetch(
  url: string,
  init?: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<SafeResponse | null> {
  return safeFetch(url, init, { timeoutMs });
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

function stripTags(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  const sizeRatio =
    staticText.length === 0 ? Infinity : renderedText.length / staticText.length;

  let score: number;
  if (overlap >= 0.8) score = 100;
  else if (overlap >= 0.4) score = 50;
  else score = 0;

  const overlapPct = Math.round(overlap * 100);
  const sizeRatioStr =
    Number.isFinite(sizeRatio) ? `${sizeRatio.toFixed(1)}x` : "∞";

  return {
    id,
    name,
    weight,
    score,
    passed: score >= 70,
    notes: `Static-vs-rendered token overlap ${overlapPct}%; rendered HTML ${sizeRatioStr} the size of static.`,
  };
}

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
      notes:
        "No markdown variant or content negotiation. Agents must fall back to HTML extraction.",
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

async function findPricingPath(
  url: string,
  homepageHtml: string | null
): Promise<string | null> {
  const u = new URL(url);
  const candidates = [
    `${u.origin}/pricing`,
    `${u.origin}/plans`,
    `${u.origin}/price`,
    `${u.origin}/pricing.html`,
  ];
  for (const c of candidates) {
    const r = await timedFetch(c, {
      method: "GET",
      headers: { "User-Agent": STATIC_UA },
      redirect: "follow",
    });
    r?.discard();
    if (r && r.ok) return r.url || c;
  }
  if (homepageHtml) {
    const re =
      /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>(?:\s|<[^>]+>)*((?:[^<])*?(?:pricing|plans|price)(?:[^<])*?)(?:<|\s*<\/)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(homepageHtml)) !== null) {
      const href = m[1];
      try {
        const resolved = new URL(href, url).toString();
        if (isExcludedContentPath(new URL(resolved).pathname)) continue;
        const r = await timedFetch(resolved, {
          headers: { "User-Agent": STATIC_UA },
          redirect: "follow",
        });
        r?.discard();
        if (r && r.ok) return r.url || resolved;
      } catch {
        // ignore
      }
    }
  }
  return null;
}

async function runPricingTextVisibility(
  url: string,
  homepageHtml: string | null
): Promise<SubCheck> {
  const id = "pricing_text_visibility";
  const name = "Pricing text visibility";
  const weight = 20;

  const pricingUrl = await findPricingPath(url, homepageHtml);
  if (!pricingUrl) {
    return {
      id,
      name,
      weight,
      score: 0,
      passed: false,
      notes:
        "No /pricing, /plans, or /price path found, and no pricing-link discovered on homepage. This check is not counted in your score.",
      na: true,
    };
  }

  const r = await timedFetch(pricingUrl, {
    headers: { "User-Agent": STATIC_UA },
    redirect: "follow",
  });
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
  const html = await readHtml(r);
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

/** Child pages linked from an index page: same site, one more path segment under the index path, not an asset. */
const ASSET_EXT = /\.(?:svg|png|jpe?g|gif|webp|avif|ico|css|js|json|xml|pdf|txt|mp4|webm|woff2?)$/i;
const MIN_INDEX_CHILDREN = 3;
const MAX_CHILD_LINKS = 50;

export function caseStudyChildren(html: string, pageUrl: string): string[] {
  const page = new URL(pageUrl);
  const base = siteBase(pageUrl);
  const prefix = page.pathname.replace(/\/+$/, "") + "/";
  const out: string[] = [];
  const re = /<a\b[^>]*?\bhref\s*=\s*["']([^"'<>\s]{1,2048})["']/gi;
  let m: RegExpExecArray | null;
  for (let n = 0; (m = re.exec(html)) !== null && n < 5000 && out.length < MAX_CHILD_LINKS; n++) {
    let u: URL;
    try {
      u = new URL(m[1], pageUrl);
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
function isEmptyShell(html: string): boolean {
  const bodyAt = html.toLowerCase().indexOf("<body");
  const text = stripTags(bodyAt >= 0 ? html.slice(bodyAt) : html);
  return text.length < MIN_PAGE_TEXT_CHARS && !/<h[1-3][\s>]/i.test(html);
}

/**
 * 1.4.0: the case-study page to score. Homepage links whose first path
 * segment is a case-study word (any of the languages above) come first, the
 * strongest word winning; then the fixed index paths. A deeper link
 * (/work/acme) is a single study; a one-segment page is fetched and, when it
 * is an index (MIN_INDEX_CHILDREN or more child pages), one linked study is
 * sampled instead. Pages with no visible text (an app shell or soft-404) are
 * skipped. Returns at most one URL to score, plus the index it came from.
 */
async function findCaseStudyPaths(
  url: string,
  homepageHtml: string | null
): Promise<{ pages: string[]; index: string | null }> {
  const u = new URL(url);
  const base = siteBase(url);
  const candidates: string[] = [];
  if (homepageHtml) {
    const ranked: Array<{ url: string; rank: number }> = [];
    const re = /<a\b[^>]*?\bhref\s*=\s*["']([^"'<>\s]{1,2048})["']/gi;
    let m: RegExpExecArray | null;
    for (let n = 0; (m = re.exec(homepageHtml)) !== null && n < 5000; n++) {
      try {
        const link = new URL(m[1], url);
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
    const depth = new URL(c).pathname.split("/").filter(Boolean).length;
    if (depth >= 2) return { pages: [c], index: null };
    const r = await timedFetch(c, {
      method: "GET",
      headers: { "User-Agent": STATIC_UA },
      redirect: "follow",
    });
    if (!r || !r.ok) {
      r?.discard();
      continue;
    }
    const html = await readHtml(r);
    const finalUrl = r.url || c;
    if (isExcludedContentPath(new URL(finalUrl).pathname)) continue;
    if (isEmptyShell(html)) continue;
    const children = caseStudyChildren(html, finalUrl);
    if (children.length >= MIN_INDEX_CHILDREN) return { pages: [children[0]], index: finalUrl };
    return { pages: [finalUrl], index: null };
  }
  return { pages: [], index: null };
}

interface ScannabilityBreakdown {
  url: string;
  headings: boolean;
  lists: boolean;
  bold: boolean;
  score: number;
}

async function scorePageScannability(
  pageUrl: string
): Promise<ScannabilityBreakdown | null> {
  const r = await timedFetch(pageUrl, {
    headers: { "User-Agent": STATIC_UA },
    redirect: "follow",
  });
  if (!r || !r.ok) {
    r?.discard();
    return null;
  }
  const html = await readHtml(r);

  const h2h3Count = (html.match(/<h[23]\b[^>]*>/gi) ?? []).length;
  const headings = h2h3Count >= 3;

  const lists = /<ul\b|<ol\b/i.test(html);
  const bold = /<(strong|b)\b[^>]*>\s*\S/i.test(html);

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

  const { pages: paths, index } = await findCaseStudyPaths(url, homepageHtml);
  if (paths.length === 0) {
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

  const breakdowns: ScannabilityBreakdown[] = [];
  for (const p of paths) {
    const b = await scorePageScannability(p);
    if (b) breakdowns.push(b);
  }

  if (breakdowns.length === 0) {
    return {
      id,
      name,
      weight,
      score: 0,
      passed: false,
      notes: `Detected case-study paths (${paths.join(", ")}) but none returned 200.`,
    };
  }

  const avg = Math.round(
    breakdowns.reduce((s, b) => s + b.score, 0) / breakdowns.length
  );
  const breakdownStr = breakdowns
    .map(
      (b) =>
        `${b.url} → ${b.score} (h:${b.headings ? "✓" : "✗"} l:${b.lists ? "✓" : "✗"} b:${b.bold ? "✓" : "✗"})`
    )
    .join("; ");

  return {
    id,
    name,
    weight,
    score: avg,
    passed: avg >= 70,
    notes: `Sampled ${breakdowns.length} page(s); avg ${avg}/100. ${breakdownStr}.${index ? ` (A case study linked from the index page ${index}.)` : ""}`,
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
  subs.push(await runMarkdownNegotiation(targetUrl));
  subs.push(await runPricingTextVisibility(targetUrl, staticBody));
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
