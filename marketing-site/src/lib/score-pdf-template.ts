// Slice 2b Phase 1 — Score gap-report PDF template + generator.
//
// Mirrors the audit-pipeline.ts pattern (Browser Rendering REST `/pdf`
// endpoint → ArrayBuffer → R2 upload). Differences from the $79 Audit:
//   - Free-tier scope (5 of 6 dimensions live, with disclosure footer).
//   - Per-email PDF — R2 key is `score-reports/<scan_id>/<sha256(email)[:16]>.pdf`
//     (per locked decision 8) so Bob re-capturing on Alice's forwarded link
//     gets his own watermarked PDF without overwriting Alice's.
//   - Predicted-lift annotations are TEMPLATED (no LLM) — Phase 1 ships
//     conservative low/medium/high buckets only. Future iterations can
//     elevate to LLM-narrated lift, but only with the full TP-7 ladder.
//   - Footer carries BOTH `engine v<scoring_version>` (from scan record)
//     AND `pdf template v<PDF_TEMPLATE_VERSION>` (this module's constant).
//   - TF-10 watermark with capturing email on every page.

import type { ScanResult, SubCheck } from "./audit-types";
import { hashEmailForR2Key } from "./score-tokens";

export const PDF_TEMPLATE_VERSION = "1.0.0";

// Reuses the existing AUDITS R2 bucket (named `pharos-audits`), under the
// `score-reports/` prefix to keep Score artifacts visually separate from
// audit-fulfill artifacts under `audits/`.

export type ScorePdfEnv = {
  AUDITS: R2Bucket;
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
};

// ─── Lift bucketing — templated, no LLM ──────────────────────────────────
//
// Per Slice 2b locked decision 2: Phase 1 ships templated buckets only.
// Any future LLM-narrated lift requires the full TP-7 trust ladder.

export type LiftBucket = "low" | "medium" | "high";

export function liftBucket(subCheckScore: number): LiftBucket {
  if (subCheckScore < 50) return "high";
  if (subCheckScore < 80) return "medium";
  return "low";
}

function liftLabel(bucket: LiftBucket): string {
  switch (bucket) {
    case "high":
      return "High lift";
    case "medium":
      return "Medium lift";
    case "low":
      return "Low lift";
  }
}

function liftColor(bucket: LiftBucket): string {
  switch (bucket) {
    case "high":
      return "#dc2626";
    case "medium":
      return "#d97706";
    case "low":
      return "#65a30d";
  }
}

// ─── HTML helpers ────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function gradeColor(grade: string): string {
  if (grade.startsWith("A")) return "#059669";
  if (grade.startsWith("B")) return "#65a30d";
  if (grade === "C") return "#d97706";
  if (grade === "D") return "#ea580c";
  return "#dc2626";
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace(/\..+$/, " UTC");
}

function renderSubCheck(sub: SubCheck): string {
  const bucket = liftBucket(sub.score);
  const naLabel = sub.na ? " · N/A" : "";
  return `
    <tr>
      <td class="check-name">${escapeHtml(sub.name)}${naLabel}</td>
      <td class="check-score">${sub.na ? "—" : `${sub.score}/100`}</td>
      <td class="check-weight">${sub.weight}%</td>
      <td class="check-lift" style="color:${liftColor(bucket)}">${sub.na ? "—" : liftLabel(bucket)}</td>
      <td class="check-notes">${escapeHtml(sub.notes)}</td>
    </tr>`;
}

// ─── HTML template ───────────────────────────────────────────────────────

export interface RenderInput {
  scan: ScanResult;
  email: string;
  scoringVersion: string;
}

