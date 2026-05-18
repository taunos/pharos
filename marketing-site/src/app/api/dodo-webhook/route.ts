import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyWebhook, type DodoEnvBindings } from "@/lib/dodo";
import { requestOrigin } from "@/lib/origin";
import type { SessionRecord } from "@/lib/audit-types";
import { sendOperatorAlert } from "@/lib/operator-alerts";

interface WebhookEnv extends DodoEnvBindings {
  SESSIONS: KVNamespace;
  INTERNAL_FULFILL_KEY: string;
  // F3 additions:
  CITATION_DB: D1Database;
  ONBOARDING_TOKEN_SECRET: string;
  RESEND_API_KEY: string;
  // F3.2 addition (sibling-cascade per WelcomeEmailEnv extension):
  ACCOUNT_LINK_SECRET: string;
  // F2 v6.1 addition (operator-alerts):
  OPERATOR_ALERT_EMAIL: string;
}

const F2_IMPLEMENTATION_PRODUCT_ID = "pdt_0NdQE5vccUUgOHMsF6Pzz";

const WEBHOOK_DEDUPE_TTL = 7 * 24 * 60 * 60;

type DodoWebhookPayload = {
  type?: string;
  // F2 v6.1: Standard Webhooks envelope timestamp (ISO 8601); used as payment_succeeded_at source.
  timestamp?: string;
  data?: {
    metadata?: Record<string, string>;
    payload_type?: string;
    // F3 additions per V3.A — Dodo's actual subscription webhook payload shape.
    // V3.A ambiguity (customer.email vs flat email, ISO vs UNIX dates) resolves
    // at first live webhook fire; the `??` chains + toUnixSeconds() handle it.
    subscription_id?: string | null;
    id?: string;
    customer_id?: string;
    customer?: {
      id?: string;
      customer_id?: string;  // F2 v6.1: V-E confirms Dodo nests customer_id under customer object
      email?: string;
    };
    email?: string;
    product_id?: string;
    items?: Array<{ product_id?: string }>;
    status?: string;
    next_billing_date?: number | string;
    created_at?: number | string;
    // Forward-compat optionals (if Dodo ever adds these named fields):
    current_period_start?: number;
    current_period_end?: number;
    // F2 v6.1 (V-E payload paths confirmed empirically 2026-05-17):
    payment_id?: string;                                              // F2 one-shot identifier
    product_cart?: Array<{ product_id?: string; quantity?: number }>;  // Newer Dodo shape (replaces items[])
    custom_field_responses?: Array<{ key: string; value: string }> | null;  // F2 5 fields per D17; null per V-E sample
  };
};

// File-scope helper: Dodo date fields may be ISO 8601 strings OR UNIX timestamps
// (ms or seconds). Normalize to seconds. Returns undefined for unparseable input
// so the `??` chain at call sites falls through to a sensible default.
function toUnixSeconds(v: unknown): number | undefined {
  if (typeof v === "number") return v > 1e12 ? Math.floor(v / 1000) : v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
  }
  return undefined;
}

