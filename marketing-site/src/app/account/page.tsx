// F3.2 /account page — HMAC-signed self-service surface for cancel/reactivate.
// Per pharos-f3-2-subscription-management-self-service-spec.md v4 §7 D7 + §3.b D3.b.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyAccountLink } from "@/lib/account-link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { AccountActions } from "./account-actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Manage your Astrant subscription",
  description: "Cancel, reactivate, or view your subscription status.",
};

interface AccountPageEnv {
  ACCOUNT_LINK_SECRET: string;
  CITATION_DB: D1Database;
  DODO_API_KEY: string;
  DODO_API_BASE_URL: string;
}

interface SubscriptionRow {
  subscription_id: string;
  customer_id: string;
  customer_email: string;
  product_id: string;
  status: string;
  current_period_start: number;
  current_period_end: number;
  cancelled_at: number | null;
  cancel_pending_at: number | null; // F3.2.1 D6
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; sig?: string }>;
}) {
  const env = getCloudflareContext().env as unknown as AccountPageEnv;
  const params = await searchParams;
  const subscriptionId = params.s ?? "";
  const sig = params.sig ?? "";

  if (!subscriptionId || !sig) return <InvalidLink />;
  const valid = await verifyAccountLink(env, subscriptionId, sig);
  if (!valid) return <InvalidLink />;

  const sub = await env.CITATION_DB.prepare(
    `SELECT subscription_id, customer_id, customer_email, product_id, status,
            current_period_start, current_period_end, cancelled_at, cancel_pending_at
     FROM subscriptions WHERE subscription_id = ?`,
  )
    .bind(subscriptionId)
    .first<SubscriptionRow>();

  if (!sub) return <InvalidLink />;

  let portalUrl: string | null = null;
  try {
    const portalRes = await fetch(
      `${env.DODO_API_BASE_URL}/customers/${encodeURIComponent(sub.customer_id)}/customer-portal/session`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.DODO_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );
    if (portalRes.ok) {
      const portalBody = (await portalRes.json()) as { link?: string };
      if (typeof portalBody.link === "string") portalUrl = portalBody.link;
    } else {
      console.error(
        `F3_ACCOUNT_PORTAL_FETCH_FAILED status=${portalRes.status} subscription_id=${sub.subscription_id.substring(0, 12)}`,
      );
    }
  } catch (err) {
    console.error(
      `F3_ACCOUNT_PORTAL_FETCH_ERROR subscription_id=${sub.subscription_id.substring(0, 12)}`,
      err,
    );
  }

  return <AccountView sub={sub} portalUrl={portalUrl} />;
}

function InvalidLink() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-2xl px-6 py-20 sm:py-28">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            This link is no longer valid
          </h1>
          <p className="mt-6 text-lg text-[var(--color-muted)]">
            Email{" "}
            <a
              href="mailto:support@astrant.io"
              className="text-[var(--color-accent)] underline-offset-2 hover:underline"
            >
              support@astrant.io
            </a>{" "}
            and we&rsquo;ll send you a fresh link.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function AccountView({
  sub,
  portalUrl,
}: {
  sub: SubscriptionRow;
  portalUrl: string | null;
}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const tier = sub.product_id.toLowerCase().includes("concierge")
    ? "Concierge"
    : "AutoPilot";
  const periodEndStr = new Date(sub.current_period_end * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  let stateLabel: string;
  let actionMode: "cancel" | "reactivate" | "expired" | "fallback";

  // F3.2.1 D6 early-precedence: cancel_pending_at takes precedence over status='active'. Handles the
  // Dodo-PATCH-acknowledged-but-period-end-webhook-not-yet-fired window (operationally the remainder
  // of the billing period — 1-30 days — per F3.2 V-B observation that Dodo doesn't webhook on
  // cancel_flag flips). Pre-webhook and post-webhook cancellation-pending paths converge to the
  // same UI per D6 spec table.
  if (sub.cancel_pending_at !== null && sub.status === "active") {
    stateLabel = `Cancellation pending — access through ${periodEndStr}`;
    actionMode = "reactivate";
  } else if (sub.status === "active") {
    stateLabel = `Active — renews ${periodEndStr}`;
    actionMode = "cancel";
  } else if (sub.status === "cancelled" && sub.current_period_end > nowSec) {
    stateLabel = `Cancellation pending — access through ${periodEndStr}`;
    actionMode = "reactivate";
  } else if (sub.status === "cancelled" && sub.current_period_end <= nowSec) {
    stateLabel = `Expired ${periodEndStr}`;
    actionMode = "expired";
  } else {
    stateLabel = `Status: ${sub.status} — contact support`;
    actionMode = "fallback";
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-2xl px-6 py-20 sm:py-28">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Astrant {tier}
          </h1>
          <p className="mt-6 text-lg text-[var(--color-muted)]">{stateLabel}</p>

          <div className="mt-10 border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6">
            <AccountActions
              subscriptionId={sub.subscription_id}
              actionMode={actionMode}
            />
          </div>

          {portalUrl && (
            <p className="mt-8 text-sm text-[var(--color-muted)]">
              <a
                href={portalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-accent)] underline-offset-2 hover:underline"
              >
                Manage payment method or view invoices →
              </a>{" "}
              (opens Dodo Payments portal)
            </p>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