export function renderScoreReportHTML(input: RenderInput): string {
  const { scan, email, scoringVersion } = input;
  const sessionShort = scan.id.slice(0, 8);

  const dimsHtml = scan.dimensions
    .map((d) => {
      // Slice 3a: whole-dimension N/A renders as a single explanatory paragraph
      // rather than a sub-check table — every sub-check is N/A so the table
      // would be a wall of em-dashes.
      if (d.na) {
        const naNote = d.sub_checks[0]?.notes ?? "Dimension did not apply to this site; dropped from composite.";
        return `
      <section class="dim">
        <div class="dim-head">
          <h3>${escapeHtml(d.dimension_name)} <span style="font-size:9pt;font-family:ui-monospace,monospace;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">N/A</span></h3>
          <div class="dim-score">
            <span class="dim-grade" style="color:#64748b;font-style:italic;">not applicable</span>
          </div>
        </div>
        <p style="font-size:10pt;color:#64748b;margin:6pt 0;">${escapeHtml(naNote)}</p>
      </section>`;
      }
      const subs = d.sub_checks.map(renderSubCheck).join("");
      return `
      <section class="dim">
        <div class="dim-head">
          <h3>${escapeHtml(d.dimension_name)}</h3>
          <div class="dim-score">
            <span class="dim-num">${d.score}</span>
            <span class="dim-grade" style="color:${gradeColor(d.grade)}">${escapeHtml(d.grade)}</span>
          </div>
        </div>
        <table class="checks">
          <thead>
            <tr>
              <th>Check</th>
              <th>Score</th>
              <th>Weight</th>
              <th>Lift</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>${subs}</tbody>
        </table>
      </section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Astrant Score gap report — ${escapeHtml(scan.url)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; line-height: 1.5; font-size: 11pt; position: relative; }

  h1, h2, h3 { line-height: 1.25; margin: 0; }
  h1 { font-size: 26pt; font-weight: 700; letter-spacing: -0.02em; }
  h2 { font-size: 16pt; font-weight: 700; margin-top: 22pt; padding-top: 10pt; border-top: 1px solid #e2e8f0; }
  h3 { font-size: 13pt; font-weight: 600; }
  p { margin: 8pt 0; }

  .header { display: flex; align-items: baseline; justify-content: space-between; gap: 24pt; padding-bottom: 12pt; border-bottom: 2px solid #0f172a; }
  .brand { font-size: 14pt; font-weight: 700; letter-spacing: 0.04em; }
  .timestamp { font-size: 9pt; color: #64748b; font-family: ui-monospace, "SF Mono", monospace; }

  .url-row { margin-top: 16pt; font-family: ui-monospace, "SF Mono", monospace; font-size: 11pt; color: #334155; word-break: break-all; }

  .composite { display: flex; align-items: baseline; gap: 16pt; margin-top: 12pt; }
  .composite-num { font-size: 56pt; font-weight: 700; letter-spacing: -0.03em; line-height: 1; }
  .composite-grade { font-size: 28pt; font-weight: 600; font-family: ui-monospace, "SF Mono", monospace; }

  .scope { margin-top: 8pt; font-size: 10pt; color: #64748b; font-style: italic; }

  .dim { margin-top: 14pt; page-break-inside: avoid; }
  .dim-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12pt; }
  .dim-score { display: flex; align-items: baseline; gap: 8pt; }
  .dim-num { font-size: 18pt; font-weight: 700; }
  .dim-grade { font-size: 12pt; font-weight: 600; font-family: ui-monospace, "SF Mono", monospace; }

  table.checks { width: 100%; border-collapse: collapse; margin-top: 8pt; font-size: 9pt; }
  table.checks th { text-align: left; font-weight: 600; color: #475569; border-bottom: 1px solid #e2e8f0; padding: 4pt 4pt; }
  table.checks td { padding: 4pt 4pt; vertical-align: top; border-bottom: 1px solid #f1f5f9; }
  td.check-name { font-weight: 500; width: 24%; }
  td.check-score, td.check-weight { font-family: ui-monospace, "SF Mono", monospace; color: #475569; width: 8%; white-space: nowrap; }
  td.check-lift { font-weight: 600; width: 10%; white-space: nowrap; }
  td.check-notes { color: #475569; width: 50%; }

  .lift-disclosure { margin-top: 14pt; padding: 8pt 10pt; font-size: 9pt; font-style: italic; color: #475569; background: #f8fafc; border-left: 3pt solid #cbd5e1; border-radius: 2pt; }

  .upsell { margin-top: 18pt; padding: 12pt; border: 1px solid #cbd5e1; border-radius: 4pt; background: #f8fafc; }
  .upsell h3 { font-size: 12pt; }
  .upsell ul { padding-left: 16pt; font-size: 10pt; color: #334155; }

  footer { margin-top: 24pt; padding-top: 10pt; border-top: 1px solid #e2e8f0; font-size: 8.5pt; color: #64748b; line-height: 1.45; }
  footer .field { font-family: ui-monospace, "SF Mono", monospace; }

  /* TF-10 watermark — diagonal repeat across each page. */
  .watermark {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    pointer-events: none;
    z-index: 100;
    overflow: hidden;
    opacity: 0.06;
  }
  .watermark .row {
    display: block;
    transform: rotate(-30deg);
    transform-origin: 0 0;
    white-space: nowrap;
    font-family: ui-monospace, "SF Mono", monospace;
    font-size: 14pt;
    letter-spacing: 0.05em;
    color: #0f172a;
    padding: 28pt 0;
  }
</style>
</head>
<body>
  <!-- TF-10 watermark: capturing email, repeated across the page in low opacity. -->
  <div class="watermark" aria-hidden="true">
    ${Array.from({ length: 18 }, () => `<span class="row">${escapeHtml(email)} &nbsp; · &nbsp; ${escapeHtml(email)} &nbsp; · &nbsp; ${escapeHtml(email)} &nbsp; · &nbsp; ${escapeHtml(email)}</span>`).join("\n")}
  </div>

  <div class="header">
    <span class="brand">ASTRANT · Score gap report</span>
    <span class="timestamp">Generated ${formatTimestamp(scan.created_at)} · scan ${escapeHtml(sessionShort)}</span>
  </div>

  <div class="url-row">${escapeHtml(scan.url)}</div>

  <div class="composite">
    <span class="composite-num">${scan.composite.score}</span>
    <span class="composite-grade" style="color:${gradeColor(scan.composite.grade)}">${escapeHtml(scan.composite.grade)}</span>
  </div>
  <p class="scope">Scored on ${scan.dimensions_applicable ?? scan.dimensions_scored} of ${scan.dimensions_total} dimensions applicable to this site. Dim 6 (Citation Visibility) ships in an upcoming release — re-running this scan later will pick it up automatically.${(scan.dimensions_applicable ?? scan.dimensions_scored) < scan.dimensions_scored ? " Some dimensions did not apply to your site (e.g. no API surface for the OpenAPI dimension) and were dropped from the composite." : ""}</p>

  <h2>Dimension breakdown</h2>
  ${dimsHtml}

  <p class="lift-disclosure">
    Lift estimates are conservative ranges based on score gaps, not guaranteed outcomes. We refine these against observed conversion data — see methodology when published.
  </p>

  <div class="upsell">
    <h3>Want deeper remediation guidance per gap?</h3>
    <ul>
      <li><strong>$79 Audit</strong> — DIY-ready remediation written specifically for your site, plus a JSON export. Same dimensions, full evidence and per-gap path.</li>
      <li><strong>$1,299 Implementation</strong> — Astrant builds the AEO stack for you. Patch file, MCP server deployed, baseline monitoring, &lt;24h delivery.</li>
      <li><strong>$4,999+ Custom</strong> — Bespoke scoping for complex APIs, multi-region content, custom MCP tools.</li>
    </ul>
    <p style="margin: 8pt 0 0 0; font-size: 10pt;">Compare tiers at <a href="https://astrant.io/" style="color: #0f172a;">astrant.io</a>. (Paid checkouts are in pre-launch verification — drop your email on each page to be notified when they open.)</p>
  </div>

  <footer>
    <div class="field">Scan ID: ${escapeHtml(scan.id)}</div>
    <div class="field">Engine: v${escapeHtml(scoringVersion)}</div>
    <div class="field">PDF Template: v${escapeHtml(PDF_TEMPLATE_VERSION)}</div>
    <div class="field">Generated: ${new Date(scan.created_at).toISOString()}</div>
    <div class="field">Reproducible at https://astrant.io/score/${escapeHtml(scan.id)}</div>
    <div style="margin-top: 8pt;">Generated by Astrant for the email shown in the watermark above. PDF watermarking is an anti-abuse measure documented in our <a href="https://astrant.io/privacy" style="color: #0f172a;">Privacy Policy</a>.</div>
  </footer>
</body>
</html>`;
}

// ─── PDF generation + R2 upload ──────────────────────────────────────────

export class BrowserRenderingCapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserRenderingCapError";
  }
}