export async function POST(req: Request) {
  const env = getCloudflareContext().env as unknown as WebhookEnv;

  // Read raw body for signature verification (must be byte-exact, not parsed).
  const rawBody = await req.text();

  // Reject obviously-malformed requests with 401 before touching server config.
  // (Spec verification expects 401 on missing webhook headers.)
  const hasHeaders =
    req.headers.get("webhook-id") &&
    req.headers.get("webhook-timestamp") &&
    req.headers.get("webhook-signature");
  if (!hasHeaders) {
    return NextResponse.json(
      { ok: false, reason: "missing webhook headers" },
      { status: 401 }
    );
  }

  if (!env.DODO_WEBHOOK_SECRET) {
    return NextResponse.json(
      { ok: false, reason: "server not configured: DODO_WEBHOOK_SECRET missing" },
      { status: 500 }
    );
  }

  const verified = await verifyWebhook(env, req, rawBody);
  if (!verified.valid) {
    return NextResponse.json(
      { ok: false, reason: verified.reason },
      { status: 401 }
    );
  }

  const webhookId = req.headers.get("webhook-id") ?? "unknown";

  // Idempotency.
  const dedupeKey = `webhook:${webhookId}`;
  const seen = await env.SESSIONS.get(dedupeKey);
  if (seen !== null) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  let parsed: DodoWebhookPayload;
  try {
    parsed = JSON.parse(rawBody) as DodoWebhookPayload;
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid JSON body" },
      { status: 400 }
    );
  }

  const eventType = parsed.type ?? "unknown";
  const metadata = parsed.data?.metadata ?? {};

  // Dispatch.
  if (eventType === "payment.succeeded") {
    const tier = metadata.tier;
    const sessionId = metadata.session_id;

    if (tier === "audit") {
      if (!sessionId) {
        console.error(
          `[dodo-webhook] payment.succeeded for audit but missing session_id metadata; webhook-id=${webhookId}`
        );
      } else {
        const recordRaw = await env.SESSIONS.get(`audit:${sessionId}`);
        if (recordRaw) {
          try {
            const record = JSON.parse(recordRaw) as SessionRecord;
            const next: SessionRecord = {
              ...record,
              status: "fulfilling",
              started_at: Date.now(),
            };
            await env.SESSIONS.put(
              `audit:${sessionId}`,
              JSON.stringify(next),
              { expirationTtl: 30 * 24 * 60 * 60 }
            );
          } catch (err) {
            console.error(
              `[dodo-webhook] failed to update session record: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        } else {
          console.error(
            `[dodo-webhook] payment.succeeded for unknown session_id=${sessionId}`
          );
        }

        // Fire-and-forget the fulfillment call. Do NOT await — Dodo expects a
        // fast 200 or it retries.
        if (env.INTERNAL_FULFILL_KEY) {
          const origin = requestOrigin(req);
          const fulfillUrl = `${origin}/api/audit-fulfill`;
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          fetch(fulfillUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-fulfill-key": env.INTERNAL_FULFILL_KEY,
            },
            body: JSON.stringify({ session_id: sessionId }),
          }).catch((err) => {
            console.error(
              `[dodo-webhook] fulfill dispatch failed: ${err instanceof Error ? err.message : String(err)}`
            );
          });
        } else {
          console.error(
            "[dodo-webhook] INTERNAL_FULFILL_KEY missing — fulfillment skipped"
          );
        }
      }
    } else if (tier === "implementation") {
      // F2 v6.1 D9 — webhook-side dispatch into impl-fulfill pipeline.
      // Within-file pattern: unawaited fetch + .catch (matches audit-tier above at lines 148-165).
      const f2Result = await handleF2ImplementationPayment(req, env, parsed, webhookId);
      if (f2Result.status !== 200) {
        // Mark webhook processed before returning (so Dodo retries hit the dedupe).
        // For 503 AT_CAPACITY: Dodo retries; operator manually refunds; alert already fired.
        await env.SESSIONS.put(dedupeKey, "1", { expirationTtl: WEBHOOK_DEDUPE_TTL });
        return f2Result;
      }
    } else if (tier === "custom") {
      console.error(
        `[dodo-webhook] custom scoping deposit received; manual followup needed. metadata=${JSON.stringify(metadata)}`
      );
    } else if (tier === "autopilot") {
      // F3: payment confirms but actual fulfillment happens at subscription.active
      // (separate top-level event type per V3.A). Log only here.
      console.log(
        `F3_AUTOPILOT_PAYMENT_RECEIVED subscription_id=${parsed.data?.subscription_id ?? "unknown"}; awaiting subscription.active`
      );
    } else if (tier === "concierge") {
      console.error(
        `[dodo-webhook] subscription purchased (tier=concierge); future flow (F4). metadata=${JSON.stringify(metadata)}`
      );
    } else {
      console.error(
        `[dodo-webhook] payment.succeeded with unrecognized tier=${tier ?? "<missing>"}; metadata=${JSON.stringify(metadata)}`
      );
    }
  } else if (eventType === "payment.failed") {
    console.error(
      `[dodo-webhook] payment.failed; metadata=${JSON.stringify(metadata)}`
    );
  } else if (eventType === "subscription.active") {
    // F3 fulfillment per spec v3.2 §2 D2. Ordered sequence (correctness-critical):
    //   1. resolve fields from Dodo payload
    //   2. ceiling check (OQ-16.A belt-and-suspenders)
    //   3. INSERT OR IGNORE into subscriptions (PRIMARY KEY → naturally idempotent)
    //   4. CAS UPDATE welcome_email_sent_at (§11.3)
    //   5. If CAS won, send welcome email
    const subscriptionId = parsed.data?.subscription_id ?? parsed.data?.id;
    const customerEmail = parsed.data?.customer?.email ?? parsed.data?.email;
    const customerId = parsed.data?.customer?.id ?? parsed.data?.customer_id ?? subscriptionId;
    const productId = parsed.data?.product_id ?? parsed.data?.items?.[0]?.product_id ?? "";
    const periodStart = toUnixSeconds(parsed.data?.created_at) ?? Math.floor(Date.now() / 1000);
    const periodEnd = toUnixSeconds(parsed.data?.next_billing_date) ?? (periodStart + 30 * 24 * 60 * 60);

    if (!subscriptionId || !customerEmail) {
      console.error(`F3_WEBHOOK_MISSING_FIELDS subscription_id=${subscriptionId ?? "null"}`);
      return NextResponse.json({ ok: false, code: "MISSING_FIELDS" }, { status: 400 });
    }

    const now = Math.floor(Date.now() / 1000);

    // 2. Belt-and-suspenders ceiling check.
    const countRow = await env.CITATION_DB.prepare(
      `SELECT COUNT(*) AS c FROM customer_probe_targets WHERE status='active'`
    ).first<{ c: number }>();
    if ((countRow?.c ?? 0) >= 3) {
      console.error(
        `F3_OVER_CAPACITY_DIRECT_PURCHASE subscription_id=${subscriptionId.substring(0, 8)}... — operator must refund via Dodo dashboard`
      );
      return NextResponse.json({ ok: false, code: "OVER_CAPACITY" }, { status: 503 });
    }

    // 3. INSERT OR IGNORE subscriptions row.
    await env.CITATION_DB.prepare(
      `INSERT OR IGNORE INTO subscriptions
       (subscription_id, customer_id, customer_email, product_id, status,
        current_period_start, current_period_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`
    )
      .bind(subscriptionId, customerId, customerEmail, productId, periodStart, periodEnd, now, now)
      .run();

    // 4. CAS UPDATE welcome_email_sent_at (atomic; single-statement; race-free).
    const casResult = await env.CITATION_DB.prepare(
      `UPDATE subscriptions
       SET welcome_email_sent_at = ?
       WHERE subscription_id = ? AND welcome_email_sent_at IS NULL`
    )
      .bind(now, subscriptionId)
      .run();

    // 5. If CAS won, send welcome email.
    if (casResult.meta.changes === 1) {
      try {
        const { sendWelcomeEmail } = await import("@/lib/welcome-email");
        await sendWelcomeEmail(env, subscriptionId, customerEmail);
      } catch (err) {
        // Resend bounce/error logging surfaces delivery failures operationally.
        console.error(
          `F3_WELCOME_EMAIL_SEND_FAILED subscription_id=${subscriptionId.substring(0, 8)}...`,
          err
        );
      }
    }
  } else if (eventType === "subscription.renewed") {
    // F3: critical for D8 sunset semantics. Without this, current_period_end stays stale
    // across renewals → cancellation flips customers to 'expired' at original period_end.
    const subscriptionId = parsed.data?.subscription_id ?? parsed.data?.id;
    if (!subscriptionId) {
      console.error("F3_RENEWAL_WEBHOOK_MISSING_SUBSCRIPTION_ID");
      return NextResponse.json({ ok: false, code: "MISSING_FIELDS" }, { status: 400 });
    }
    const newPeriodStart = toUnixSeconds(parsed.data?.created_at) ?? Math.floor(Date.now() / 1000);
    const newPeriodEnd =
      toUnixSeconds(parsed.data?.next_billing_date) ?? newPeriodStart + 30 * 24 * 60 * 60;
    const now = Math.floor(Date.now() / 1000);
    await env.CITATION_DB.prepare(
      `UPDATE subscriptions SET current_period_start = ?, current_period_end = ?, updated_at = ? WHERE subscription_id = ?`
    )
      .bind(newPeriodStart, newPeriodEnd, now, subscriptionId)
      .run();
  } else if (eventType === "subscription.cancelled") {
    // F3 D8: silent transition. No customer-facing email; Dodo sends cancellation confirmation.
    // customer_probe_targets.status stays 'active' until period_end (sunset semantics per OQ-02 D4).
    const subscriptionId = parsed.data?.subscription_id ?? parsed.data?.id;
    if (!subscriptionId) {
      console.error("F3_CANCEL_WEBHOOK_MISSING_SUBSCRIPTION_ID");
      return NextResponse.json({ ok: false, code: "MISSING_FIELDS" }, { status: 400 });
    }
    const cancelledAt = Math.floor(Date.now() / 1000);
    // F3.2.1 D4: clear cancel_pending_at alongside canonical-state cancellation. Belt-and-suspenders
    // path per F3.2 V-B observation — Dodo fires this event at actual period_end (NOT on flag flip),
    // so the primary clear path during active subscription lifetime is D3 (reactivate route).
    await env.CITATION_DB.prepare(
      `UPDATE subscriptions SET status = 'cancelled', cancelled_at = ?, cancel_pending_at = NULL, updated_at = ? WHERE subscription_id = ?`
    )
      .bind(cancelledAt, cancelledAt, subscriptionId)
      .run();
  } else if (eventType === "subscription.reactivated") {
    // F3.2 D11: customer un-cancelled via /api/account/reactivate (or Dodo customer portal).
    // V-B at deploy time confirms exact event name; may be "subscription.resumed" or surfaced
    // via "subscription.updated" with cancel_at_next_billing_date=false (see pivot-path doc).
    const subscriptionId = parsed.data?.subscription_id ?? parsed.data?.id;
    if (!subscriptionId) {
      console.error("F3_REACTIVATE_WEBHOOK_MISSING_SUBSCRIPTION_ID");
      return NextResponse.json({ ok: false, code: "MISSING_FIELDS" }, { status: 400 });
    }
    const reactivatedAt = Math.floor(Date.now() / 1000);
    // F3.2.1 D5: clear cancel_pending_at alongside status restore.
    await env.CITATION_DB.prepare(
      `UPDATE subscriptions SET status = 'active', cancelled_at = NULL, cancel_pending_at = NULL, updated_at = ? WHERE subscription_id = ?`,
    )
      .bind(reactivatedAt, subscriptionId)
      .run();
    console.log(
      `F3_SUBSCRIPTION_REACTIVATED subscription_id=${subscriptionId.substring(0, 12)}`,
    );
  } else if (
    eventType === "subscription.failed" ||
    eventType === "subscription.on_hold" ||
    eventType === "subscription.plan_changed"
  ) {
    // F3 v1.0: dunning deferred to Dodo per spec §1.4. Log only.
    console.log(
      `F3_SUBSCRIPTION_EVENT_LOGGED type=${eventType} subscription_id=${parsed.data?.subscription_id ?? "unknown"}`
    );
  } else {
    console.error(`[dodo-webhook] unknown event type=${eventType}`);
  }

  // Mark webhook processed (after dispatch so retries during in-flight
  // fulfillment still rerun the dispatch — which is harmless because the
  // fulfillment route itself short-circuits on non-fulfilling state).
  await env.SESSIONS.put(dedupeKey, "1", {
    expirationTtl: WEBHOOK_DEDUPE_TTL,
  });

  return NextResponse.json({ ok: true });
}

// ─── F2 v6.1 D9 — Implementation tier branch handler ───────────────────
//
// Called from the payment.succeeded dispatch above when metadata.tier === "implementation".
// Returns a NextResponse OR { status: 200 } on success so caller can fall through to the
// shared mark-processed footer.

async function handleF2ImplementationPayment(
  req: Request,
  env: WebhookEnv,
  parsed: DodoWebhookPayload,
  webhookId: string,
): Promise<NextResponse | { status: 200 }> {
  // V-E defensive belt-and-suspenders: F2 is one-shot; subscription_id MUST be null.
  if (parsed.data?.subscription_id != null) {
    console.warn(
      `F2_UNEXPECTED_SUBSCRIPTION_ID payment_id=${parsed.data?.payment_id ?? parsed.data?.id ?? "null"}`,
    );
    return NextResponse.json({ ok: true, skipped: "has-subscription-id" });
  }

  // V-A.2 defensive ??-fallback (matches shipped F3 pattern at lines 206-211)
  const productId =
    parsed.data?.product_cart?.[0]?.product_id ??
    parsed.data?.items?.[0]?.product_id ??
    parsed.data?.product_id ??
    "";
  if (productId !== F2_IMPLEMENTATION_PRODUCT_ID) {
    console.warn(
      `F2_WRONG_PRODUCT_ID payment_id=${parsed.data?.payment_id ?? parsed.data?.id} product_id=${productId}`,
    );
    return NextResponse.json({ ok: true, skipped: "wrong-product" });
  }

  const dodoCustomerId =
    parsed.data?.customer?.customer_id ??
    parsed.data?.customer?.id ??
    parsed.data?.customer_id;
  const dodoPaymentId = parsed.data?.payment_id ?? parsed.data?.id;
  const customerEmail = parsed.data?.customer?.email ?? parsed.data?.email;

  if (!dodoCustomerId || !dodoPaymentId || !customerEmail) {
    console.error(
      `F2_MISSING_REQUIRED_FIELDS payment_id=${dodoPaymentId ?? "null"} customer_id=${dodoCustomerId ?? "null"}`,
    );
    return NextResponse.json({ ok: true, error: "MISSING_REQUIRED" });
  }

  // Parse the 5 custom_field_responses per spec v6.1 D17
  const responses = parsed.data?.custom_field_responses ?? [];
  const responseMap = Object.fromEntries(responses.map((r) => [r.key, r.value]));
  const siteUrl = responseMap.site_url;
  const brandName = responseMap.brand_name;
  const category = responseMap.category;
  const competitorsRaw = responseMap.competitors ?? "";
  const competitors = competitorsRaw
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);
  const deliveryEmail = responseMap.delivery_email || customerEmail;

  if (!siteUrl || !brandName || !category) {
    console.error(
      `F2_MISSING_CUSTOM_FIELDS payment_id=${dodoPaymentId} responses=${JSON.stringify(responses)}`,
    );
    // Alert dedupe (Codex MED v2): one alert per webhook-id
    const alertDedupeKey = `webhook-alert:${webhookId}`;
    const alreadyAlerted = await env.SESSIONS.get(alertDedupeKey);
    if (!alreadyAlerted) {
      await sendOperatorAlert(env, {
        alert_code: "F2_MISSING_CUSTOM_FIELDS",
        customer_email: customerEmail,
        dodo_payment_id: dodoPaymentId,
        notes: "Missing required custom fields; manual fulfillment needed.",
      });
      await env.SESSIONS.put(alertDedupeKey, "1", { expirationTtl: WEBHOOK_DEDUPE_TTL });
    }
    return NextResponse.json({ ok: true, error: "MISSING_FIELDS_REPORTED" });
  }

  // D18 Stage 2 — belt-and-suspenders ceiling check (self-exclusion form per HIGH-1 lock).
  const ceilingCheck = await env.CITATION_DB.prepare(
    `SELECT COUNT(*) AS count FROM customer_probe_targets
     WHERE status='active' AND customer_id != ?`,
  )
    .bind(dodoCustomerId)
    .first<{ count: number }>();

  if (ceilingCheck && ceilingCheck.count >= 3) {
    console.error(`F2_OVER_CAPACITY_DIRECT_PURCHASE payment_id=${dodoPaymentId}`);
    const alertDedupeKey = `webhook-alert:${webhookId}`;
    const alreadyAlerted = await env.SESSIONS.get(alertDedupeKey);
    if (!alreadyAlerted) {
      await sendOperatorAlert(env, {
        alert_code: "F2_OVER_CAPACITY_DIRECT_PURCHASE",
        customer_email: customerEmail,
        dodo_payment_id: dodoPaymentId,
        notes: "Direct-URL bypass of /implementation page-CTA gate. Customer paid; needs manual refund.",
      });
      await env.SESSIONS.put(alertDedupeKey, "1", { expirationTtl: WEBHOOK_DEDUPE_TTL });
    }
    return NextResponse.json({ ok: false, code: "AT_CAPACITY" }, { status: 503 });
  }

  // INSERT OR IGNORE on dodo_payment_id UNIQUE (idempotent against webhook retry)
  const sessionId = `impl-${dodoPaymentId}`;
  const now = Math.floor(Date.now() / 1000);
  const paymentTime = parsed.timestamp
    ? Math.floor(new Date(parsed.timestamp).getTime() / 1000)
    : now;
  const competitorsJson = JSON.stringify(competitors);

  const insertResult = await env.CITATION_DB.prepare(
    `INSERT OR IGNORE INTO implementation_sessions
       (session_id, dodo_payment_id, customer_email, customer_domain, brand_name, category, competitors,
        customer_id, status, payment_succeeded_at, bundle_expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
  )
    .bind(
      sessionId,
      dodoPaymentId,
      deliveryEmail,
      siteUrl,
      brandName,
      category,
      competitorsJson,
      dodoCustomerId,
      paymentTime,
      paymentTime + 91 * 86400,
      now,
      now,
    )
    .run();

  if (insertResult.meta.changes !== 1) {
    // Duplicate webhook delivery; idempotent no-op
    return NextResponse.json({ ok: true, deduped: true });
  }

  // Fire-and-forget dispatch to /api/impl-fulfill (within-file unawaited fetch + .catch pattern;
  // matches audit-tier dispatch at lines 148-165).
  if (env.INTERNAL_FULFILL_KEY) {
    const origin = requestOrigin(req);
    const implFulfillUrl = `${origin}/api/impl-fulfill`;
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    fetch(implFulfillUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-fulfill-key": env.INTERNAL_FULFILL_KEY,
      },
      body: JSON.stringify({ session_id: sessionId }),
    }).catch((err) => {
      console.error(
        `F2_IMPL_FULFILL_FIRE_FAILED session_id=${sessionId} err=${err instanceof Error ? err.message : String(err)}`,
      );
    });
  } else {
    console.error(`F2_INTERNAL_FULFILL_KEY_MISSING session_id=${sessionId} — fulfillment dispatch skipped`);
  }

  // Caller falls through to shared mark-processed footer + 200 response.
  return { status: 200 };
}
