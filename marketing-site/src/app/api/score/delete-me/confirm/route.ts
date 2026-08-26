// GET/POST /api/score/delete-me/confirm
//
// Two-step, prefetcher-safe deletion (OD#7 / P0-C1):
//   GET  ?t=<token>  -> renders a confirmation page ONLY. No mutation, so an
//                        email prefetcher / link-scanner cannot trigger deletion.
//   POST  (t in form) -> validates the 24h HMAC token again, then per scan:
//                        1. Deletes the per-email gap-report PDF from R2 FIRST
//                           (authoritative — only reported removed once R2
//                           confirms). If R2 fails, the email association is
//                           retained so the same token can retry (no orphaned
//                           PDF behind a cleared, unfindable row).
//                        2. Only AFTER R2 succeeds, clears PII via scanner
//                           /delete-pii (email, unsubscribe_token, user_ip,
//                           email_opted_in_rescan).
// The submitted URL + technical scan results remain for calibration (OD#7); the
// copy does not claim these are fully anonymous (a URL can identify a business).

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyDeletionToken, hashEmailForR2Key, hashEmailForLog } from "@/lib/score-tokens";
import { DELETE_PII_TIMEOUT_MS, deletePiiForScan, getScansByEmail } from "@/lib/score-scanner-client";

interface ConfirmEnv {
  AUDITS: R2Bucket;
  UNSUBSCRIBE_SECRET: string;
  INTERNAL_SCANNER_ADMIN_KEY: string;
}

