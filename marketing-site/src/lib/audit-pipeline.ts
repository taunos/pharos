// Audit fulfillment pipeline.
//
// Sequence: scan → enrich gaps with LLM-written remediation → render HTML →
// rasterize to PDF via Cloudflare Browser Rendering REST API → store PDF +
// JSON in R2.
//
// Browser Rendering deviation from the original spec: we call the REST API
// (POST /accounts/<id>/browser-rendering/pdf) instead of binding via
// `@cloudflare/puppeteer`. The puppeteer SDK route adds ~MB to the bundle
// and is fragile in OpenNext / Next.js Worker builds. The REST path needs
// CF_ACCOUNT_ID (vars) and CF_API_TOKEN (secret) instead of a `browser`
// binding in wrangler.jsonc.

import type {
  AuditResult,
  GapWithRemediation,
  ScanResult,
  SubCheck,
} from "./audit-types";

const SCANNER_URL =
  "https://pharos-scanner.pharos-dev.workers.dev/api/scan";

const REMEDIATION_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const REMEDIATION_CACHE_TTL = 30 * 24 * 60 * 60;
const REMEDIATION_ENGINE_VERSION = "v3";

/**
 * Per-check description of WHAT THE CHECK EXAMINES — the artifact (file, DNS record,
 * schema block, etc.) the remediation must operate on. Passed into the LLM prompt
 * so the model grounds its remediation in the correct subject instead of defaulting
 * to "the homepage." See TF-18 in the Score MVP roadmap.
 */
export const CHECK_SUBJECTS: Record<string, string> = {
  // Dimension 1 — llms.txt Quality (all sub-checks operate on the /llms.txt file)
  presence: "the `/llms.txt` file at the site root",
  spec_compliance:
    "the structure of the `/llms.txt` file (its first H1 and blockquote summary)",
  linked_pages_quality: "the pages linked from inside the `/llms.txt` file",
  curation_quality: "the link list inside the `/llms.txt` file",
  blockquote_eval: "the blockquote summary inside the `/llms.txt` file",

  // Dimension 2 — MCP Server Discoverability (varied subjects)
  well_known:
    "the discovery card at `/.well-known/mcp.json` (or `/.well-known/mcp/server-card.json`)",
  tool_coverage: "the `tools[]` array inside the MCP server discovery card",
  oauth_metadata:
    "the OAuth metadata at `/.well-known/oauth-authorization-server`",
  live_invocation: "the transport URL declared in the MCP server discovery card",
  dns_txt: "the DNS TXT record at `_mcp.<your-domain>`",

  // Dimension 4 — Structured Capability Data (JSON-LD on various pages)
  json_ld_present: "the JSON-LD `<script>` block(s) on the homepage",
  organization_schema: "the Organization JSON-LD block on the homepage",
  service_offer_schema:
    "the Service / Product / Offer JSON-LD on commercial pages (homepage, pricing, services)",
  faq_schema: "the FAQPage JSON-LD on the homepage or a dedicated FAQ page",
  review_schema: "the Review or AggregateRating JSON-LD on relevant pages",

  // Dimension 5 — Agent-Parsable Content (Slice 2a)
  js_vs_no_js_render_diff:
    "the rendered HTML of your homepage and key commercial pages (the difference between what static HTTP clients see and what JavaScript-rendered DOM produces)",
  page_weight_lcp:
    "the page weight and load timing of your key public pages (homepage, pricing, services)",
  markdown_negotiation:
    "your server's handling of `Accept: text/markdown` requests, and any `.md` variants of your key pages",
  pricing_text_visibility:
    "your pricing page's price visibility — whether prices appear as plain text or are gated behind images, modals, or login walls",
  case_study_scannability:
    "the structure of your case study pages — headings, plain-text metrics, and skim-friendly markup",

  // Dimensions 3, 6 — to be populated as those checks ship in Slice 3.
};

const DEFAULT_CHECK_SUBJECT = "the relevant artifact for this check";

/**
 * Per-check keyword set for the subject-coherence validator. The remediation must
 * contain (case-insensitive) at least one of the listed keywords. False negatives
 * are caught by retry-with-feedback; the templated fallback is the floor.
 */
