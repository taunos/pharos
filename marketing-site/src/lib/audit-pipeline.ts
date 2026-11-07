// Audit fulfillment pipeline.
//
// Sequence: scan → attach fixed remediation templates to each gap → render
// HTML → rasterize to PDF via Cloudflare Browser Rendering REST API → store
// PDF + JSON in R2.
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
} from "./audit-types";
import {
  AUDIT_REPORT_COPY,
  buildAuditReportModel,
  type ScoreBand,
} from "./audit-report-model";
import { DIMENSION_WEIGHTS, isGap, orderGaps } from "./audit-gaps";
import { hostOf, originOf } from "./llm-safety";
import { remediationFor } from "./remediation-templates";
import { DEFAULT_SCANNER_URL, scannerFetch } from "./scanner-fetch";

const SCANNER_URL = `${DEFAULT_SCANNER_URL}/api/scan`;

// v4 (2026-11-04): prompt-injection hardening of the model prompt.
// v5 (2026-11-07): Dim 6 remediation became fixed text.
// v6 (2026-11-07): every remediation is a fixed template
// (lib/remediation-templates.ts) chosen by code from the scanner result; no
// model call, no KV cache. Gaps are the checks that did not pass, ordered by
// weighted impact (lib/audit-gaps.ts).
const REMEDIATION_ENGINE_VERSION = "v7";

export type AuditEnv = {
  AI: Ai;
  SESSIONS: KVNamespace;
  AUDITS: R2Bucket;
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
  // Slice 3b — Dim 6 Citation Visibility provider keys. Live ONLY on
  // marketing-site Worker secrets per locked decision 12. Optional in the
  // type so audit-fulfill keeps building when keys aren't set yet (graceful
  // degradation: every cell unmeasurable → na:true, composite renormalizes).
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_AI_API_KEY?: string;
  PERPLEXITY_API_KEY?: string;
  // Service Binding to pharos-scanner (./scanner-fetch); absent → scanner.astrant.io.
  SCANNER_SVC?: Fetcher;
};

