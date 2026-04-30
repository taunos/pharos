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
import {
  getEmailForScan,
  getScanState,
} from "@/lib/score-scanner-client";

interface PdfEnv {
  AUDITS: R2Bucket;
  UNSUBSCRIBE_SECRET: string;
  INTERNAL_SCANNER_ADMIN_KEY: string;
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const env = getCloudflareContext().env as unknown as PdfEnv;
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