export const CHECK_SUBJECT_KEYWORDS: Record<string, string[]> = {
  // Dimension 1 — every check is about the llms.txt file
  presence: ["llms.txt"],
  spec_compliance: ["llms.txt"],
  linked_pages_quality: ["llms.txt"],
  curation_quality: ["llms.txt"],
  blockquote_eval: ["llms.txt"],

  // Dimension 2
  well_known: ["mcp.json", ".well-known", "discovery card", "server card"],
  tool_coverage: ["mcp", "server card", "discovery card", "tools["],
  oauth_metadata: ["oauth", ".well-known"],
  live_invocation: ["mcp", "transport", "server card", "discovery card"],
  dns_txt: ["dns", "txt record", "_mcp"],

  // Dimension 4 — JSON-LD schemas
  json_ld_present: ["json-ld", "schema"],
  organization_schema: ["organization", "json-ld", "schema"],
  service_offer_schema: ["service", "product", "offer", "json-ld", "schema"],
  faq_schema: ["faqpage", "faq", "json-ld", "schema"],
  review_schema: ["review", "aggregaterating", "json-ld", "schema"],

  // Dimension 5 — Agent-Parsable Content
  js_vs_no_js_render_diff: [
    "javascript",
    "render",
    "static",
    "spa",
    "rendered html",
    "dom",
  ],
  page_weight_lcp: ["page weight", "lcp", "load time", "page size", "performance"],
  markdown_negotiation: [
    "markdown",
    "accept",
    "text/markdown",
    ".md",
    "content negotiation",
  ],
  pricing_text_visibility: [
    "pricing",
    "price",
    "modal",
    "image",
    "login wall",
    "text-based",
  ],
  case_study_scannability: [
    "case stud",
    "customer stor",
    "success stor",
    "headings",
    "metrics",
    "scannab",
  ],
};

export type AuditEnv = {
  AI: Ai;
  SESSIONS: KVNamespace;
  AUDITS: R2Bucket;
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
};

export async function runScan(
  url: string,
  internalFulfillKey?: string
): Promise<ScanResult> {
  // audit-fulfill is a paid-tier scan: full Browser Rendering for Dim 5's
  // js_vs_no_js_render_diff. We send tier="paid" plus the same internal
  // fulfill key so the scanner accepts it; without the key the scanner
  // silently degrades to free-tier (graceful, not an error).
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (internalFulfillKey) {
    headers["x-internal-fulfill-key"] = internalFulfillKey;
  }
  const res = await fetch(SCANNER_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ url, tier: internalFulfillKey ? "paid" : "free" }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Scanner returned ${res.status}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as ScanResult;
}

