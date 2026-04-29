// Dim 5 — Agent-Parsable Content
//
// Five sub-checks (weights from OQ-04 §2 Dim 5):
//   1. js_vs_no_js_render_diff (30%)  — paid uses Browser Rendering, free is static-only with disclosure
//   2. page_weight_lcp (15%)          — HTML weight always; LCP only on paid (BR)
//   3. markdown_negotiation (25%)     — same on free + paid
//   4. pricing_text_visibility (20%)  — N/A if no pricing page found (weight redistributed)
//   5. case_study_scannability (10%)  — heuristic only, no LLM (per Slice 2a constraint)
//
// Browser Rendering invocation: REST API per the same pattern audit-fulfill PDF
// generation uses. Reuses CF_API_TOKEN + CF_ACCOUNT_ID. Soft daily cap via the
// br-budget util.

import type { DimensionResult, Env, ScanTier, SubCheck } from "../types";
import { dimensionScore, gradeFor } from "../scoring";
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

async function timedFetch(
  url: string,
  init?: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<Response | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctl.signal, redirect: "follow" });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

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
  if (!res || !res.ok) return null;
  const data = (await res.json()) as {
    success?: boolean;
    result?: string;
  };
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
      notes: `${describeStaticAlone(staticBody)}. Browser Rendering daily cap reached; falling back to static signal. Re-run tomorrow for full diff.`,
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
      notes: `${describeStaticAlone(staticBody)}. Browser Rendering call failed; scored on static signal only.`,
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

async function runPageWeightLcp(
  url: string,
  tier: ScanTier,
  staticBody: string | null,
  staticContentLength: number | null
): Promise<SubCheck> {
  const id = "page_weight_lcp";
  const name = "Page weight + LCP";
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

  const lcpNote =
    tier === "paid"
      ? "LCP not measured (Browser Rendering /content endpoint does not expose timings; deferred to a future paid-tier upgrade)"
      : "LCP not measured (free tier)";

  return {
    id,
    name,
    weight,
    score,
    passed: score >= 70,
    notes: `Page weight ${mb.toFixed(2)}MB (${bodyBytes} bytes); ${lcpNote}.`,
  };
}

