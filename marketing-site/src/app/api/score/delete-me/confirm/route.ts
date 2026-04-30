// Slice 2b Phase 1 — GET /api/score/delete-me/confirm?t=<token>
//
// Validates the deletion-confirm token (24h HMAC) and purges every scan
// record matching the email:
//   1. Look up scan_ids by email (scanner internal endpoint).
//   2. For each scan: clear PII via scanner internal /delete-pii.
//   3. Best-effort R2 purge of the per-email PDF for each scan_id.
// Phase 2 of 2b may add an async sweep cron for R2 if the inline iteration
// becomes a bottleneck (currently fine for low volume).

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyDeletionToken, hashEmailForR2Key, hashEmailForLog } from "@/lib/score-tokens";
import {
  deletePiiForScan,
  getScansByEmail,
} from "@/lib/score-scanner-client";

interface ConfirmEnv {
  AUDITS: R2Bucket;
  UNSUBSCRIBE_SECRET: string;
  INTERNAL_SCANNER_ADMIN_KEY: string;
}

function htmlPage(title: string, bodyInner: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${title}</title>
<style>
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; line-height: 1.5; max-width: 640px; margin: 48px auto; padding: 24px; }
  h1 { font-size: 22pt; margin: 0 0 16px 0; }
  p { color: #334155; }
  a { color: #0f172a; text-decoration: underline; }
  .muted { color: #64748b; font-size: 13px; margin-top: 24px; }
</style>
</head>
<body>${bodyInner}</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function invalidPage(): Response {
  return htmlPage(
    "Astrant — link expired",
    `<h1>This deletion-confirm link is invalid or expired.</h1>
     <p>Visit <a href="/score/delete-me">/score/delete-me</a> to request a
     new confirmation link.</p>`
  );
}

export async function GET(req: Request) {
  const env = getCloudflareContext().env as unknown as ConfirmEnv;
  const url = new URL(req.url);
  const token = url.searchParams.get("t") ?? "";

  if (!token || !env.UNSUBSCRIBE_SECRET || !env.INTERNAL_SCANNER_ADMIN_KEY) {
    return invalidPage();
  }
  const verified = await verifyDeletionToken(token, env.UNSUBSCRIBE_SECRET);
  if (!verified) return invalidPage();
  // F-01: token's HMAC payload was signed over the normalized email at
  // issuance (see issueDeletionToken). The recovered value here is therefore
  // already canonical — no re-normalization needed before by-email lookup.
  const email = verified.email;

  const emailLogHash = await hashEmailForLog(email, env.UNSUBSCRIBE_SECRET);

  // 1. Look up scan_ids by email.
  const scansRes = await getScansByEmail(env, email);
  if (!scansRes.ok) {
    console.error(
      `[delete-confirm] scans-by-email failed email_hash=${emailLogHash}: ${scansRes.error}`
    );
    return htmlPage(
      "Astrant — error",
      `<h1>We couldn't process your deletion right now.</h1>
       <p>Try again in a minute, or email
       <a href="mailto:hello@astrant.io">hello@astrant.io</a>.</p>`
    );
  }
  const scanIds = scansRes.scan_ids;

  // 2. Clear PII on each scan + best-effort R2 purge.
  const emailHashForR2 = await hashEmailForR2Key(email);
  const failures: string[] = [];
  for (const scanId of scanIds) {
    const res = await deletePiiForScan(env, scanId);
    if (!res.ok) {
      console.error(
        `[delete-confirm] delete-pii failed scan=${scanId} email_hash=${emailLogHash}: ${res.error}`
      );
      failures.push(scanId);
    }
    // R2 deletion is best-effort. Don't block on errors.
    try {
      await env.AUDITS.delete(`score-reports/${scanId}/${emailHashForR2}.pdf`);
    } catch (err) {
      console.error(
        `[delete-confirm] R2 delete failed scan=${scanId} email_hash=${emailLogHash}: ${err instanceof Error ? err.message : String(err)}`
      );
      // best-effort; do not block
    }
  }

  console.log(
    `[delete-confirm] processed email_hash=${emailLogHash} scans=${scanIds.length} failures=${failures.length}`
  );

  if (failures.length > 0 && failures.length === scanIds.length) {
    // All failed — surface error.
    return htmlPage(
      "Astrant — error",
      `<h1>We couldn't process your deletion right now.</h1>
       <p>Try again in a minute, or email
       <a href="mailto:hello@astrant.io">hello@astrant.io</a> with the
       subject "deletion failed" so we can purge manually.</p>`
    );
  }

  return htmlPage(
    "Astrant — data deleted",
    `<h1>All data for this email has been deleted.</h1>
     <p>${scanIds.length} scan record${scanIds.length === 1 ? "" : "s"} purged.
     PII fields cleared, captured email removed, gap-report PDF deleted from
     storage. Anonymous scan records (with PII removed) may be retained for
     aggregate metrics; no identifying information remains.</p>
     ${
       failures.length > 0
         ? `<p class="muted">Note: ${failures.length} scan record(s) couldn't
            be cleared on the first pass. We've logged this and will purge
            manually within 24 hours.</p>`
         : ""
     }
     <p class="muted">Astrant — Agent Discoverability for B2B SaaS.</p>`
  );
}