function isGap(s: SubCheck): boolean {
  return s.score < 100;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function subjectFor(checkId: string): string {
  return CHECK_SUBJECTS[checkId] ?? DEFAULT_CHECK_SUBJECT;
}

function buildRemediationPrompt(
  scanUrl: string,
  check: SubCheck,
  checkSubject: string
): string {
  return `You are generating remediation guidance for a single Agent Engine Optimization (AEO) check finding on one specific website. Your output is a single short paragraph that will appear in a paid PDF audit report. Customer trust depends on accuracy.

SITE BEING AUDITED: ${scanUrl}
WHAT THIS CHECK EXAMINES: ${checkSubject}

CRITICAL CONSTRAINTS — violating any of these breaks the audit's value:

1. SUBJECT-GROUNDED CONSTRAINT. Your remediation MUST be about WHAT THIS CHECK EXAMINES (above). The check examines a specific artifact — a file, a DNS record, a schema block, a discovery card, etc. Your remediation must operate on that artifact. Do not redirect the customer to fix a different artifact (do not, for example, default to "the homepage" when the subject is the /llms.txt file or a DNS record).

2. SINGLE-DOMAIN CONSTRAINT. Your remediation MUST apply only to ${scanUrl}. Never reference any other domain, URL, or website in your output. If you mention a URL, it must be on the same host as ${scanUrl}. When in doubt, do not mention any URL.

3. STACK-AGNOSTIC CONSTRAINT. You do not know which framework, language, or file structure the site uses. Do NOT reference specific file names like "index.html", "pharos.json", "public/", "src/", "layout.tsx", or any specific build tool. Use stack-agnostic phrasing for HOW to make the change — but be specific about WHAT artifact is being changed (the subject above).

4. NOTES-GROUNDED CONSTRAINT. The "Notes" field below describes the ACTUAL state observed — read it carefully. The "Check name" is a category label only. If the notes say something already exists but scores poorly (e.g. "7 Q&As detected, conversational eval 34/100"), do NOT recommend adding what already exists; recommend improving its quality. If the notes say something is missing, recommend creating or adding it.

5. SPECIFICITY CONSTRAINT. The remediation must address what the notes describe, not the check name in the abstract. Quote or paraphrase a relevant detail from the notes in your remediation so it's clear you read them.

FINDING:
- Check name: ${check.name}
- What this check examines: ${checkSubject}
- Score: ${check.score}/100 (weight ${check.weight}% within its dimension)
- Notes from the scanner: ${check.notes}

OUTPUT FORMAT:
A single paragraph, 2 to 4 sentences. Start by naming the subject (from WHAT THIS CHECK EXAMINES) and the specific change to make to it (grounded in the notes). Describe the change in stack-agnostic terms for the HOW, but specific about the WHAT (the subject). End with exactly: "Estimated effort: <duration>." where <duration> is one of:

- "under 30 minutes" — only when the change is trivial (single field add, copy-paste of standard markup)
- "30 minutes to 1 hour" — typical config or small file edit
- "1 to 2 hours" — typical schema authoring or content writing
- "2 to 4 hours" — involves writing, rewriting, or coordinating across multiple files
- "4+ hours" — complex multi-step changes (DNS + content + multiple schemas)

Default to the LONGER estimate when uncertain. Do not under-promise effort.

Output ONLY the remediation paragraph. No preamble, no markdown headers, no JSON wrapping. Plain text.`;
}

function buildRetryPrompt(
  originalPrompt: string,
  failedRemediation: string,
  reason: string
): string {
  return `${originalPrompt}

YOUR PREVIOUS ATTEMPT WAS REJECTED.

Previous output:
${failedRemediation}

Rejection reason: ${reason}

Try again. Strictly obey the constraints above. Do not repeat the rejected output.`;
}

export type RemediationValidation =
  | { valid: true }
  | { valid: false; reason: string };

export function validateRemediation(
  remediation: string,
  scanUrl: string,
  checkId: string
): RemediationValidation {
  const scanHost = (() => {
    try {
      return new URL(scanUrl).host;
    } catch {
      return null;
    }
  })();

  // 1. URL guard — no foreign domains
  if (scanHost) {
    const urlMatches = remediation.match(/https?:\/\/[^\s)\]'"]+/g) ?? [];
    for (const m of urlMatches) {
      try {
        const host = new URL(m).host;
        if (host !== scanHost) {
          return {
            valid: false,
            reason: `foreign domain in remediation: ${host}`,
          };
        }
      } catch {
        // malformed URL — let it pass; not our problem here
      }
    }
  }

  // 2. Fabricated-path guard
  const forbidden: RegExp[] = [
    /\bindex\.html\b/i,
    /\bpharos\.json\b/i,
    /\bpublic\/[a-z0-9_.-]+\.(html|json|txt)\b/i,
  ];
  for (const re of forbidden) {
    if (re.test(remediation)) {
      return { valid: false, reason: `forbidden path pattern: ${re.source}` };
    }
  }

  // 3. Subject-coherence guard — keyword presence (low precision, high recall).
  const subjectCheck = validateSubjectCoherence(remediation, checkId);
  if (!subjectCheck.valid) return subjectCheck;

  return { valid: true };
}

function validateSubjectCoherence(
  remediation: string,
  checkId: string
): RemediationValidation {
  const keywords = CHECK_SUBJECT_KEYWORDS[checkId];
  if (!keywords || keywords.length === 0) {
    console.warn(
      `[validateSubjectCoherence] no keyword set for check_id=${checkId}; skipping`
    );
    return { valid: true };
  }
  const lower = remediation.toLowerCase();
  const matched = keywords.some((kw) => lower.includes(kw.toLowerCase()));
  if (!matched) {
    return {
      valid: false,
      reason: `remediation does not reference subject. Expected one of: ${keywords.join(" | ")}. Received: "${remediation.slice(0, 200)}..."`,
    };
  }
  return { valid: true };
}

function fallbackRemediation(check: SubCheck): string {
  const trimmed = check.notes.trim().replace(/\s+/g, " ").slice(0, 240);
  const checkSubject = subjectFor(check.id);
  return `This check scored ${check.score}/100 because: ${trimmed}. Review ${checkSubject} on your site and address what the notes describe. Estimated effort: 1 to 2 hours.`;
}

async function callModel(
  env: AuditEnv,
  prompt: string
): Promise<string> {
  try {
    const r = (await env.AI.run(REMEDIATION_MODEL, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 250,
      temperature: 0,
      seed: 42,
    })) as { response?: string };
    return (r.response ?? "").trim();
  } catch {
    return "";
  }
}

