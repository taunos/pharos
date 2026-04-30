// Slice 2b Phase 1 — GET/POST /api/score/unsubscribe?t=<token>
//
// Two-step pattern (defeats preview-bot CSRF):
//   - GET: render confirmation page with a POST-back form button. Bare GET
//     never unsubscribes. Mail-scanner bots that follow links to scan for
//     malware/phishing only see the confirmation page; they don't click.
//   - POST: actual unsubscribe action. Idempotent.
//
// RFC 8058 native one-click unsubscribe (Gmail/Outlook UI button) goes
// through the POST path via the `List-Unsubscribe-Post: List-Unsubscribe=
// One-Click` header set on the email. Mail clients that honor the header
// POST automatically; the user gets a single-click experience without
// going through our confirmation page.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyScanToken } from "@/lib/score-tokens";
import { unsubscribeScan } from "@/lib/score-scanner-client";

interface UnsubEnv {
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
  .actions { margin-top: 24px; }
  button {
    background: #0f172a; color: white; border: none; padding: 10px 18px;
    font-size: 15px; font-weight: 600; border-radius: 4px; cursor: pointer;
  }
  button:hover { background: #1e293b; }
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
    `<h1>This unsubscribe link is invalid or expired.</h1>
     <p>If you'd like to stop receiving rescan emails, reply to any email
     from us and we'll handle it manually, or visit
     <a href="/score/delete-me">/score/delete-me</a> to delete all your data.</p>`
  );
}

export async function GET(req: Request) {
  const env = getCloudflareContext().env as unknown as UnsubEnv;
  const url = new URL(req.url);
  const token = url.searchParams.get("t") ?? "";

  if (!token || !env.UNSUBSCRIBE_SECRET) return invalidPage();

  const verified = await verifyScanToken(token, env.UNSUBSCRIBE_SECRET);
  if (!verified) return invalidPage();

  // Confirmation page. Single visible button POSTs back to the same URL.
  // Preview bots that GET this page see the confirmation but don't submit.
  const escapedToken = token.replace(/[<>&"']/g, "");
  return htmlPage(
    "Astrant — confirm unsubscribe",
    `<h1>Unsubscribe from Astrant rescan emails?</h1>
     <p>Click the button below to confirm. This will stop monthly auto-rescan
     emails for the scan associated with this link. You'll keep your gap
     report — only the rescan reminders stop.</p>
     <form method="POST" action="/api/score/unsubscribe?t=${escapedToken}">
       <div class="actions">
         <button type="submit">Yes, unsubscribe me</button>
       </div>
     </form>
     <p class="muted">If you didn't expect this email,
     <a href="/score/delete-me">delete all my data</a> instead.</p>`
  );
}

async function performUnsubscribe(req: Request): Promise<Response> {
  const env = getCloudflareContext().env as unknown as UnsubEnv;
  const url = new URL(req.url);
  const token = url.searchParams.get("t") ?? "";

  if (!token || !env.UNSUBSCRIBE_SECRET || !env.INTERNAL_SCANNER_ADMIN_KEY) {
    return invalidPage();
  }
  const verified = await verifyScanToken(token, env.UNSUBSCRIBE_SECRET);
  if (!verified) return invalidPage();

  const res = await unsubscribeScan(env, verified.scanId);
  if (!res.ok) {
    console.error(
      `[unsubscribe] scanner unsub failed scan=${verified.scanId}: ${res.error}`
    );
    return htmlPage(
      "Astrant — error",
      `<h1>We couldn't process your unsubscribe right now.</h1>
       <p>Try again in a minute, or reply to any email from us and we'll
       handle it manually.</p>`
    );
  }

  return htmlPage(
    "Astrant — unsubscribed",
    `<h1>You've been unsubscribed.</h1>
     <p>We won't send you rescan emails for this scan anymore.</p>
     <p>Want to remove all your data? <a href="/score/delete-me">Click here
     to delete your account data</a>.</p>
     <p class="muted">Astrant — Agent Discoverability for B2B SaaS.</p>`
  );
}

export async function POST(req: Request) {
  return performUnsubscribe(req);
}
