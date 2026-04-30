import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  createCheckoutSession,
  type DodoEnvBindings,
} from "@/lib/dodo";
import { normalizeEmail } from "@/lib/email-normalize";
import type { SessionRecord } from "@/lib/audit-types";

const AUDIT_PRODUCT_ID = "pdt_0NdQDsS4Shhe1BrDzQDaa";
const SESSION_TTL_SEC = 30 * 24 * 60 * 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AuditCreateEnv extends DodoEnvBindings {
  SESSIONS: KVNamespace;
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
  // PRE-LAUNCH MODE — paid checkouts disabled. The /audit form has been
  // swapped to a waitlist (posts to /api/waitlist instead). This endpoint
  // is kept reachable so any hand-crafted client gets a clean 503 with a
  // clear message rather than a real Dodo charge. To re-enable, set
  // PRELAUNCH_PAID_CHECKOUTS_DISABLED to false (or delete the guard).
  const PRELAUNCH_PAID_CHECKOUTS_DISABLED = true;
  if (PRELAUNCH_PAID_CHECKOUTS_DISABLED) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Astrant Audit is in pre-launch verification. Paid checkouts open in the next few days. Drop your URL + email at https://astrant.io/audit and we'll email you the moment it goes live.",
      },
      { status: 503 }
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
    const u = new URL(b.url);
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

  if (typeof b.email !== "string" || !EMAIL_RE.test(b.email)) {
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
  // Accepts any non-empty string; the corpus FK enforces validity at write time.
  const sourceScanId =
    typeof b.source_scan_id === "string" && b.source_scan_id.trim().length > 0
      ? b.source_scan_id.trim()
      : undefined;

  const env = getCloudflareContext().env as unknown as AuditCreateEnv;
  if (!env.DODO_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "Server not configured: DODO_API_KEY missing." },
      { status: 500 }
    );
  }

  const session_id = crypto.randomUUID();
  const origin = originFromRequest(req);

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
      cancel_url: `${origin}/audit?canceled=1`,
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

  const record: SessionRecord = {
    session_id,
    url: normalizedUrl,
    email,
    status: "awaiting_payment",
    created_at: Date.now(),
    ...(sourceScanId ? { source_scan_id: sourceScanId } : {}),
  };
  await env.SESSIONS.put(`audit:${session_id}`, JSON.stringify(record), {
    expirationTtl: SESSION_TTL_SEC,
  });

  return NextResponse.json({
    ok: true,
    session_id,
    checkout_url: checkout.checkout_url,
  });
}