async function enrichGap(
  env: AuditEnv,
  scanUrl: string,
  sessionId: string,
  check: SubCheck
): Promise<string> {
  // v2 cache key: includes scanUrl so per-site remediations don't bleed across
  // tenants, and bumps the version to invalidate the broken-prompt v1 entries.
  const cacheInput = `${scanUrl}|${check.id}|${check.score}|${check.notes}`;
  const cacheKey = `audit:remediation:${REMEDIATION_ENGINE_VERSION}:${await sha256Hex(cacheInput)}`;

  const cached = await env.SESSIONS.get(cacheKey);
  if (cached !== null) return cached;

  const checkSubject = subjectFor(check.id);
  const prompt = buildRemediationPrompt(scanUrl, check, checkSubject);

  // First attempt.
  let raw = await callModel(env, prompt);
  let result: string | null = null;
  if (raw) {
    const v = validateRemediation(raw, scanUrl, check.id);
    if (v.valid) {
      result = raw;
    } else {
      // Retry once with the validator's reason fed back in.
      const retryPrompt = buildRetryPrompt(prompt, raw, v.reason);
      const raw2 = await callModel(env, retryPrompt);
      if (raw2) {
        const v2 = validateRemediation(raw2, scanUrl, check.id);
        if (v2.valid) {
          result = raw2;
        } else {
          console.warn(
            `[audit-fulfill] remediation validator failed twice (session=${sessionId}, check=${check.id}): first="${v.reason}", retry="${v2.reason}"; using fallback.`
          );
        }
      } else {
        console.warn(
          `[audit-fulfill] remediation retry returned empty (session=${sessionId}, check=${check.id}); using fallback.`
        );
      }
    }
  } else {
    console.warn(
      `[audit-fulfill] remediation initial call returned empty (session=${sessionId}, check=${check.id}); using fallback.`
    );
  }

  if (result === null) {
    result = fallbackRemediation(check);
  }

  await env.SESSIONS.put(cacheKey, result, {
    expirationTtl: REMEDIATION_CACHE_TTL,
  });
  return result;
}

export async function llmEnrichGaps(
  env: AuditEnv,
  scan: ScanResult,
  sessionId: string
): Promise<GapWithRemediation[]> {
  const tasks: Promise<GapWithRemediation>[] = [];
  for (const dim of scan.dimensions) {
    for (const sc of dim.sub_checks) {
      if (!isGap(sc)) continue;
      tasks.push(
        enrichGap(env, scan.url, sessionId, sc).then((rem) => ({
          dimension_id: dim.dimension_id,
          dimension_name: dim.dimension_name,
          check_id: sc.id,
          check_name: sc.name,
          weight: sc.weight,
          score: sc.score,
          notes: sc.notes,
          remediation: rem,
        }))
      );
    }
  }
  const out = await Promise.all(tasks);
  out.sort((a, b) => {
    const da = a.dimension_id - b.dimension_id;
    if (da !== 0) return da;
    return a.score - b.score;
  });
  return out;
}

export const REMEDIATION_ENGINE_VERSION_TAG = REMEDIATION_ENGINE_VERSION;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function gradeColor(grade: string): string {
  if (grade.startsWith("A")) return "#34d399";
  if (grade.startsWith("B")) return "#6ee7b7";
  if (grade === "C") return "#facc15";
  if (grade === "D") return "#fb923c";
  return "#f87171";
}

function scoreBarColor(score: number): string {
  if (score >= 70) return "#34d399";
  if (score >= 60) return "#facc15";
  if (score >= 40) return "#fb923c";
  return "#f87171";
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace(/\..+$/, " UTC");
}

