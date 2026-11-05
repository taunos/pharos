import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getPaymentProducts, verifyWebhook, type DodoEnvBindings } from "@/lib/dodo";
import { publicOrigin } from "@/lib/origin";
import type { SessionRecord } from "@/lib/audit-types";
import { alertOperator, sendOperatorAlert } from "@/lib/operator-alerts";
import {
  tryAssignFoundingStatus,
  resolveTierFromProductId,
  type AssignmentResult,
} from "@/lib/founding-pricing";
import { computeNextProbeAt, type ProbeCadence } from "@/lib/cadence";
import type { AuditFulfillMessage } from "@/lib/audit-fulfill-queue-consumer";
import type { FulfillMessage } from "@/lib/fulfill-queue-consumer";
import { updateFunnelStatus } from "@/lib/audit-funnel";
import { buildRightsRecord, writeRightsRecord } from "@/lib/dataset-consent";
import { AUDIT_PRODUCT_ID } from "@/lib/audit-gate";
import { isImplementationCheckoutEnabled } from "@/lib/implementation-gate";
import { isSubscriptionCheckoutEnabled } from "@/lib/subscription-gate";
import { parseMaxProbeTargets } from "@/lib/probe-ceiling";

interface WebhookEnv extends DodoEnvBindings {
  SESSIONS: KVNamespace;
  // F3 additions:
  CITATION_DB: D1Database;
  ONBOARDING_TOKEN_SECRET: string;
  RESEND_API_KEY: string;
  // F3.2 addition (sibling-cascade per WelcomeEmailEnv extension):
  ACCOUNT_LINK_SECRET: string;
  // F2 v6.1 addition (operator-alerts):
  OPERATOR_ALERT_EMAIL: string;
  // B1.3 v1.1 — replaces hardcoded ceiling=3 (default "30").
  MAX_PROBE_TARGETS?: string;
  // F-Fnd Phase 3.0 widenings (V-FP-PROD-A bytes-pinned at Phase 0.3):
  STANDARD_PRODUCT_ID: string;
  PRO_PRODUCT_ID: string;
  // F-Fnd Phase 3.0 sendWelcomeEmail-cascade (C12): WebhookEnv is passed into sendWelcomeEmail
  // whose WelcomeEmailEnv requires these. Without these here, tsc rejects the call at the
  // dynamic-import + invocation site (see Phase 3 verification gate output).
  EMAIL_UNSUB_SIGNING_KEY: string;
  ASTRANT_BASE_URL: string;
  // Test C-A (A3): durable Audit fulfillment producer (astrant-audit-fulfill).
  AUDIT_FULFILL_QUEUE?: Queue<AuditFulfillMessage>;
  // Test C-B: canonical public origin for the audit enqueue (wrangler var).
  PUBLIC_ORIGIN?: string;
  // Security pass 2026-11-04: the Implementation gate is enforced at the
  // webhook too, not only at checkout creation.
  IMPLEMENTATION_CHECKOUT_ENABLED?: string;
  // Slice Q (Q1g): durable Implementation producer (astrant-fulfill).
  FULFILL_QUEUE?: Queue<FulfillMessage>;
  // E4 (2026-11-05): server-side subscription launch gate (fail-closed).
  SUBSCRIPTION_CHECKOUT_ENABLED?: string;
}

const F2_IMPLEMENTATION_PRODUCT_ID = "pdt_0NdQE5vccUUgOHMsF6Pzz";

const WEBHOOK_DEDUPE_TTL = 7 * 24 * 60 * 60;
// E4: a welcome-send claim older than this is treated as a crashed attempt.
const WELCOME_CLAIM_STALE_S = 10 * 60;

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

type AuditPaymentCheck =
  | { kind: "ok" }
  | { kind: "reject"; reason: string }
  | { kind: "retry"; reason: string };

// Security pass 2026-11-04. A paid Audit requires: no subscription, and a
// non-empty cart whose EVERY item is the Audit product. A webhook without a
// cart is checked against Dodo's API (authoritative); an API failure is
// retryable, never a silent allow.
async function verifyAuditPayment(
  env: WebhookEnv,
  parsed: DodoWebhookPayload,
): Promise<AuditPaymentCheck> {
  const d = parsed.data ?? {};
  const subscriptionIds = (d as { subscription_ids?: unknown[] }).subscription_ids;
  if (d.subscription_id || (Array.isArray(subscriptionIds) && subscriptionIds.length > 0)) {
    return { kind: "reject", reason: "subscription payment" };
  }
  let cart: Array<{ product_id?: string }> | null =
    d.product_cart ?? d.items ?? (d.product_id ? [{ product_id: d.product_id }] : null);
  if (!cart || cart.length === 0) {
    const paymentId = d.payment_id;
    if (!paymentId) return { kind: "reject", reason: "no product evidence and no payment_id" };
    try {
      const looked = await getPaymentProducts(env, paymentId);
      if (looked.subscription_id || looked.subscription_ids.length > 0) {
        return { kind: "reject", reason: "subscription payment (API)" };
      }
      cart = looked.product_cart;
    } catch (err) {
      return { kind: "retry", reason: err instanceof Error ? err.message : String(err) };
    }
    if (!cart || cart.length === 0) return { kind: "reject", reason: "empty cart (API)" };
  }
  const wrong = cart.find((i) => i.product_id !== AUDIT_PRODUCT_ID);
  if (wrong) return { kind: "reject", reason: `cart contains product ${wrong.product_id ?? "?"}` };
  return { kind: "ok" };
}