export async function runScan(
  url: string,
  internalFulfillKey?: string,
  scannerSvc?: Fetcher
): Promise<ScanResult> {
  // audit-fulfill is a paid-tier scan: full Browser Rendering for Dim 5's
  // js_vs_no_js_render_diff. We send tier="paid" plus the same internal
  // fulfill key so the scanner accepts it; without the key the scanner
  // silently degrades to free-tier (graceful, not an error).
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (internalFulfillKey) {
    headers["x-internal-fulfill-key"] = internalFulfillKey;
  }
  const res = await scannerFetch(scannerSvc, SCANNER_URL, {
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

// Slice 3b: audit-fulfill recomputes the composite after splicing in the real
// Dim 6 audit, with the scanner's weights mirrored locally
// (lib/audit-gaps.ts DIMENSION_WEIGHTS) rather than calling back into the
// scanner — the scanner's free-tier Dim 6 is na:true on the wire already,
// and recomputing locally keeps audit-fulfill self-contained.
function gradeForLocal(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "A-";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

/**
 * Splice a paid Dim 6 result into a scanner ScanResult and recompute the
 * composite. Returns a new ScanResult — does not mutate the input.
 *
 * Behavior:
 *   - Replace the existing Dim 6 entry (free-tier demo, na:true) with the
 *     paid Dim 6 dimension.
 *   - Recompute composite via SPEC_WEIGHTS, dropping any na:true dims.
 *   - Recompute dimensions_applicable from the new dimension list.
 */
export function splicePaidDim6(
  scan: ScanResult,
  paidDim6: import("./audit-types").DimensionResult
): ScanResult {
  const newDims = scan.dimensions.map((d) =>
    d.dimension_id === 6 ? paidDim6 : d
  );
  // If somehow the scanner didn't emit a Dim 6 entry (older version), append.
  if (!newDims.some((d) => d.dimension_id === 6)) {
    newDims.push(paidDim6);
  }
  let weighted = 0;
  let totalWeight = 0;
  for (const d of newDims) {
    if (d.na) continue;
    const w = DIMENSION_WEIGHTS[d.dimension_id] ?? 0;
    weighted += d.score * w;
    totalWeight += w;
  }
  const compositeScore =
    totalWeight === 0 ? 0 : Math.round(weighted / totalWeight);
  return {
    ...scan,
    dimensions: newDims,
    composite: { score: compositeScore, grade: gradeForLocal(compositeScore) },
    dimensions_applicable: newDims.filter((d) => !d.na).length,
  };
}

/**
 * The gap list for the paid Audit: every applicable sub-check that did not
 * pass, with its fixed remediation template, ordered by weighted impact on
 * the composite. Deterministic: no model call.
 */
export function buildRemediationGaps(scan: ScanResult): GapWithRemediation[] {
  const origin = originOf(scan.url) ?? "your site";
  const host = hostOf(scan.url) ?? "your-domain";
  const out: GapWithRemediation[] = [];
  for (const dim of scan.dimensions) {
    // Whole-dimension N/A: its sub-checks are N/A too; skip early.
    if (dim.na) continue;
    for (const sc of dim.sub_checks) {
      if (!isGap(sc)) continue;
      out.push({
        dimension_id: dim.dimension_id,
        dimension_name: dim.dimension_name,
        check_id: sc.id,
        check_name: sc.name,
        weight: sc.weight,
        score: sc.score,
        notes: sc.notes,
        remediation: remediationFor(sc, { origin, host, siblings: dim.sub_checks }),
      });
    }
  }
  return orderGaps(scan, out);
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

function scoreBarColor(band: ScoreBand): string {
  if (band === "high") return "#34d399";
  if (band === "mid") return "#facc15";
  if (band === "low") return "#fb923c";
  return "#f87171";
}

// Content + ordering come from buildAuditReportModel, shared with the
// on-page report (components/AuditReportView.tsx). Only markup lives here.
export function renderAuditHtml(audit: AuditResult, sessionId: string): string {
  const C = AUDIT_REPORT_COPY;
  const m = buildAuditReportModel(audit, sessionId);
  const dimsHtml = m.dimensions
    .map((d) => {
      if (d.kind === "na") {
        return `
      <section class="dim">
        <div class="dim-head">
          <h3>${escapeHtml(d.name)} <span style="font-size:9pt;font-family:ui-monospace,monospace;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">${d.unmeasured ? C.naLabelUnmeasured : C.naLabel}</span></h3>
          <div class="dim-score">
            <span class="dim-grade" style="color:#64748b;font-style:italic;">${d.unmeasured ? C.naGradeUnmeasured : C.naGrade}</span>
          </div>
        </div>
        <p style="font-size:10pt;color:#64748b;margin:6pt 0;">${escapeHtml(d.note)}</p>
      </section>`;
      }
      const subs = d.checks
        .map(
          (s) => `
        <tr>
          <td class="check-name">${escapeHtml(s.name)}</td>
          <td class="check-score">${escapeHtml(s.scoreLabel)}</td>
          <td class="check-weight">${escapeHtml(s.weightLabel)}</td>
          <td class="check-notes">${escapeHtml(s.notes)}</td>
        </tr>`
        )
        .join("");
      return `
      <section class="dim">
        <div class="dim-head">
          <h3>${escapeHtml(d.name)}</h3>
          <div class="dim-score">
            <span class="dim-num">${Number(d.score)}</span>
            <span class="dim-grade" style="color:${gradeColor(d.grade)}">${escapeHtml(d.grade)}</span>
          </div>
        </div>
        <div class="bar"><div class="bar-fill" style="width:${Number(d.barPct)}%;background:${scoreBarColor(d.band)}"></div></div>
        <table class="checks">
          <thead><tr>${C.checkColumns.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
          <tbody>${subs}</tbody>
        </table>
      </section>`;
    })
    .join("");

  const gapsHtml =
    m.gaps.length === 0
      ? `<p class="empty">${C.gapsEmpty}</p>`
      : m.gaps
          .map(
            (g) => `
        <article class="gap">
          <header>
            <h3>${escapeHtml(g.checkName)}</h3>
            <div class="gap-meta">
              <span class="gap-dim">${escapeHtml(g.dimensionName)}</span>
              <span class="gap-score">${escapeHtml(g.metaLabel)}</span>
            </div>
          </header>
          <p class="gap-finding"><strong>${C.findingLabel}</strong> ${escapeHtml(g.finding)}</p>
          <p class="gap-remediation"><strong>${C.remediationLabel}</strong> ${escapeHtml(g.remediation)}</p>
        </article>`
          )
          .join("");

  const [f1, f2] = C.footer;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Astrant Audit — ${escapeHtml(m.url)}</title>
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
  .summary { font-size: 11.5pt; color: #0f172a; margin: 6pt 0; }
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
    <span class="brand">${C.brand}</span>
    <span class="timestamp">${escapeHtml(m.generatedLabel)}</span>
  </div>

  <div class="url-row">${escapeHtml(m.url)}</div>

  <div class="composite">
    <span class="composite-num">${Number(m.composite.score)}</span>
    <span class="composite-grade" style="color:${gradeColor(m.composite.grade)}">${escapeHtml(m.composite.grade)}</span>
  </div>
  <p class="scope">${escapeHtml(m.scopeNote)}</p>

  <h2>${C.summaryHeading}</h2>
  ${m.executiveSummary.map((s) => `<p class="summary">${escapeHtml(s)}</p>`).join("")}

  <h2>${C.dimensionsHeading}</h2>
  ${dimsHtml}

  <h2>${C.gapsHeading}</h2>
  <p>${C.gapsIntro}</p>
  ${gapsHtml}

  <h2>${C.jsonHeading}</h2>
  <p>${C.jsonIntro}${C.jsonIntroPdfOnly}</p>
  <pre class="json">${escapeHtml(m.jsonExport)}</pre>

  <footer>
    ${f1.before}<a href="${f1.href}">${f1.label}</a>.
    ${f2.before}<a href="${f2.href}">${f2.label}</a>.
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
    signal: AbortSignal.timeout(20000),
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