export function renderAuditHtml(audit: AuditResult, sessionId: string): string {
  const { scan, gaps } = audit;
  const dimsHtml = scan.dimensions
    .map((d) => {
      const subs = d.sub_checks
        .map(
          (s) => `
        <tr>
          <td class="check-name">${escapeHtml(s.name)}</td>
          <td class="check-score">${s.score}/100</td>
          <td class="check-weight">${s.weight}%</td>
          <td class="check-notes">${escapeHtml(s.notes)}</td>
        </tr>`
        )
        .join("");
      return `
      <section class="dim">
        <div class="dim-head">
          <h3>${escapeHtml(d.dimension_name)}</h3>
          <div class="dim-score">
            <span class="dim-num">${d.score}</span>
            <span class="dim-grade" style="color:${gradeColor(d.grade)}">${escapeHtml(d.grade)}</span>
          </div>
        </div>
        <div class="bar"><div class="bar-fill" style="width:${Math.max(0, Math.min(100, d.score))}%;background:${scoreBarColor(d.score)}"></div></div>
        <table class="checks">
          <thead><tr><th>Check</th><th>Score</th><th>Weight</th><th>Notes</th></tr></thead>
          <tbody>${subs}</tbody>
        </table>
      </section>`;
    })
    .join("");

  const gapsHtml =
    gaps.length === 0
      ? `<p class="empty">No gaps found — every sub-check scored 100. Clean pass.</p>`
      : gaps
          .map(
            (g) => `
        <article class="gap">
          <header>
            <h3>${escapeHtml(g.check_name)}</h3>
            <div class="gap-meta">
              <span class="gap-dim">${escapeHtml(g.dimension_name)}</span>
              <span class="gap-score">${g.score}/100 · weight ${g.weight}%</span>
            </div>
          </header>
          <p class="gap-finding"><strong>Finding:</strong> ${escapeHtml(g.notes)}</p>
          <p class="gap-remediation"><strong>Remediation:</strong> ${escapeHtml(g.remediation)}</p>
        </article>`
          )
          .join("");

  const jsonExport = JSON.stringify(audit, null, 2);
  const sessionShort = sessionId.slice(0, 8);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Astrant Audit — ${escapeHtml(scan.url)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; line-height: 1.5; font-size: 11pt; }
  h1, h2, h3 { line-height: 1.25; margin: 0; }
  h1 { font-size: 28pt; font-weight: 700; letter-spacing: -0.02em; }
  h2 { font-size: 18pt; font-weight: 700; margin-top: 28pt; padding-top: 12pt; border-top: 1px solid #e2e8f0; }
  h3 { font-size: 13pt; font-weight: 600; }
  p { margin: 8pt 0; }
  .header { display: flex; align-items: baseline; justify-content: space-between; gap: 24pt; padding-bottom: 12pt; border-bottom: 2px solid #0f172a; }
  .brand { font-size: 14pt; font-weight: 700; letter-spacing: 0.04em; }
  .timestamp { font-size: 9pt; color: #64748b; font-family: ui-monospace, "SF Mono", monospace; }
  .url-row { margin-top: 18pt; font-family: ui-monospace, "SF Mono", monospace; font-size: 11pt; color: #334155; word-break: break-all; }
  .composite { display: flex; align-items: baseline; gap: 16pt; margin-top: 12pt; }
  .composite-num { font-size: 56pt; font-weight: 700; letter-spacing: -0.03em; line-height: 1; }
  .composite-grade { font-size: 28pt; font-weight: 600; font-family: ui-monospace, "SF Mono", monospace; }
  .scope { margin-top: 8pt; font-size: 10pt; color: #64748b; font-style: italic; }
  .dim { margin-top: 18pt; page-break-inside: avoid; }
  .dim-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12pt; }
  .dim-score { display: flex; align-items: baseline; gap: 8pt; }
  .dim-num { font-size: 18pt; font-weight: 700; }
  .dim-grade { font-size: 12pt; font-weight: 600; font-family: ui-monospace, "SF Mono", monospace; }
  .bar { height: 6pt; background: #f1f5f9; border-radius: 3pt; overflow: hidden; margin-top: 6pt; }
  .bar-fill { height: 100%; }
  table.checks { width: 100%; border-collapse: collapse; margin-top: 10pt; font-size: 9.5pt; }
  table.checks th { text-align: left; font-weight: 600; color: #475569; border-bottom: 1px solid #e2e8f0; padding: 5pt 4pt; }
  table.checks td { padding: 5pt 4pt; vertical-align: top; border-bottom: 1px solid #f1f5f9; }
  td.check-name { font-weight: 500; width: 28%; }
  td.check-score, td.check-weight { font-family: ui-monospace, "SF Mono", monospace; color: #475569; width: 9%; white-space: nowrap; }
  td.check-notes { color: #475569; }
  .gap { padding: 10pt 12pt; margin-top: 10pt; border-left: 3pt solid #f87171; background: #fff1f2; border-radius: 2pt; page-break-inside: avoid; }
  .gap header { display: flex; justify-content: space-between; align-items: baseline; gap: 12pt; margin-bottom: 6pt; }
  .gap-meta { font-size: 9pt; color: #64748b; font-family: ui-monospace, "SF Mono", monospace; display: flex; gap: 10pt; flex-shrink: 0; }
  .gap-finding { margin: 4pt 0; font-size: 10pt; color: #475569; }
  .gap-remediation { margin: 6pt 0 0 0; font-size: 10.5pt; color: #0f172a; }
  .empty { font-style: italic; color: #64748b; }
  pre.json { font-family: ui-monospace, "SF Mono", monospace; font-size: 7.5pt; color: #334155; background: #f8fafc; padding: 10pt; border-radius: 3pt; white-space: pre-wrap; word-wrap: break-word; }
  footer { margin-top: 32pt; padding-top: 12pt; border-top: 1px solid #e2e8f0; font-size: 9pt; color: #64748b; }
  footer a { color: #0f172a; text-decoration: none; border-bottom: 1px solid #cbd5e1; }
</style>
</head>
<body>
  <div class="header">
    <span class="brand">PHAROS · AEO Audit</span>
    <span class="timestamp">Generated ${formatTimestamp(scan.created_at)} · session ${escapeHtml(sessionShort)}</span>
  </div>

  <div class="url-row">${escapeHtml(scan.url)}</div>

  <div class="composite">
    <span class="composite-num">${scan.composite.score}</span>
    <span class="composite-grade" style="color:${gradeColor(scan.composite.grade)}">${escapeHtml(scan.composite.grade)}</span>
  </div>
  <p class="scope">Scored on ${scan.dimensions_scored} of ${scan.dimensions_total} dimensions. The remaining dimensions ship in upcoming scanner releases — re-running this audit later will pick them up automatically.</p>

  <h2>Dimension breakdown</h2>
  ${dimsHtml}

  <h2>Prioritized gaps + remediation</h2>
  <p>Sub-checks scoring below 100, ordered by lowest score first. Each gap includes specific remediation guidance generated for your site by our analysis engine.</p>
  ${gapsHtml}

  <h2>Machine-readable export</h2>
  <p>The full scan + remediation payload as JSON. The same JSON is also available as a separate download from your audit results page.</p>
  <pre class="json">${escapeHtml(jsonExport)}</pre>

  <footer>
    Generated by Astrant. Re-scan anytime at <a href="https://astrant.io/score">astrant.io/score</a>.
    Re-run the full audit at <a href="https://astrant.io/audit">astrant.io/audit</a>.
  </footer>
</body>
</html>`;
}

export async function generatePdf(
  env: AuditEnv,
  html: string
): Promise<ArrayBuffer> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/pdf`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      html,
      pdfOptions: {
        format: "a4",
        printBackground: true,
        margin: {
          top: "16mm",
          bottom: "16mm",
          left: "14mm",
          right: "14mm",
        },
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Browser Rendering PDF failed: ${res.status} ${body.slice(0, 500)}`
    );
  }
  return await res.arrayBuffer();
}

export async function storePdf(
  env: AuditEnv,
  sessionId: string,
  pdf: ArrayBuffer
): Promise<void> {
  await env.AUDITS.put(`audits/${sessionId}.pdf`, pdf, {
    httpMetadata: { contentType: "application/pdf" },
  });
}

export async function storeJson(
  env: AuditEnv,
  sessionId: string,
  audit: AuditResult
): Promise<void> {
  await env.AUDITS.put(
    `audits/${sessionId}.json`,
    JSON.stringify(audit, null, 2),
    { httpMetadata: { contentType: "application/json" } }
  );
}