// Durable record for a payment we took but did not fulfill, so a refund is
// never left to an email that might not arrive (alerts are fail-open).
// Returns false if the record could not be written; the caller must then
// answer 503 without the dedupe key so Dodo redelivers.
async function recordManualReview(
  env: WebhookEnv,
  kind: "manual-review" | "pending-verification",
  tier: string,
  paymentRef: string,
  reason: string,
): Promise<boolean> {
  try {
    await env.SESSIONS.put(
      `${kind}:${tier}:${paymentRef}`,
      JSON.stringify({ tier, payment_ref: paymentRef, reason, at: Date.now() }),
      { expirationTtl: 180 * 24 * 60 * 60 },
    );
    return true;
  } catch (err) {
    console.error(
      `[dodo-webhook] ${kind.toUpperCase()}_WRITE_FAILED ${tier} payment_id=${paymentRef}: ${err instanceof Error ? err.message : String(err)}`
    );
    return false;
  }
}

const retryLater = () =>
  NextResponse.json({ ok: false, reason: "retry later" }, { status: 503 });

// E3 (2026-11-05): every paid-but-not-fulfilled path goes through here, BEFORE
// the dedupe write. A durable manual-review record first (alerts are
// fail-open, console logs are sampled), then one operator alert. Returns false
// when the record could not be written: the caller must answer without the
// dedupe key so Dodo redelivers.
async function holdForManualReview(
  env: WebhookEnv,
  tier: string,
  paymentRef: string,
  alertCode: string,
  reason: string,
  sessionId = "",
): Promise<boolean> {
  console.error(`[dodo-webhook] ${alertCode} payment_id=${paymentRef}: ${reason}`);
  if (!(await recordManualReview(env, "manual-review", tier, paymentRef, reason))) {
    return false;
  }
  await alertOperator(
    env,
    alertCode,
    sessionId,
    `payment_id=${paymentRef}: ${reason} — not fulfilled; reconcile/refund manually (KV manual-review:${tier}:${paymentRef})`,
  );
  return true;
}

// A charge that belongs to a subscription (Standard/Pro). Those are fulfilled
// and gated by the subscription.* events, not by payment.succeeded.
function isSubscriptionPayment(parsed: DodoWebhookPayload): boolean {
  const d = parsed.data ?? {};
  const ids = (d as { subscription_ids?: unknown[] }).subscription_ids;
  return !!d.subscription_id || (Array.isArray(ids) && ids.length > 0);
}

