// F2 v6.1 D21 — POST /api/f2-checkout-create.
//
// Mirrors `audit-create/route.ts` shape (existing F3.x precedent):
//   1. Validate body-flag gate (codebase_type_confirmed === true; Codex HIGH v3 fold)
//   2. Server-side authoritative D18 Stage 1 ceiling check
//   3. Per-IP rate-limit (LOW-1 fold)
//   4. Call Dodo Create Checkout Session API with 5 custom_fields (V-D Option A)
//   5. Return { checkout_url, session_id } for client-side redirect

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { dodoApiBase } from "@/lib/dodo";
import { CUSTOMER_CATEGORIES } from "@/lib/customer-categories";
import { checkF2CheckoutCreateRateLimit } from "@/lib/rate-limit-kv";
import { isImplementationCheckoutEnabled } from "@/lib/implementation-gate";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface F2CheckoutCreateEnv {
  DODO_API_KEY: string;
  DODO_API_BASE_URL?: string;  // F3.2 binding; optional (helper falls back to live default)
  CITATION_DB: D1Database;
  SESSIONS: KVNamespace;
  F2_CHECKOUT_RATE_LIMIT?: string;  // dev-override only; default 5
  // B1.3 v1.1 — replaces hardcoded CUSTOMER_CEILING=3 (default "30").
  MAX_PROBE_TARGETS?: string;
  // Pre-launch gate — fail-closed; only "true" enables paid Implementation checkout.
  IMPLEMENTATION_CHECKOUT_ENABLED?: string;
}

const IMPLEMENTATION_PRODUCT_ID = "pdt_0NdQE5vccUUgOHMsF6Pzz";
// B1.3 v1.1 — CUSTOMER_CEILING removed; ceiling now reads env.MAX_PROBE_TARGETS at request time.

export async function POST(req: Request) {
  const env = getCloudflareContext().env as unknown as F2CheckoutCreateEnv;

  // 0. Pre-launch gate (server-authoritative). Checked FIRST — before rate
  // limiting, D1, or any Dodo call — so a disabled tier never creates a
  // payment session, regardless of how the request was crafted. Fail-closed.
  if (!isImplementationCheckoutEnabled(env)) {
    return NextResponse.json({ error: "PRELAUNCH_DISABLED" }, { status: 503 });
  }

  if (!env.DODO_API_KEY) {
    return NextResponse.json(
      { error: "SERVER_NOT_CONFIGURED", reason: "DODO_API_KEY missing" },
      { status: 500 },
    );
  }

  // 1. Per-IP rate-limit
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  const rl = await checkF2CheckoutCreateRateLimit(env.SESSIONS, ip, env.F2_CHECKOUT_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMITED", retry_after_sec: rl.retryAfterSec ?? 60 },
      { status: 429 },
    );
  }

  // 2. Body-flag gate (Codex HIGH v3 — prevents direct-POST bypass of /implementation Stage 1 gate)
  let body: { codebase_type_confirmed?: boolean };
  try {
    body = (await req.json()) as { codebase_type_confirmed?: boolean };
  } catch {
    return NextResponse.json({ error: "BAD_REQUEST", reason: "invalid_json" }, { status: 400 });
  }
  if (body?.codebase_type_confirmed !== true) {
    return NextResponse.json(
      { error: "BAD_REQUEST", reason: "codebase_type_not_confirmed" },
      { status: 400 },
    );
  }

  // 3. D18 Stage 1 — server-side authoritative ceiling check
  // B1.3 v1.1 — MAX_PROBE_TARGETS env binding replaces hardcoded CUSTOMER_CEILING=3.
  const maxProbeTargets = parseInt(env.MAX_PROBE_TARGETS ?? "30", 10);
  const ceilingCheck = await env.CITATION_DB.prepare(
    `SELECT COUNT(*) AS count FROM customer_probe_targets WHERE status='active'`,
  ).first<{ count: number }>();
  if ((ceilingCheck?.count ?? 0) >= maxProbeTargets) {
    return NextResponse.json({ error: "AT_CAPACITY" }, { status: 503 });
  }

  // 4. Compose 5 custom_fields per spec v6.1 D17 + V-D empirical schema
  const customFields = [
    {
      key: "site_url",
      field_type: "url",
      label: "Your site URL",
      required: true,
      placeholder: "https://yourcompany.com",
    },
    {
      key: "brand_name",
      field_type: "text",
      label: "Brand name (how agents should cite you)",
      required: true,
      placeholder: "Acme",
    },
    {
      key: "category",
      field_type: "dropdown",
      label: "Category",
      required: true,
      options: [...CUSTOMER_CATEGORIES],
    },
    {
      key: "competitors",
      field_type: "text",
      label: "Top 5 competitors (comma-separated, optional)",
      required: false,
      placeholder: "Acme Rival, Acme Alternative",
    },
    {
      key: "delivery_email",
      field_type: "email",
      label: "Delivery email (if different from payer)",
      required: false,
    },
  ];

  // 5. Call Dodo Create Checkout Session API
  const origin = new URL(req.url).origin;
  const returnUrl = `${origin}/f2-success`;
  const cancelUrl = `${origin}/implementation?canceled=1`;

  try {
    const resp = await fetch(`${dodoApiBase(env)}/checkouts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.DODO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        product_cart: [{ product_id: IMPLEMENTATION_PRODUCT_ID, quantity: 1 }],
        custom_fields: customFields,
        metadata: { tier: "implementation" },  // V-E F2 webhook discriminator
        return_url: returnUrl,
        cancel_url: cancelUrl,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`F2_CHECKOUT_CREATE_FAILED status=${resp.status} body=${text.slice(0, 500)}`);
      return NextResponse.json({ error: "DODO_CHECKOUT_FAILED" }, { status: 502 });
    }

    const data = (await resp.json()) as {
      checkout_url?: string;
      url?: string;
      session_id?: string;
      id?: string;
    };
    const checkout_url = data.checkout_url ?? data.url;
    const session_id = data.session_id ?? data.id;
    if (!checkout_url || !session_id) {
      console.error(`F2_CHECKOUT_RESPONSE_MISSING_FIELDS data=${JSON.stringify(data).slice(0, 500)}`);
      return NextResponse.json({ error: "DODO_CHECKOUT_FAILED" }, { status: 502 });
    }

    return NextResponse.json({ checkout_url, session_id });
  } catch (err) {
    console.error(`F2_CHECKOUT_CREATE_EXCEPTION`, err);
    return NextResponse.json({ error: "DODO_CHECKOUT_FAILED" }, { status: 502 });
  }
}
