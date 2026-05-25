// F-Fnd OQ3 path (b): RFC 8058 List-Unsubscribe-Post one-click endpoint.
// Single-step unsubscribe per F-Fnd scope; two-step confirm is a separate retrofit slice.
// Accepts both GET (link-click) and POST (RFC 8058 List-Unsubscribe-Post One-Click).

import { type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { verifyUnsubscribeToken } from '@/lib/email-suppressions';
import type { D1Database } from '@cloudflare/workers-types';

export const dynamic = 'force-dynamic';

interface UnsubEnv {
  CITATION_DB: D1Database;
  EMAIL_UNSUB_SIGNING_KEY: string;
}

async function handle(req: NextRequest): Promise<Response> {
  const env = getCloudflareContext().env as unknown as UnsubEnv;
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) {
    return new Response('Missing token.', { status: 400 });
  }

  const verified = await verifyUnsubscribeToken(env, token);
  if (!verified.valid) {
    return new Response(`Invalid or expired unsubscribe link: ${verified.reason}.`, { status: 400 });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  await env.CITATION_DB.prepare(
    'INSERT OR IGNORE INTO email_suppressions (email_hash, suppressed_at, reason) VALUES (?, ?, ?)'
  ).bind(verified.emailHash, nowSec, 'user-unsubscribe').run();

  if (req.method === 'POST') {
    return new Response(null, { status: 200 });
  }
  return new Response(
    `You've been unsubscribed from Astrant emails. You will no longer receive welcome or account-action emails from this address.`,
    { status: 200, headers: { 'Content-Type': 'text/plain' } }
  );
}

export const GET = handle;
export const POST = handle;
