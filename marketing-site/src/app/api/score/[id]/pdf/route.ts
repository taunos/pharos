// Slice 2b Phase 1 — GET /api/score/<id>/pdf
//
// Streams the gap-report PDF from R2. Auth: scan-bound token in `?t=`.
// Email is recovered from scanner D1 (rate-limited internal endpoint) and
// used to derive the per-email R2 key sha256(email)[:16].

import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  verifyScanToken,
  hashEmailForLog,
} from "@/lib/score-tokens";
import { getScoreReportPDFKey } from "@/lib/score-pdf-template";
import { parseCapturePipelineMode } from "@/lib/capture-pipeline-mode";
import {
  getEmailForScan,
  getPdfKey,
  getScanState,
} from "@/lib/score-scanner-client";

interface PdfEnv {
  AUDITS: R2Bucket;
  UNSUBSCRIBE_SECRET: string;
  INTERNAL_SCANNER_ADMIN_KEY: string;
  CAPTURE_PIPELINE_MODE?: string;
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const env = getCloudflareContext().env as unknown as PdfEnv;
  const mode = parseCapturePipelineMode(env.CAPTURE_PIPELINE_MODE);
  const { id: scanId } = await context.params;
  const url = new URL(req.url);
  const token = url.searchParams.get("t") ?? "";
  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  const ua = req.headers.get("User-Agent") ?? "unknown";

  // 404 covers all reject conditions to avoid leaking which gate failed.
  const reject = () => new Response("Not found", { status: 404 });

  if (!scanId || !token) return reject();
  if (!env.UNSUBSCRIBE_SECRET || !env.INTERNAL_SCANNER_ADMIN_KEY) return reject();

  const verified = await verifyScanToken(token, env.UNSUBSCRIBE_SECRET);
  if (!verified || verified.scanId !== scanId) return reject();

  // Pre-flight state check — refuse if unsubscribed or deletion-requested.
  const state = await getScanState(env, scanId);
  if (!state.ok) return reject();
  if (state.unsubscribed || state.deletion_requested) return reject();
  if (!state.has_email_captured || !state.pdf_ready) return reject();

  // ── P0-C2 capture cutover (CD5/CD6): pointer-first when the gate is ON.
  // Fail-closed everywhere except a NULL pointer, which is the ONLY sanctioned
  // fallback to the legacy per-email key below. On the pointer path the email
  // is never fetched, so no per-download line is emitted (CD2/CD6).
  if (mode === "on") {
    const keyRes = await getPdfKey(env, scanId);
    if (!keyRes.ok) {
      console.error("[score-pdf] pdf_key_lookup_failed");
      return reject();
    }
    if (keyRes.pdf_r2_key !== null) {
      const key = keyRes.pdf_r2_key;
      if (!key.startsWith(`score-reports/${scanId}/`) || !key.endsWith(".pdf")) {
        console.error("[score-pdf] pdf_pointer_invalid");
        return reject();
      }
      const versioned = await env.AUDITS.get(key);
      if (!versioned) {
        console.error("[score-pdf] pdf_object_missing");
        return reject();
      }
      const filename = `astrant-score-${scanId.slice(0, 8)}.pdf`;
      return new Response(versioned.body, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "private, max-age=300",
        },
      });
    }
  }

  // Read raw email back to derive R2 key. This is the rate-limited internal
  // path; Phase 2 of 2b will refactor it away by persisting email_hash on
  // the row at capture time.
  const emailRes = await getEmailForScan(env, scanId);
  if (!emailRes.ok || !emailRes.email) return reject();
  const email = emailRes.email;

  const r2Key = await getScoreReportPDFKey(scanId, email);
  const obj = await env.AUDITS.get(r2Key);
  if (!obj) return reject();

  // Hashed-email log line for abuse heuristics (no raw PII in tail logs).
  const emailLogHash = await hashEmailForLog(email, env.UNSUBSCRIBE_SECRET);
  console.log(
    `[score-pdf] download scan=${scanId} email_hash=${emailLogHash} ip=${ip} ua=${ua.slice(0, 80)}`
  );

  const filename = `astrant-score-${scanId.slice(0, 8)}.pdf`;
  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