// E4: on a redelivery after a failed welcome send, tryAssignFoundingStatus
// reports the founding row THIS subscription created as `already_founder`.
// If that row was assigned at or after this subscription's first activation,
// the customer is a new founder and gets the founding welcome.
async function firstWelcomeFoundingResult(
  env: WebhookEnv,
  customerId: string,
  subscriptionCreatedAt: number,
  result: AssignmentResult | null,
): Promise<AssignmentResult | null> {
  if (result?.kind !== "already_founder" || result.founding_status !== "active") return result;
  const row = await env.CITATION_DB.prepare(
    `SELECT founding_assigned_at FROM founding_customers WHERE customer_id = ?`
  )
    .bind(customerId)
    .first<{ founding_assigned_at: number }>();
  if (row && row.founding_assigned_at >= subscriptionCreatedAt) {
    return {
      kind: "newly_assigned",
      foundingOrderSeq: result.foundingOrderSeq,
      foundingTierLocks: result.foundingTierLocks,
    };
  }
  return result;
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

    // Security pass 2026-11-04: bind "paid" to the product actually bought.
    // Metadata is buyer-influenceable on some Dodo flows; the cart is not.
    const paymentRef = parsed.data?.payment_id ?? parsed.data?.id ?? "null";
    const auditCheck =
      tier === "audit" ? await verifyAuditPayment(env, parsed) : null;

    if (auditCheck?.kind === "retry") {
      // Dodo lookup unavailable: no dedupe write, so Dodo redelivers (8
      // attempts total). Leave a durable trace + one alert so a payment whose
      // retries all fail is never lost.
      console.error(
        `[dodo-webhook] AUDIT_PAYMENT_LOOKUP_FAILED payment_id=${paymentRef}: ${auditCheck.reason}`
      );
      const pendingKey = `pending-verification:audit:${paymentRef}`;
      const alreadyPending = await env.SESSIONS.get(pendingKey).catch(() => null);
      if (!alreadyPending) {
        await recordManualReview(env, "pending-verification", "audit", paymentRef, auditCheck.reason);
        await alertOperator(
          env,
          "AUDIT_PAYMENT_LOOKUP_FAILED",
          sessionId ?? "",
          `payment_id=${paymentRef}: ${auditCheck.reason} — Dodo will retry; if it never clears, verify and fulfil manually (KV ${pendingKey})`,
        );
      }
      return retryLater();
    } else if (auditCheck?.kind === "reject") {
      console.error(
        `[dodo-webhook] AUDIT_PAYMENT_REJECTED payment_id=${paymentRef} session_id=${sessionId ?? ""}: ${auditCheck.reason}`
      );
      if (!(await recordManualReview(env, "manual-review", "audit", paymentRef, auditCheck.reason))) {
        return retryLater();
      }
      await alertOperator(
        env,
        "AUDIT_PAYMENT_REJECTED",
        sessionId ?? "",
        `payment_id=${paymentRef}: ${auditCheck.reason} — not fulfilled; reconcile/refund manually (KV manual-review:audit:${paymentRef})`,
      );
    } else if (tier === "implementation" && !isImplementationCheckoutEnabled(env)) {
      console.error(
        `[dodo-webhook] IMPLEMENTATION_PAID_WHILE_CLOSED payment_id=${paymentRef}`
      );
      if (!(await recordManualReview(env, "manual-review", "implementation", paymentRef, "gate closed"))) {
        return retryLater();
      }
      await alertOperator(
        env,
        "IMPLEMENTATION_PAID_WHILE_CLOSED",
        "",
        `payment_id=${paymentRef} — gate closed, not fulfilled; refund manually (KV manual-review:implementation:${paymentRef})`,
      );
    } else if (tier === "audit") {
      // A retry that now verifies clears any earlier pending-verification trace.
      try {
        await env.SESSIONS.delete?.(`pending-verification:audit:${paymentRef}`);
      } catch {
        // Non-fatal: the record only drives manual reconciliation.
      }
      if (!sessionId) {
        console.error(
          `[dodo-webhook] payment.succeeded for audit but missing session_id metadata; webhook-id=${webhookId}`
        );
        await alertOperator(env, "AUDIT_PAID_SESSION_ID_MISSING", "", `webhook-id=${webhookId}`);
      } else {
        // Test C-A (A3 + R2-1): durable dispatch via AUDIT_FULFILL_QUEUE.
        // Order: enqueue FIRST, then write {fulfilling, paid_at, enqueued_at},
        // and the webhook dedupe key LAST (outer handler). If the send fails
        // we return 500 with no state change and no dedupe write, so Dodo's
        // retry re-enters cleanly.
        const recordRaw = await env.SESSIONS.get(`audit:${sessionId}`);
        let record: SessionRecord | null = null;
        if (recordRaw) {
          try {
            record = JSON.parse(recordRaw) as SessionRecord;
          } catch (err) {
            console.error(
              `[dodo-webhook] failed to parse session record: ${err instanceof Error ? err.message : String(err)}`
            );
            await alertOperator(env, "AUDIT_PAID_SESSION_UNREADABLE", sessionId);
          }
        } else {
          console.error(
            `[dodo-webhook] payment.succeeded for unknown session_id=${sessionId}`
          );
          // A paid Audit with no session record cannot be fulfilled — the
          // operator must reconcile/refund. Still 200 + dedupe (as before).
          await alertOperator(env, "AUDIT_PAID_SESSION_NOT_FOUND", sessionId);
        }

        if (record) {
          const needsEnqueue =
            record.status === "awaiting_payment" ||
            (record.status === "fulfilling" && !record.enqueued_at);
          if (!needsEnqueue) {
            console.log(
              `[dodo-webhook] audit session_id=${sessionId} already status=${record.status}${record.enqueued_at ? " (enqueued)" : ""}; no enqueue`
            );
          } else {
            try {
              if (!env.AUDIT_FULFILL_QUEUE) {
                throw new Error("AUDIT_FULFILL_QUEUE binding missing");
              }
              await env.AUDIT_FULFILL_QUEUE.send({
                session_id: sessionId,
                // Canonical origin: the buyer email links must not point at
                // the workers.dev host the webhook may arrive on.
                origin: publicOrigin(env, req),
              });
            } catch (err) {
              console.error(
                `[dodo-webhook] AUDIT_FULFILL_ENQUEUE_FAILED session_id=${sessionId}: ${err instanceof Error ? err.message : String(err)}`
              );
              return NextResponse.json(
                { ok: false, reason: "enqueue failed" },
                { status: 500 }
              );
            }
            const now = Date.now();
            const next: SessionRecord = {
              ...record,
              status: "fulfilling",
              started_at: record.started_at ?? now,
              paid_at: record.paid_at ?? now,
              enqueued_at: now,
            };
            try {
              await env.SESSIONS.put(
                `audit:${sessionId}`,
                JSON.stringify(next),
                { expirationTtl: 30 * 24 * 60 * 60 }
              );
            } catch (err) {
              // Already enqueued; no dedupe write so Dodo retries the state
              // write (a duplicate enqueue is the accepted R2-6 residual).
              console.error(
                `[dodo-webhook] failed to update session record: ${err instanceof Error ? err.message : String(err)}`
              );
              return NextResponse.json(
                { ok: false, reason: "session update failed" },
                { status: 500 }
              );
            }
            await updateFunnelStatus(env.SESSIONS, sessionId, "paid");
            // Dataset rights registry: durable (no TTL) only for a paid order;
            // abandoned checkouts leave nothing behind. Best-effort.
            const rights = buildRightsRecord("audit", record);
            if (rights) await writeRightsRecord(env.SESSIONS, sessionId, rights);
          }
        }
      }
    } else if (tier === "implementation") {
      // F2 v6.1 D9 — webhook-side dispatch into the Implementation pipeline.
      // Slice Q (Q1g): durable enqueue onto astrant-fulfill (kind "impl").
      const f2Result = await handleF2ImplementationPayment(env, parsed, webhookId);
      // Enqueue failed: no dedupe write, so Dodo's retry re-enters and re-sends.
      if (f2Result.status === 500) return f2Result;
      if (f2Result.status !== 200) {
        // Mark webhook processed before returning (so Dodo retries hit the dedupe).
        // For 503 AT_CAPACITY: Dodo retries; operator manually refunds; alert already fired.
        await env.SESSIONS.put(dedupeKey, "1", { expirationTtl: WEBHOOK_DEDUPE_TTL });
        return f2Result;
      }
    } else if (tier === "custom") {
      // E3: a paid scoping deposit is fulfilled by hand — durable record + alert.
      if (!(await holdForManualReview(env, "custom", paymentRef, "CUSTOM_DEPOSIT_PAID", "custom scoping deposit; manual follow-up needed", sessionId ?? ""))) {
        return retryLater();
      }
    } else if (tier === "autopilot" && !isSubscriptionPayment(parsed)) {
      // E3 (Codex r1): tier metadata is buyer-influenceable. An "autopilot"
      // payment with no subscription evidence will never see subscription.active.
      if (!(await holdForManualReview(env, "autopilot", paymentRef, "AUTOPILOT_PAID_NO_SUBSCRIPTION", "tier=autopilot without a subscription", sessionId ?? ""))) {
        return retryLater();
      }
    } else if (tier === "autopilot") {
      // F3: payment confirms but actual fulfillment happens at subscription.active
      // (separate top-level event type per V3.A). Log only here.
      console.log(
        `F3_AUTOPILOT_PAYMENT_RECEIVED subscription_id=${parsed.data?.subscription_id ?? "unknown"}; awaiting subscription.active`
      );
    } else if (tier === "concierge") {
      // E3: no automated concierge flow exists — durable record + alert.
      if (!(await holdForManualReview(env, "concierge", paymentRef, "CONCIERGE_PAID_NO_FLOW", "tier=concierge has no automated fulfillment", sessionId ?? ""))) {
        return retryLater();
      }
    } else if (!tier && isSubscriptionPayment(parsed)) {
      // A Standard/Pro subscription charge (Dodo buy links carry no tier
      // metadata). Fulfilment and its gate live in the subscription.* events;
      // alerting here would fire on every renewal.
      console.log(
        `[dodo-webhook] subscription payment.succeeded payment_id=${paymentRef}; handled by subscription.* events`
      );
    } else {
      // E3: unknown or missing tier on a one-shot payment — we took money and
      // nothing will fulfil it.
      if (!(await holdForManualReview(env, "unknown", paymentRef, "PAYMENT_UNKNOWN_TIER", `unrecognized tier=${tier ?? "<missing>"}`, sessionId ?? ""))) {
        return retryLater();
      }
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

    // E4 (2026-11-05): server-side launch gate + product allow-list. The
    // /subscriptions CTAs alone do not stop a direct Dodo buy link. A closed
    // gate or a product that is not Standard/Pro → durable manual-review record
    // + one alert; NO subscriptions row, NO onboarding email. Dedupe after.
    const subTier = resolveTierFromProductId(env, productId);
    if (!isSubscriptionCheckoutEnabled(env) || !subTier) {
      const reason = !subTier
        ? `product ${productId || "<missing>"} is not a subscription product`
        : "subscription gate closed";
      if (!(await holdForManualReview(env, "subscription", subscriptionId, "SUBSCRIPTION_NOT_PROVISIONED", reason))) {
        return retryLater();
      }
      await env.SESSIONS.put(dedupeKey, "1", { expirationTtl: WEBHOOK_DEDUPE_TTL });
      return NextResponse.json({ ok: true, held: "manual-review" });
    }

    const now = Math.floor(Date.now() / 1000);

    // 2. Belt-and-suspenders ceiling check. B1.3 v1.1 — MAX_PROBE_TARGETS env binding replaces hardcoded 3.
    const maxProbeTargets = parseMaxProbeTargets(env.MAX_PROBE_TARGETS);
    const countRow = await env.CITATION_DB.prepare(
      `SELECT COUNT(*) AS c FROM customer_probe_targets WHERE status='active'`
    ).first<{ c: number }>();
    if ((countRow?.c ?? 0) >= maxProbeTargets) {
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

    // F-Fnd: resolve tier + tryAssignFoundingStatus BEFORE CAS (per spec D9 ordering;
    // retry re-attempts CAS+email if assignment throws). MAX_PROBE_TARGETS ceiling check
    // at line ~244 stays where it is — Founding cohort × capacity coupling is intentional.
    // TS narrow: customerId per line 231 is `string | undefined` because each `??` operand
    // can be undefined; but the !subscriptionId early-return above guarantees subscriptionId
    // is defined-string at this point, and customerId's fallback chain ends with it — so
    // customerId IS defined at runtime. Explicit narrow for tryAssignFoundingStatus's strict signature.
    const fndCustomerId: string = customerId ?? subscriptionId;
    let foundingResult: AssignmentResult | null = await tryAssignFoundingStatus(
      env, fndCustomerId, subTier.tierKey, subTier.tierPriceCents,
    );

    // 4/5. E4 (2026-11-05): welcome_email_sent_at gets its real (positive)
    // timestamp only after a successful send. The old order (stamp, then send,
    // swallow the error) lost a failed welcome email for good.
    //   claim:   CAS NULL (or a stale claim) → -claimedAt. One concurrent
    //            delivery wins; the others skip (Codex r1: no double send).
    //   success: -claimedAt → now.
    //   failure: -claimedAt → NULL, 500 without dedupe, so Dodo redelivers.
    //   crash:   a claim older than WELCOME_CLAIM_STALE_S is re-claimable.
    // Residual: a send that succeeds but whose final stamp write fails is
    // re-sent on the next delivery (rare duplicate > silently lost link).
    const claimedAt = Math.floor(Date.now() / 1000);
    const claim = await env.CITATION_DB.prepare(
      `UPDATE subscriptions
       SET welcome_email_sent_at = ?
       WHERE subscription_id = ?
         AND (welcome_email_sent_at IS NULL
              OR (welcome_email_sent_at < 0 AND -welcome_email_sent_at < ?))`
    )
      .bind(-claimedAt, subscriptionId, claimedAt - WELCOME_CLAIM_STALE_S)
      .run();
    if (claim.meta.changes === 1) {
      const subCreated = await env.CITATION_DB.prepare(
        `SELECT created_at FROM subscriptions WHERE subscription_id = ?`
      )
        .bind(subscriptionId)
        .first<{ created_at: number }>();
      // A redelivery after a failed send sees the founding row it created the
      // first time as `already_founder`; that is still this subscription's
      // first welcome, so it must get the founding variant, not "welcome back".
      if (subCreated) {
        foundingResult = await firstWelcomeFoundingResult(env, fndCustomerId, subCreated.created_at, foundingResult);
      }
      try {
        const { sendWelcomeEmail } = await import("@/lib/welcome-email");
        await sendWelcomeEmail(env, subscriptionId, customerEmail, foundingResult);
      } catch (err) {
        console.error(
          `F3_WELCOME_EMAIL_SEND_FAILED subscription_id=${subscriptionId.substring(0, 8)}...`,
          err
        );
        await env.CITATION_DB.prepare(
          `UPDATE subscriptions SET welcome_email_sent_at = NULL
           WHERE subscription_id = ? AND welcome_email_sent_at = ?`
        )
          .bind(subscriptionId, -claimedAt)
          .run();
        // One alert per subscription, not one per redelivery (Codex r1).
        const alertKey = `welcome-alert:${subscriptionId}`;
        const alerted = await env.SESSIONS.get(alertKey).catch(() => null);
        if (!alerted) {
          await alertOperator(
            env,
            "F3_WELCOME_EMAIL_SEND_FAILED",
            "",
            `subscription_id=${subscriptionId}: welcome email failed; Dodo will retry. If it never arrives, resend manually.`,
          );
          await env.SESSIONS.put(alertKey, "1", { expirationTtl: WEBHOOK_DEDUPE_TTL }).catch(() => undefined);
        }
        // No positive stamp, no dedupe: Dodo redelivers and the send is retried.
        return NextResponse.json({ ok: false, reason: "welcome email failed" }, { status: 500 });
      }
      await env.CITATION_DB.prepare(
        `UPDATE subscriptions SET welcome_email_sent_at = ?
         WHERE subscription_id = ? AND welcome_email_sent_at = ?`
      )
        .bind(Math.floor(Date.now() / 1000), subscriptionId, -claimedAt)
        .run();
    } else {
      // Lost the claim. Acknowledge (and so dedupe) ONLY after observing a
      // real positive stamp. Anything else — another delivery mid-send, or a
      // claim released after a failed send between our CAS and this read
      // (Codex r2) — answers 503 without dedupe so this webhook stays
      // retryable until the welcome is actually sent.
      const cur = await env.CITATION_DB.prepare(
        `SELECT welcome_email_sent_at FROM subscriptions WHERE subscription_id = ?`
      )
        .bind(subscriptionId)
        .first<{ welcome_email_sent_at: number | null }>();
      if (!cur || cur.welcome_email_sent_at === null || cur.welcome_email_sent_at <= 0) {
        return retryLater();
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
    // F-Fnd: atomic batch — flip subscription status + flip founding_status at period-end.
    // V-DATA-NULL=0 confirmed Phase 0.1; current_period_end safe to read without COALESCE.
    await env.CITATION_DB.batch([
      env.CITATION_DB.prepare(
        `UPDATE subscriptions SET status = 'cancelled', cancelled_at = ?, cancel_pending_at = NULL, updated_at = ? WHERE subscription_id = ?`
      ).bind(cancelledAt, cancelledAt, subscriptionId),
      env.CITATION_DB.prepare(
        `UPDATE founding_customers
         SET founding_status = 'cancelled',
             founding_cancelled_at = (SELECT current_period_end FROM subscriptions WHERE subscription_id = ?),
             updated_at = ?
         WHERE customer_id = (SELECT customer_id FROM subscriptions WHERE subscription_id = ?)
           AND founding_status = 'active'`
      ).bind(subscriptionId, cancelledAt, subscriptionId),
    ]);
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
  } else if (eventType === "subscription.plan_changed") {
    // F-Fnd: tier-change handler. Sticky-locks JSON upsert — new tier's price added to
    // founding_tier_locks for Founder customers (founding_status='active' only).
    // Per V-FP-UPG Phase 0.2 (Path B): event=subscription.plan_changed, field=parsed.data?.product_id (bare).
    const subscriptionId = (parsed.data?.subscription_id ?? parsed.data?.id ?? "") as string;
    const newProductId = (parsed.data?.product_id ?? "") as string;
    const tier = resolveTierFromProductId(env, newProductId);

    if (!subscriptionId) {
      console.warn(JSON.stringify({
        kind: "fnd_tier_change_no_subscription_id",
        event_type: eventType,
        timestamp: Date.now(),
      }));
    } else if (!tier) {
      console.warn(JSON.stringify({
        kind: "fnd_tier_change_unknown_product",
        product_id_hex: Buffer.from(newProductId, "utf8").toString("hex"),
        subscription_id: subscriptionId,
        timestamp: Date.now(),
      }));
    } else {
      const nowSec = Math.floor(Date.now() / 1000);
      await env.CITATION_DB.prepare(
        `UPDATE founding_customers
         SET founding_tier_locks = json_set(founding_tier_locks, '$.' || ?, ?),
             updated_at = ?
         WHERE customer_id = (SELECT customer_id FROM subscriptions WHERE subscription_id = ?)
           AND founding_status = 'active'`
      ).bind(tier.tierKey, tier.tierPriceCents, nowSec, subscriptionId).run();

      // F4.1 D10 Variant B: cadence flip on upgrade/downgrade.
      // Defense-in-depth wrap per sweep #40 (subscriptionId + tier already narrowed by outer guards).
      if (subscriptionId && tier) {
        const payloadPreviousProductId = (parsed.data as { previous_product_id?: string } | undefined)?.previous_product_id ?? null;
        const effectiveAtRaw = (parsed.data as { effective_at?: unknown } | undefined)?.effective_at ?? null;
        const effectiveAt = effectiveAtRaw ? toUnixSeconds(effectiveAtRaw) : null;

        const subRow = await env.CITATION_DB.prepare(
          `SELECT customer_id, current_period_end, product_id FROM subscriptions WHERE subscription_id = ?`
        ).bind(subscriptionId).first<{
          customer_id: string;
          current_period_end: number | null;
          product_id: string;
        }>();

        if (subRow) {
          const customerId = subRow.customer_id;

          // Codex #2 fallback: payload field OR DB canonical product_id.
          const previousProductId = payloadPreviousProductId ?? subRow.product_id;
          const previousTier = resolveTierFromProductId(env, previousProductId);

          const isUpgradeToPro = previousTier?.tierKey === 'standard' && tier.tierKey === 'pro';
          const isDowngradeToStandard = previousTier?.tierKey === 'pro' && tier.tierKey === 'standard';

          if (isUpgradeToPro) {
            // Bruno lock #3 Reading A: today's enqueued probe still fires; daily kicks in tomorrow.
            await env.CITATION_DB.prepare(
              `UPDATE subscriptions SET product_id = ? WHERE subscription_id = ?`
            ).bind(newProductId, subscriptionId).run();

            const newNextProbeAt = computeNextProbeAt('daily', new Date(nowSec * 1000));
            await env.CITATION_DB.prepare(
              `UPDATE customer_probe_targets SET probe_cadence = 'daily', next_probe_at = ? WHERE customer_id = ?`
            ).bind(newNextProbeAt, customerId).run();
          } else if (isDowngradeToStandard) {
            // Variant B: defer per Bruno lock #4 + #16.
            // Defensive deferUntil: prefer effective_at; fall back to current_period_end proxy.
            const deferUntil = (effectiveAt && effectiveAt > nowSec)
              ? effectiveAt
              : (subRow.current_period_end && subRow.current_period_end > nowSec ? subRow.current_period_end : null);

            if (deferUntil) {
              await env.CITATION_DB.prepare(
                `UPDATE subscriptions
                 SET pending_product_id = ?, pending_probe_cadence = ?, cadence_change_effective_at = ?
                 WHERE subscription_id = ?`
              ).bind(newProductId, 'twice_weekly', deferUntil, subscriptionId).run();
            } else {
              // No temporal hint + no period_end proxy -> immediate flip fallback.
              await env.CITATION_DB.prepare(
                `UPDATE subscriptions SET product_id = ? WHERE subscription_id = ?`
              ).bind(newProductId, subscriptionId).run();
              const newNextProbeAt = computeNextProbeAt('twice_weekly', new Date(nowSec * 1000));
              await env.CITATION_DB.prepare(
                `UPDATE customer_probe_targets SET probe_cadence = 'twice_weekly', next_probe_at = ? WHERE customer_id = ?`
              ).bind(newNextProbeAt, customerId).run();
            }
          } else {
            // Other plan_changed cases (e.g., legacy product_id, Founder shifts not crossing Standard<->Pro):
            await env.CITATION_DB.prepare(
              `UPDATE subscriptions SET product_id = ? WHERE subscription_id = ?`
            ).bind(newProductId, subscriptionId).run();
          }
        } else {
          // subRow missing -- log and fall through (NO early-return per Codex HIGH #1).
          console.error(JSON.stringify({
            kind: 'f41_plan_changed_subscription_not_found',
            subscription_id: subscriptionId.substring(0, 12),
          }));
        }
      }
    }
    // Falls through to outer handler's dedupe-mark + 200 response.
  } else if (
    eventType === "subscription.failed" ||
    eventType === "subscription.on_hold" ||
    eventType === "subscription.plan_changed"
  ) {
    // F3 v1.0: dunning deferred to Dodo per spec §1.4. Log only.
    // NOTE: subscription.plan_changed is now caught by the F-Fnd branch above; this OR-condition
    // mention is unreachable post-F-Fnd but kept for explicit completeness. Cleanup deferred.
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
  env: WebhookEnv,
  parsed: DodoWebhookPayload,
  webhookId: string,
): Promise<NextResponse | { status: 200 }> {
  // V-E defensive belt-and-suspenders: F2 is one-shot; subscription_id MUST be null.
  const implPaymentRef = parsed.data?.payment_id ?? parsed.data?.id ?? "null";
  // E3: a validation failure is a paid-but-unfulfilled Implementation. Record
  // + alert before the caller's dedupe write; a failed record → 500 with no
  // dedupe (the caller returns 500s as-is) so Dodo redelivers.
  const hold = async (code: string, reason: string, body: Record<string, unknown>) => {
    if (!(await holdForManualReview(env, "implementation", implPaymentRef, code, reason))) {
      return NextResponse.json({ ok: false, reason: "retry later" }, { status: 500 });
    }
    return NextResponse.json(body);
  };
  if (parsed.data?.subscription_id != null) {
    return hold("F2_UNEXPECTED_SUBSCRIPTION_ID", "implementation payment carries a subscription_id", { ok: true, skipped: "has-subscription-id" });
  }

  // V-A.2 defensive ??-fallback (matches shipped F3 pattern at lines 206-211)
  const productId =
    parsed.data?.product_cart?.[0]?.product_id ??
    parsed.data?.items?.[0]?.product_id ??
    parsed.data?.product_id ??
    "";
  if (productId !== F2_IMPLEMENTATION_PRODUCT_ID) {
    return hold("F2_WRONG_PRODUCT_ID", `product_id=${productId || "<missing>"}`, { ok: true, skipped: "wrong-product" });
  }

  const dodoCustomerId =
    parsed.data?.customer?.customer_id ??
    parsed.data?.customer?.id ??
    parsed.data?.customer_id;
  const dodoPaymentId = parsed.data?.payment_id ?? parsed.data?.id;
  const customerEmail = parsed.data?.customer?.email ?? parsed.data?.email;

  if (!dodoCustomerId || !dodoPaymentId || !customerEmail) {
    return hold("F2_MISSING_REQUIRED_FIELDS", `customer_id=${dodoCustomerId ?? "null"} email=${customerEmail ? "present" : "missing"}`, { ok: true, error: "MISSING_REQUIRED" });
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
    // E3: durable record before the dedupe write (the alert below is fail-open).
    if (!(await recordManualReview(env, "manual-review", "implementation", dodoPaymentId, "missing custom fields"))) {
      return NextResponse.json({ ok: false, reason: "retry later" }, { status: 500 });
    }
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

  const sessionId = `impl-${dodoPaymentId}`;

  // Slice Q fix round: a redelivery for a payment we already recorded skips the
  // capacity gate (the order is already taken). A row still `queued` may have
  // lost its enqueue (P1b) — re-send; any other status is an idempotent no-op.
  // Only brand-new purchases reach the Stage-2 gate below.
  const existing = await env.CITATION_DB.prepare(
    `SELECT status FROM implementation_sessions WHERE session_id = ?`,
  )
    .bind(sessionId)
    .first<{ status: string }>();
  if (existing) {
    if (existing.status !== "queued") {
      return NextResponse.json({ ok: true, deduped: true });
    }
    return enqueueImplementation(env, sessionId);
  }

  // D18 Stage 2 — belt-and-suspenders ceiling check (self-exclusion form per HIGH-1 lock).
  // B1.3 v1.1 — MAX_PROBE_TARGETS env binding replaces hardcoded 3.
  const f2MaxProbeTargets = parseMaxProbeTargets(env.MAX_PROBE_TARGETS);
  const ceilingCheck = await env.CITATION_DB.prepare(
    `SELECT COUNT(*) AS count FROM customer_probe_targets
     WHERE status='active' AND customer_id != ?`,
  )
    .bind(dodoCustomerId)
    .first<{ count: number }>();

  if (ceilingCheck && ceilingCheck.count >= f2MaxProbeTargets) {
    console.error(`F2_OVER_CAPACITY_DIRECT_PURCHASE payment_id=${dodoPaymentId}`);
    // E3: durable record before the dedupe write (the alert below is fail-open).
    if (!(await recordManualReview(env, "manual-review", "implementation", dodoPaymentId, "over capacity"))) {
      return NextResponse.json({ ok: false, reason: "retry later" }, { status: 500 });
    }
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
    // A concurrent delivery inserted the row between the lookup above and this
    // INSERT; it enqueues (or 500s and Dodo retries into the lookup). No-op.
    return NextResponse.json({ ok: true, deduped: true });
  }

  return enqueueImplementation(env, sessionId);
}

// Slice Q (Q1g): durable dispatch via FULFILL_QUEUE. The row is inserted
// BEFORE the send (D1 is strongly consistent, so the consumer always sees
// it; the consumer's lease claim makes a duplicate enqueue harmless). On a
// send failure return 500 with NO dedupe write, so Dodo's retry re-enters,
// finds the row `queued` and re-sends.
async function enqueueImplementation(
  env: WebhookEnv,
  sessionId: string,
): Promise<NextResponse | { status: 200 }> {
  try {
    if (!env.FULFILL_QUEUE) throw new Error("FULFILL_QUEUE binding missing");
    await env.FULFILL_QUEUE.send({ kind: "impl", session_id: sessionId });
  } catch (err) {
    console.error(
      `F2_IMPL_ENQUEUE_FAILED session_id=${sessionId} err=${err instanceof Error ? err.message : String(err)}`,
    );
    return NextResponse.json({ ok: false, reason: "enqueue failed" }, { status: 500 });
  }

  // Caller falls through to shared mark-processed footer + 200 response.
  return { status: 200 };
}
