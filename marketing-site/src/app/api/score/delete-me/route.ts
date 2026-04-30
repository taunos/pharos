// Slice 2b Phase 1 — POST /api/score/delete-me
//
// Initiates a deletion-confirm flow: rate-limited per IP + per target email
// (KV-backed eventual-consistent counters); generates a 24h-valid HMAC token
// over (email, expiry, secret); sends the token via Resend to the target
// email. The actual deletion happens at /api/score/delete-me/confirm.

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  issueDeletionToken,
  DELETION_TOKEN_TTL_SECONDS,
  hashEmailForLog,
} from "@/lib/score-tokens";
import { normalizeEmail } from "@/lib/email-normalize";
import { sendDeletionConfirmEmail } from "@/lib/score-email";
import { checkDeleteMeRateLimit } from "@/lib/rate-limit-kv";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface DeleteMeEnv {
  TRIAGE_CACHE: KVNamespace;
  RESEND_API_KEY: string;
  UNSUBSCRIBE_SECRET: string;
}

function originFromRequest(req: Request): string {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost ?? req.headers.get("host");
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (host && host.includes("localhost") ? "http" : "https");
  if (host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}

export async function POST(req: Request) {
  const env = getCloudflareContext().env as unknown as DeleteMeEnv;
  const origin = originFromRequest(req);
  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { success: false, error: "Body must be a JSON object." },
      { status: 400 }
    );
  }
  const b = body as Record<string, unknown>;

  // Honeypot — same byte-indistinguishable success pattern as capture-email.
  if (typeof b.referral_code === "string" && b.referral_code.trim().length > 0) {
    return NextResponse.json({ success: true });
  }

  if (typeof b.email !== "string" || !EMAIL_RE.test(b.email.trim())) {
    return NextResponse.json(
      { success: false, error: "email must be a valid email address." },
      { status: 400 }
    );
  }
  // F-01: normalize at entry so the deletion-confirm token's HMAC payload,
  // log hash, and rate-limit key all use the canonical form.
  const email = normalizeEmail(b.email);

  if (!env.UNSUBSCRIBE_SECRET || !env.RESEND_API_KEY) {
    console.error("[delete-me] missing env: UNSUBSCRIBE_SECRET or RESEND_API_KEY");
    return NextResponse.json(
      { success: false, error: "Server not configured." },
      { status: 500 }
    );
  }

  const emailLogHash = await hashEmailForLog(email, env.UNSUBSCRIBE_SECRET);

  // Rate limit. 1/hr per email, 3/day per email, 3/hr per IP, 10/day per IP.
  const rl = await checkDeleteMeRateLimit(env.TRIAGE_CACHE, ip, emailLogHash);
  if (!rl.allowed) {
    const retry = rl.retryAfterSec ?? 3600;
    return NextResponse.json(
      {
        success: false,
        error:
          "We've already sent a confirmation link recently. Check your spam folder, or wait and try again.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(retry) },
      }
    );
  }

  const token = await issueDeletionToken(
    email,
    DELETION_TOKEN_TTL_SECONDS,
    env.UNSUBSCRIBE_SECRET
  );

  const sendRes = await sendDeletionConfirmEmail(env, {
    toEmail: email,
    deletionToken: token,
    origin,
  });
  if (!sendRes.ok) {
    console.error(
      `[delete-me] resend failed email_hash=${emailLogHash} ip=${ip}: ${sendRes.error}`
    );
    // Still return success to the user — explicit signal-leak prevention.
    // We don't want an attacker scanning emails to learn which addresses
    // are valid Resend recipients. Worst case: legitimate user doesn't get
    // the email, retries within rate limit, eventually hits a working send
    // or contacts support manually.
  }

  console.log(
    `[delete-me] confirmation requested email_hash=${emailLogHash} ip=${ip}`
  );

  return NextResponse.json({ success: true });
}