export async function generateScoreReportPDF(
  env: ScorePdfEnv,
  scan: ScanResult,
  email: string,
  scoringVersion: string
): Promise<{ r2_key: string; pdf_size_bytes: number }> {
  const html = renderScoreReportHTML({ scan, email, scoringVersion });
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

  if (res.status === 429) {
    // BR daily soft-cap or per-account rate limit. Surface as a typed error
    // so capture-email can flip pdf_deferred_until_tomorrow without aborting.
    const body = await res.text();
    throw new BrowserRenderingCapError(
      `Browser Rendering daily cap reached (HTTP 429): ${body.slice(0, 300)}`
    );
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Browser Rendering PDF failed: ${res.status} ${body.slice(0, 500)}`
    );
  }

  const pdf = await res.arrayBuffer();
  const emailHash = await hashEmailForR2Key(email);
  const r2_key = `score-reports/${scan.id}/${emailHash}.pdf`;
  await env.AUDITS.put(r2_key, pdf, {
    httpMetadata: { contentType: "application/pdf" },
  });
  return { r2_key, pdf_size_bytes: pdf.byteLength };
}

export async function getScoreReportPDFKey(
  scanId: string,
  email: string
): Promise<string> {
  const emailHash = await hashEmailForR2Key(email);
  return `score-reports/${scanId}/${emailHash}.pdf`;
}
