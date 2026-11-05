// F-Fnd OQ3 path (b): RFC 8058 List-Unsubscribe-Post one-click endpoint.
//
// E9 (code-quality audit 2026-11-05): two-step, same pattern as
// /api/score/unsubscribe (defeats mail link scanners / preview bots):
//   - GET: verify the token and render a confirmation page whose button
//     POSTs back to the same URL. A bare GET never unsubscribes.
//   - POST: the actual unsubscribe. Idempotent (INSERT OR IGNORE). Mail
//     clients honoring `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
//     POST here directly, so one-click unsubscribe still works.

import { type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { verifyUnsubscribeToken } from '@/lib/email-suppressions';
import type { D1Database } from '@cloudflare/workers-types';

export const dynamic = 'force-dynamic';

interface UnsubEnv {
  CITATION_DB: D1Database;
  EMAIL_UNSUB_SIGNING_KEY: string;
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
</style>
</head>
<body>${bodyInner}</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

type Verified = { ok: true; token: string; emailHash: string } | { ok: false; response: Response };

async function verify(req: NextRequest, env: UnsubEnv): Promise<Verified> {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) {
    return { ok: false, response: new Response('Missing token.', { status: 400 }) };
  }
  const verified = await verifyUnsubscribeToken(env, token);
  if (!verified.valid) {
    return {
      ok: false,
      response: new Response(`Invalid or expired unsubscribe link: ${verified.reason}.`, { status: 400 }),
    };
  }
  return { ok: true, token, emailHash: verified.emailHash };
}

export async function GET(req: NextRequest): Promise<Response> {
  const env = getCloudflareContext().env as unknown as UnsubEnv;
  const v = await verify(req, env);
  if (!v.ok) return v.response;
  // Confirmation only — no write. encodeURIComponent output carries no HTML
  // metacharacters, so it is safe inside the attribute.
  const action = `/api/email/unsubscribe?token=${encodeURIComponent(v.token)}`;
  return htmlPage(
    'Astrant — confirm unsubscribe',
    `<h1>Unsubscribe from Astrant emails?</h1>
     <p>Click the button below to confirm. You will no longer receive welcome or account-action emails from this address.</p>
     <form method="POST" action="${action}">
       <div class="actions">
         <button type="submit">Yes, unsubscribe me</button>
       </div>
     </form>`
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const env = getCloudflareContext().env as unknown as UnsubEnv;
  const v = await verify(req, env);
  if (!v.ok) return v.response;

  const nowSec = Math.floor(Date.now() / 1000);
  await env.CITATION_DB.prepare(
    'INSERT OR IGNORE INTO email_suppressions (email_hash, suppressed_at, reason) VALUES (?, ?, ?)'
  ).bind(v.emailHash, nowSec, 'user-unsubscribe').run();

  return htmlPage(
    'Astrant — unsubscribed',
    `<h1>You've been unsubscribed.</h1>
     <p>You will no longer receive welcome or account-action emails from this address.</p>`
  );
}