// ── Sub-check 3: markdown_negotiation ────────────────────────────────────

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

  if (mdRes && mdRes.ok && (mdCt.includes("text/markdown") || finalUrlIsMd)) {
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
  const u = new URL(url);
  const candidates = [
    `${u.origin}/index.md`,
    `${u.origin}${u.pathname.replace(/\/$/, "")}.md`,
    `${u.origin}/llms.txt`, // sites using llms.txt as their canonical machine-readable file
  ];
  for (const c of candidates) {
    const r = await timedFetch(c, {
      headers: { "User-Agent": STATIC_UA },
      redirect: "follow",
    });
    if (r && r.ok) {
      const ct = (r.headers.get("content-type") ?? "").toLowerCase();
      if (ct.includes("text/markdown") || ct.includes("text/plain") || c.endsWith(".md")) {
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

const PRICE_TEXT_RE = /\$\d{1,5}(?:[.,]\d{2,3})?\s*(?:\/|per)\s*(?:month|mo|year|yr|user|seat)/i;
const PRICE_BARE_RE = /\$\d{1,5}(?:[.,]\d{2,3})?(?!\d)/g;
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
        const r = await timedFetch(resolved, {
          headers: { "User-Agent": STATIC_UA },
          redirect: "follow",
        });
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
        "No /pricing, /plans, or /price path found, and no pricing-link discovered on homepage. Weight redistributed across other Dim 5 sub-checks.",
      na: true,
    };
  }

  const r = await timedFetch(pricingUrl, {
    headers: { "User-Agent": STATIC_UA },
    redirect: "follow",
  });
  if (!r || !r.ok) {
    return {
      id,
      name,
      weight,
      score: 0,
      passed: false,
      notes: `Detected pricing path ${pricingUrl} but it didn't return 200.`,
    };
  }
  const html = await r.text();
  const text = stripTags(html);
  const structuredMatches = (text.match(/\$\d{1,5}(?:[.,]\d{2,3})?\s*(?:\/|per)\s*(?:month|mo|year|yr|user|seat)/gi) ?? []).length;
  const bareMatches = (text.match(PRICE_BARE_RE) ?? []).length;
  const totalPriceTokens = bareMatches; // structured is a subset of bare

  // Penalize if every price-looking string is wrapped in modal-suggesting classes.
  const allInModal = totalPriceTokens > 0 && MODAL_CLASS_RE.test(html) && bareMatches === 0;

  let score: number;
  let detail: string;
  if (structuredMatches > 0 || (totalPriceTokens >= 2 && !allInModal)) {
    score = 100;
    detail = `${totalPriceTokens} text-based price token(s); ${structuredMatches} with /period suffix`;
  } else if (totalPriceTokens >= 1 || (allInModal && totalPriceTokens >= 1)) {
    score = 50;
    detail = allInModal
      ? `prices found but appear inside modal-suggesting markup`
      : `${totalPriceTokens} price token(s) but none with /period suffix`;
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

async function findCaseStudyPaths(
  url: string,
  homepageHtml: string | null
): Promise<string[]> {
  const u = new URL(url);
  const indexCandidates = [
    `${u.origin}/case-studies`,
    `${u.origin}/customers`,
    `${u.origin}/success-stories`,
  ];
  const found: string[] = [];
  for (const c of indexCandidates) {
    const r = await timedFetch(c, {
      method: "GET",
      headers: { "User-Agent": STATIC_UA },
      redirect: "follow",
    });
    if (r && r.ok) {
      // Try to pull up to 2 sample child pages from the index.
      const html = await r.text();
      const childRe =
        /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi;
      const seen = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = childRe.exec(html)) !== null && seen.size < 6) {
        try {
          const resolved = new URL(m[1], r.url).toString();
          const path = new URL(resolved).pathname;
          if (
            (path.includes("/customers/") ||
              path.includes("/case-studies/") ||
              path.includes("/case-study/") ||
              path.includes("/success-stories/")) &&
            path.split("/").length > 3
          ) {
            seen.add(resolved);
          }
        } catch {
          // ignore
        }
      }
      const arr = [...seen].slice(0, 2);
      if (arr.length > 0) {
        found.push(...arr);
      } else {
        found.push(r.url || c);
      }
      break;
    }
  }
  // Fallback: probe homepage for case-study anchors.
  if (found.length === 0 && homepageHtml) {
    const re = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>(?:\s|<[^>]+>)*([^<]*(?:case stud|customer|success stor)[^<]*)/gi;
    let m: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((m = re.exec(homepageHtml)) !== null && seen.size < 2) {
      try {
        const resolved = new URL(m[1], url).toString();
        seen.add(resolved);
      } catch {
        // ignore
      }
    }
    found.push(...seen);
  }
  return found.slice(0, 2);
}

interface ScannabilityBreakdown {
  url: string;
  headings: boolean;
  metrics: boolean;
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
  if (!r || !r.ok) return null;
  const html = await r.text();

  const h2h3Count = (html.match(/<h[23]\b[^>]*>/gi) ?? []).length;
  const headings = h2h3Count >= 3;

  const text = stripTags(html);
  const metricRe =
    /\b\d+(?:\.\d+)?\s*(?:%|x faster|×|x|hours? saved|users?\b|customers?\b)/gi;
  const metricCount = (text.match(metricRe) ?? []).length;
  const metrics = metricCount >= 2;

  const lists = /<ul\b|<ol\b/i.test(html);
  const bold = /<(strong|b)\b[^>]*>\s*\S/i.test(html);

  let score = 0;
  if (headings) score += 30;
  if (metrics) score += 30;
  if (lists) score += 20;
  if (bold) score += 20;

  return { url: pageUrl, headings, metrics, lists, bold, score };
}

async function runCaseStudyScannability(
  url: string,
  homepageHtml: string | null
): Promise<SubCheck> {
  const id = "case_study_scannability";
  const name = "Case-study scannability";
  const weight = 10;

  const paths = await findCaseStudyPaths(url, homepageHtml);
  if (paths.length === 0) {
    return {
      id,
      name,
      weight,
      score: 0,
      passed: false,
      notes:
        "No case-study path detected (/case-studies, /customers, /success-stories, or homepage anchors). Weight redistributed across other Dim 5 sub-checks.",
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
        `${b.url} → ${b.score} (h:${b.headings ? "✓" : "✗"} m:${b.metrics ? "✓" : "✗"} l:${b.lists ? "✓" : "✗"} b:${b.bold ? "✓" : "✗"})`
    )
    .join("; ");

  return {
    id,
    name,
    weight,
    score: avg,
    passed: avg >= 70,
    notes: `Sampled ${breakdowns.length} page(s); avg ${avg}/100. ${breakdownStr}.`,
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
    try {
      staticBody = await homeRes.text();
    } catch {
      staticBody = null;
    }
  }

  const subs: SubCheck[] = [];
  // Sequential where it makes sense (shared homepage fetch already done).
  // Parallel would hammer the target site; serial is fine for v1.
  subs.push(await runJsVsNoJsRenderDiff(targetUrl, env, tier, staticBody));
  subs.push(await runPageWeightLcp(targetUrl, tier, staticBody, contentLength));
  subs.push(await runMarkdownNegotiation(targetUrl));
  subs.push(await runPricingTextVisibility(targetUrl, staticBody));
  subs.push(await runCaseStudyScannability(targetUrl, staticBody));

  const score = dimensionScore(subs);
  return {
    dimension_id: 5,
    dimension_name: "Agent-Parsable Content",
    score,
    grade: gradeFor(score),
    sub_checks: subs,
  };
}