// P0-C2 capture cutover (CD7): total POST deadline. Checked before each
// iteration AND after each R2 delete before delete-pii; insufficient headroom
// (< one bounded delete-pii + margin) marks the current scan and every
// remaining scan incomplete through the EXISTING partial/retry rendering.
const CONFIRM_ROUTE_BUDGET_MS = 90_000;
const CONFIRM_ITER_MARGIN_MS = 5_000;

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function htmlPage(title: string, bodyInner: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<meta name="referrer" content="no-referrer" />
<title>${title}</title>
<style>
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; line-height: 1.5; max-width: 640px; margin: 48px auto; padding: 24px; }
  h1 { font-size: 22pt; margin: 0 0 16px 0; }
  p { color: #334155; }
  a { color: #0f172a; text-decoration: underline; }
  button { font-size: 15px; font-weight: 600; color: #fff; background: #dc2626; border: 0; border-radius: 6px; padding: 12px 20px; cursor: pointer; margin-top: 8px; }
  .muted { color: #64748b; font-size: 13px; margin-top: 24px; }
</style>
</head>
<body>${bodyInner}</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}

// Renders the confirmation form (used by GET and by the retry link on a partial
// failure). Keeps the token in a POST body so a prefetcher/GET can't mutate.
function confirmForm(token: string, heading: string, intro: string, status = 200): Response {
  return htmlPage(
    "Astrant — confirm deletion",
    `<h1>${heading}</h1>
     <p>${intro}</p>
     <form method="POST" action="/api/score/delete-me/confirm">
       <input type="hidden" name="t" value="${escapeAttr(token)}" />
       <button type="submit">Delete my data</button>
     </form>
     <p class="muted">If you didn't request this, close this page — nothing
     happens until you click the button.</p>`,
    status
  );
}

function invalidPage(): Response {
  return htmlPage(
    "Astrant — link expired",
    `<h1>This deletion-confirm link is invalid or expired.</h1>
     <p>Visit <a href="/score/delete-me">/score/delete-me</a> to request a
     new confirmation link.</p>`
  );
}

function errorPage(): Response {
  return htmlPage(
    "Astrant — error",
    `<h1>We couldn't process your deletion right now.</h1>
     <p>Try again in a minute, or email
     <a href="mailto:contact@astrant.io">contact@astrant.io</a>.</p>`,
    502
  );
}

// GET — confirmation page ONLY. Never mutates (prefetcher / scanner safe).
export async function GET(req: Request) {
  const env = getCloudflareContext().env as unknown as ConfirmEnv;
  const token = new URL(req.url).searchParams.get("t") ?? "";

  if (!token || !env.UNSUBSCRIBE_SECRET || !env.INTERNAL_SCANNER_ADMIN_KEY) {
    return invalidPage();
  }
  const verified = await verifyDeletionToken(token, env.UNSUBSCRIBE_SECRET);
  if (!verified) return invalidPage();

  return confirmForm(
    token,
    "Confirm data deletion",
    `This removes the stored email, IP address, unsubscribe token, opt-in state,
     and personalized report tied to your Astrant scans. The submitted URL and
     technical scan results remain for calibration. This can't be undone.`
  );
}

// POST — performs the deletion. Token comes from the confirmation form.
export async function POST(req: Request) {
  const routeDeadline = Date.now() + CONFIRM_ROUTE_BUDGET_MS;
  const env = getCloudflareContext().env as unknown as ConfirmEnv;

  let token = "";
  try {
    const form = await req.formData();
    token = (form.get("t") as string) ?? "";
  } catch {
    token = new URL(req.url).searchParams.get("t") ?? "";
  }

  if (!token || !env.UNSUBSCRIBE_SECRET || !env.INTERNAL_SCANNER_ADMIN_KEY) {
    return invalidPage();
  }
  const verified = await verifyDeletionToken(token, env.UNSUBSCRIBE_SECRET);
  if (!verified) return invalidPage();
  // F-01: token payload was signed over the normalized email at issuance, so
  // the recovered value is already canonical — no re-normalization needed.
  const email = verified.email;
  const emailLogHash = await hashEmailForLog(email, env.UNSUBSCRIBE_SECRET);

  const scansRes = await getScansByEmail(env, email);
  if (!scansRes.ok) {
    console.error(`[delete-confirm] scans-by-email failed email_hash=${emailLogHash}: ${scansRes.error}`);
    return errorPage();
  }
  const scanIds = scansRes.scan_ids;

  if (scanIds.length === 0) {
    return htmlPage(
      "Astrant — nothing to remove",
      `<h1>No records found for this email.</h1>
       <p>There are no scan records associated with this email — they may have
       already been removed. Nothing further is needed.</p>`
    );
  }

  const emailHashForR2 = await hashEmailForR2Key(email);
  let fullyDone = 0;
  const incomplete: string[] = []; // R2 failed (email retained) OR D1 failed after R2

  // Order matters (OD#7 / Codex): delete the personalized R2 PDF FIRST, then
  // clear D1 PII. If R2 fails we do NOT clear D1 — the email association is
  // retained so the same token can retry and re-find the scan (otherwise the
  // PDF would be orphaned by a cleared, unfindable row). R2 delete is
  // idempotent (no throw on a missing key), so a throw is a genuine failure.
  const deadlineHeadroom = () => routeDeadline - Date.now() >= DELETE_PII_TIMEOUT_MS + CONFIRM_ITER_MARGIN_MS;
  const markRestIncomplete = (fromScanId: string) => {
    for (const rest of scanIds.slice(scanIds.indexOf(fromScanId))) incomplete.push(rest);
    console.log("[delete-confirm] confirm_deadline");
  };
  for (const scanId of scanIds) {
    if (!deadlineHeadroom()) {
      markRestIncomplete(scanId);
      break;
    }
    let r2ok = true;
    try {
      await env.AUDITS.delete(`score-reports/${scanId}/${emailHashForR2}.pdf`);
    } catch (err) {
      r2ok = false;
      console.error(`[delete-confirm] R2 delete failed scan=${scanId} email_hash=${emailLogHash}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!r2ok) {
      incomplete.push(scanId); // retain email — do not clear D1 for this scan
      continue;
    }
    if (!deadlineHeadroom()) {
      markRestIncomplete(scanId); // PDF gone, PII not yet cleared — existing incomplete state
      break;
    }
    const res = await deletePiiForScan(env, scanId);
    if (res.ok) {
      fullyDone++;
    } else {
      console.error(`[delete-confirm] delete-pii failed scan=${scanId} email_hash=${emailLogHash}: ${res.error}`);
      incomplete.push(scanId); // PDF gone, PII not yet cleared
    }
  }

  console.log(`[delete-confirm] processed email_hash=${emailLogHash} scans=${scanIds.length} fully_done=${fullyDone} incomplete=${incomplete.length}`);

  // Partial or total failure: never claim complete removal. Non-2xx + retry.
  if (incomplete.length > 0) {
    return confirmForm(
      token,
      "Deletion not fully complete",
      `We removed your data from ${fullyDone} of ${scanIds.length} record${scanIds.length === 1 ? "" : "s"}.
       ${incomplete.length} couldn't be fully removed just now. Click below to
       retry — your deletion link is still valid. If it keeps failing, email
       <a href="mailto:contact@astrant.io">contact@astrant.io</a> with the
       subject "deletion failed".`,
      500
    );
  }

  return htmlPage(
    "Astrant — data removed",
    `<h1>Your personal data has been removed.</h1>
     <p>Across ${scanIds.length} scan record${scanIds.length === 1 ? "" : "s"}, we removed the
     stored email, IP address, unsubscribe token, opt-in state, and personalized
     report. The submitted URL and technical scan results remain for
     calibration.</p>
     <p class="muted">Astrant — Agent Discoverability for B2B SaaS.</p>`
  );
}
