import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  createCheckoutSession,
  type DodoEnvBindings,
} from "@/lib/dodo";
import { normalizeEmail } from "@/lib/email-normalize";
import { requestOrigin } from "@/lib/origin";
import type { SessionRecord } from "@/lib/audit-types";
import { AUDIT_PRODUCT_ID, isAuditCheckoutEnabled } from "@/lib/audit-gate";
import { checkAuditCheckoutCreateRateLimit } from "@/lib/rate-limit-kv";
import { createFunnelRecord } from "@/lib/audit-funnel";
import {
  CONSENT_SELLABLE_TEXT_VERSION,
  buildRightsRecord,
  parseConsentSellable,
  writeRightsRecord,
} from "@/lib/dataset-consent";

// AUDIT_PRODUCT_ID lives in @/lib/audit-gate (shared with the webhook).
const SESSION_TTL_SEC = 30 * 24 * 60 * 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Test C-A (A2): server-side field caps + source_scan_id shape.
const MAX_URL_LEN = 2048;
const MAX_EMAIL_LEN = 254;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface AuditCreateEnv extends DodoEnvBindings {
  SESSIONS: KVNamespace;
  // Pre-launch gate — fail-closed; only "true" enables paid Audit checkout.
  AUDIT_CHECKOUT_ENABLED?: string;
  // Per-IP limit per hour (default 5).
  AUDIT_CHECKOUT_RATE_LIMIT?: string;
  // Privacy (OD#7): HMAC secret to pseudonymize IP in rate-limit keys.
  RATE_LIMIT_HASH_SECRET?: string;
}

export async function POST(req: Request) {
  const env = getCloudflareContext().env as unknown as AuditCreateEnv;

  // PRE-LAUNCH MODE — paid checkouts disabled unless AUDIT_CHECKOUT_ENABLED
  // is exactly "true" (lib/audit-gate.ts). Checked FIRST — before any KV or
  // Dodo access — so a hand-crafted client gets a clean 503 with a clear
  // message rather than a real Dodo charge.
  if (!isAuditCheckoutEnabled(env)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Astrant Audit is in pre-launch verification. Paid checkouts open in the next few days. Drop your URL + email at https://astrant.io/audit and we'll email you the moment it goes live.",
      },
      { status: 503 }
    );
  }

  // Per-IP rate limit (same pattern as /api/f2-checkout-create).
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  const rl = await checkAuditCheckoutCreateRateLimit(
    env.SESSIONS,
    ip,
    env.RATE_LIMIT_HASH_SECRET,
    env.AUDIT_CHECKOUT_RATE_LIMIT,
  );
  if (!rl.allowed) {
    if (rl.misconfigured) {
      console.error("RATE_LIMIT_MISCONFIGURED: RATE_LIMIT_HASH_SECRET is not set");
      return NextResponse.json({ ok: false, error: "MISCONFIGURED" }, { status: 503 });
    }
    return NextResponse.json(
      { ok: false, error: "RATE_LIMITED", retry_after_sec: rl.retryAfterSec ?? 3600 },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "Body must be a JSON object." },
      { status: 400 }
    );
  }
  const b = body as Record<string, unknown>;

  if (typeof b.url !== "string" || b.url.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "url is required." },
      { status: 400 }
    );
  }
  let normalizedUrl: string;
  try {
    if (b.url.length > MAX_URL_LEN) throw new Error("too-long");
    const u = new URL(b.url);
    if (u.toString().length > MAX_URL_LEN) throw new Error("too-long");
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error("non-http");
    }
    normalizedUrl = u.toString();
  } catch {
    return NextResponse.json(
      { ok: false, error: "url must be a valid http(s) URL." },
      { status: 400 }
    );
  }

  if (
    typeof b.email !== "string" ||
    b.email.length > MAX_EMAIL_LEN ||
    !EMAIL_RE.test(b.email)
  ) {
    return NextResponse.json(
      { ok: false, error: "email must be a valid email address." },
      { status: 400 }
    );
  }
  // F-01: normalize before sending to Dodo, persisting in SESSIONS, and
  // populating customer_email on the checkout (Dodo will display the
  // lowercased form back to the customer; matches industry norm).
  const email = normalizeEmail(b.email);

  // Optional conversion-arc field: source_scan_id from the prior free Score.
  // Must be a UUID v4; anything else is silently DROPPED (never an error).
  const sourceScanId =
    typeof b.source_scan_id === "string" && UUID_V4_RE.test(b.source_scan_id.trim())
      ? b.source_scan_id.trim()
      : undefined;

  // Dataset P2 opt-in (unticked checkbox). Only literal `true` counts;
  // anything else is 0. Never affects price, validation or flow.
  const consentSellable = parseConsentSellable(b.consent_sellable);

  if (!env.DODO_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "Server not configured: DODO_API_KEY missing." },
      { status: 500 }
    );
  }

  const session_id = crypto.randomUUID();
  const origin = requestOrigin(req);

  let checkout: { checkout_url: string; checkout_session_id: string };
  try {
    const checkoutMetadata: Record<string, string> = {
      url: normalizedUrl,
      email,
      session_id,
      tier: "audit",
    };
    if (sourceScanId) checkoutMetadata.source_scan_id = sourceScanId;
    checkout = await createCheckoutSession(env, {
      product_id: AUDIT_PRODUCT_ID,
      customer_email: email,
      metadata: checkoutMetadata,
      return_url: `${origin}/audit-results/${session_id}`,
      // Keep the conversion arc across a canceled checkout: the form re-reads
      // source_scan_id from the /audit URL on the retry.
      cancel_url: `${origin}/audit?canceled=1${
        sourceScanId ? `&source_scan_id=${encodeURIComponent(sourceScanId)}` : ""
      }`,
    });
  } catch (err) {
    console.error("[audit-create] Dodo checkout failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Could not create checkout session. Try again in a moment.",
      },
      { status: 502 }
    );
  }

  const createdAt = Date.now();
  const record: SessionRecord = {
    session_id,
    url: normalizedUrl,
    email,
    status: "awaiting_payment",
    created_at: createdAt,
    ...(sourceScanId ? { source_scan_id: sourceScanId } : {}),
    consent_sellable: consentSellable,
    consent_text_version: CONSENT_SELLABLE_TEXT_VERSION,
    consent_at: createdAt,
  };
  await env.SESSIONS.put(`audit:${session_id}`, JSON.stringify(record), {
    expirationTtl: SESSION_TTL_SEC,
  });
  // Funnel record — no TTL, no email/URL (best-effort; never blocks checkout).
  await createFunnelRecord(env.SESSIONS, session_id, sourceScanId ?? null);
  // Rights registry — no TTL, no email/URL (best-effort; never blocks checkout).
  await writeRightsRecord(
    env.SESSIONS,
    session_id,
    buildRightsRecord("audit", consentSellable, createdAt),
  );

  return NextResponse.json({
    ok: true,
    session_id,
    checkout_url: checkout.checkout_url,
  });
}
