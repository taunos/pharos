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

export type AuditEnv = {
  AI: Ai;
  SESSIONS: KVNamespace;
  AUDITS: R2Bucket;
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
};

export async function runScan(url: string): Promise<ScanResult> {
  const res = await fetch(SCANNER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
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

function buildRemediationPrompt(
  url: string,
  dimensionName: string,
  check: SubCheck
): string {
  return `You write remediation guides for a developer-facing AEO (Agent Engine Optimization) audit.

The site at ${url} failed the "${check.name}" check (dimension: "${dimensionName}", score: ${check.score}/100).

Finding notes from the scanner:
${check.notes}

Write 2-3 sentences of specific, actionable remediation guidance for a developer. Be concrete — name specific files, fields, or pages. Include an estimated effort like "30 min" or "2-3 hours".

Example tone:
"Add a JSON-LD Organization schema to your homepage with name, url, description, and at least 3 sameAs entries pointing to your social profiles. Estimated effort: 30 min."

Respond with ONLY the remediation paragraph — no preamble, no JSON, no markdown.`;
}

async function enrichGap(
  env: AuditEnv,
  url: string,
  dimensionName: string,
  check: SubCheck
): Promise<string> {
  const cacheInput = `${check.id}|${check.score}|${check.notes}`;
  const cacheKey = `audit:remediation:v1:${await sha256Hex(cacheInput)}`;

  const cached = await env.SESSIONS.get(cacheKey);
  if (cached !== null) return cached;

  const prompt = buildRemediationPrompt(url, dimensionName, check);
  let raw = "";
  try {
    const r = (await env.AI.run(REMEDIATION_MODEL, {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 220,
      temperature: 0,
      seed: 42,
    })) as { response?: string };
    raw = (r.response ?? "").trim();
  } catch {
    raw = "";
  }
  if (!raw) {
    raw = `Address the "${check.name}" gap based on the scanner notes above. Effort varies by site (typically 1-3 hours).`;
  }

  await env.SESSIONS.put(cacheKey, raw, {
    expirationTtl: REMEDIATION_CACHE_TTL,
  });
  return raw;
}

export async function llmEnrichGaps(
  env: AuditEnv,
  scan: ScanResult
): Promise<GapWithRemediation[]> {
  const tasks: Promise<GapWithRemediation>[] = [];
  for (const dim of scan.dimensions) {
    for (const sc of dim.sub_checks) {
      if (!isGap(sc)) continue;
      tasks.push(
        enrichGap(env, scan.url, dim.dimension_name, sc).then((rem) => ({
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
<title>Pharos Audit — ${escapeHtml(scan.url)}</title>
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
    Generated by Pharos. Re-scan anytime at <a href="https://pharos-marketing.pharos-dev.workers.dev/score">pharos-marketing.pharos-dev.workers.dev/score</a>.
    Re-run the full audit at <a href="https://pharos-marketing.pharos-dev.workers.dev/audit">/audit</a>.
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
