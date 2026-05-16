import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyAccountLink } from "@/lib/account-link";

interface CancelEnv {
  ACCOUNT_LINK_SECRET: string;
  CITATION_DB: D1Database;
  DODO_API_KEY: string;
  DODO_API_BASE_URL: string;
}

export async function POST(request: Request) {
  const env = getCloudflareContext().env as unknown as CancelEnv;
  let body: { s?: string; sig?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_REQUEST" }, { status: 400 });
  }

  const subscriptionId = body.s ?? "";
  const sig = body.sig ?? "";

  const valid = await verifyAccountLink(env, subscriptionId, sig);
  if (!valid) return NextResponse.json({ ok: false, code: "INVALID_SIG" }, { status: 400 });

  const sub = await env.CITATION_DB.prepare(
    `SELECT status, current_period_end FROM subscriptions WHERE subscription_id = ?`,
  )
    .bind(subscriptionId)
    .first<{ status: string; current_period_end: number }>();

  if (!sub) return NextResponse.json({ ok: false, code: "SUBSCRIPTION_NOT_FOUND" }, { status: 404 });

  if (sub.status === "cancelled") {
    return NextResponse.json({
      ok: true,
      status: "cancelled_pending_period_end",
      next_billing_date: sub.current_period_end,
    });
  }

  let dodoResponse: Response;
  try {
    dodoResponse = await fetch(
      `${env.DODO_API_BASE_URL}/subscriptions/${encodeURIComponent(subscriptionId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${env.DODO_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cancel_at_next_billing_date: true }),
      },
    );
  } catch (err) {
    console.error(
      `F3_ACCOUNT_CANCEL_DODO_NETWORK_ERROR subscription_id=${subscriptionId.substring(0, 12)}`,
      err,
    );
    return NextResponse.json({ ok: false, code: "DODO_API_ERROR" }, { status: 502 });
  }

  if (dodoResponse.status === 429) {
    return NextResponse.json({ ok: false, code: "DODO_RATE_LIMITED" }, { status: 429 });
  }
  if (!dodoResponse.ok) {
    console.error(
      `F3_ACCOUNT_CANCEL_DODO_API_ERROR status=${dodoResponse.status} subscription_id=${subscriptionId.substring(0, 12)}`,
    );
    return NextResponse.json({ ok: false, code: "DODO_API_ERROR" }, { status: 502 });
  }

  let nextBillingDate = sub.current_period_end;
  try {
    const dodoBody = (await dodoResponse.json()) as { next_billing_date?: number | string };
    if (typeof dodoBody.next_billing_date === "number") {
      nextBillingDate = dodoBody.next_billing_date;
    } else if (typeof dodoBody.next_billing_date === "string") {
      const parsed = Date.parse(dodoBody.next_billing_date);
      if (Number.isFinite(parsed)) nextBillingDate = Math.floor(parsed / 1000);
    }
  } catch {
    // Body parse failed; D1 fallback already in nextBillingDate.
  }

  console.log(`F3_ACCOUNT_CANCEL_REQUESTED subscription_id=${subscriptionId.substring(0, 12)}`);

  return NextResponse.json({
    ok: true,
    status: "cancelled_pending_period_end",
    next_billing_date: nextBillingDate,
  });
}
