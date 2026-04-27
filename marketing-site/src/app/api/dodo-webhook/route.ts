import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyWebhook, type DodoEnvBindings } from "@/lib/dodo";
import type { SessionRecord } from "@/lib/audit-types";

interface WebhookEnv extends DodoEnvBindings {
  SESSIONS: KVNamespace;
  INTERNAL_FULFILL_KEY: string;
}

const WEBHOOK_DEDUPE_TTL = 7 * 24 * 60 * 60;

function originFromRequest(req: Request): string {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost ?? req.headers.get("host");
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (host && host.includes("localhost") ? "http" : "https");
  if (host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}

type DodoWebhookPayload = {
  type?: string;
  data?: {
    metadata?: Record<string, string>;
    payload_type?: string;
  };
};

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
          const origin = originFromRequest(req);
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
      console.error(
        `[dodo-webhook] implementation tier purchased; fulfillment not yet built. metadata=${JSON.stringify(metadata)}`
      );
    } else if (tier === "custom") {
      console.error(
        `[dodo-webhook] custom scoping deposit received; manual followup needed. metadata=${JSON.stringify(metadata)}`
      );
    } else if (tier === "autopilot" || tier === "concierge") {
      console.error(
        `[dodo-webhook] subscription purchased (tier=${tier}); future flow. metadata=${JSON.stringify(metadata)}`
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
  } else if (
    eventType === "subscription.active" ||
    eventType === "subscription.renewed" ||
    eventType === "subscription.cancelled" ||
    eventType === "subscription.failed" ||
    eventType === "subscription.on_hold" ||
    eventType === "subscription.plan_changed"
  ) {
    console.error(
      `[dodo-webhook] ${eventType}; metadata=${JSON.stringify(metadata)}`
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
