// F3.2 /account page — HMAC-signed self-service surface for cancel/reactivate.
// Per pharos-f3-2-subscription-management-self-service-spec.md v4 §7 D7 + §3.b D3.b.
// F-Fnd: Founder identity display + M1 tier-heuristic fix + founderForfeit warning prop.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyAccountLink } from "@/lib/account-link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { AccountActions } from "./account-actions";
import { resolveTierFromProductId } from "@/lib/founding-pricing";

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
  // F-Fnd Phase 3.0 widenings:
  STANDARD_PRODUCT_ID: string;
  PRO_PRODUCT_ID: string;
  F_FND_COPY_LIVE: string;
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
  // F-Fnd: LEFT JOIN'd from founding_customers ON customer_id; null when not a Founder.
  // V-DATA-NULL=0 confirmed Phase 0.1; current_period_* declared as non-null in the V-DATA=0 branch.
  founding_order_seq: number | null;
  founding_status: 'active' | 'cancelled' | null;
  founding_tier_locks: string | null;
  founding_cancelled_at: number | null;
}

// F-Fnd helpers (module scope; pure formatters).
function formatDate(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatTierPrice(
  tierLocksJson: string | null,
  currentProductId: string | null,
  env: { STANDARD_PRODUCT_ID: string; PRO_PRODUCT_ID: string },
): string {
  if (!tierLocksJson) return '';
  const tierLocks: Record<string, number> = JSON.parse(tierLocksJson);
  let tierKey: string;
  if (currentProductId === env.STANDARD_PRODUCT_ID) tierKey = 'standard';
  else if (currentProductId === env.PRO_PRODUCT_ID) tierKey = 'pro';
  else tierKey = Object.keys(tierLocks)[0] ?? 'standard';
  const cents = tierLocks[tierKey] ?? 0;
  const dollars = Math.floor(cents / 100);
  const tierLabel = tierKey.charAt(0).toUpperCase() + tierKey.slice(1);
  return `$${dollars}/mo (${tierLabel})`;
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

  // F-Fnd: single LEFT JOIN'd query — subscriptions + founding_customers ON customer_id.
  // V-DATA-NULL=0 confirmed Phase 0.1; current_period_* declared as non-null.
  const sub = await env.CITATION_DB.prepare(
    `SELECT s.subscription_id, s.customer_id, s.customer_email, s.product_id, s.status,
            s.current_period_start, s.current_period_end, s.cancelled_at, s.cancel_pending_at,
            fc.founding_order_seq, fc.founding_status, fc.founding_tier_locks, fc.founding_cancelled_at
     FROM subscriptions s
     LEFT JOIN founding_customers fc ON fc.customer_id = s.customer_id
     WHERE s.subscription_id = ?`,
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

  // F-Fnd M1 fix: resolve tier from product_id via env-bound SKUs (NOT substring heuristic).
  // 'Subscription' fallback for legacy/grandfathered product_ids (v6 L1).
  const resolvedTier = resolveTierFromProductId(env, sub.product_id);
  const tier: string = resolvedTier
    ? (resolvedTier.tierKey === 'standard' ? 'Standard' : 'Pro')
    : 'Subscription';

  // F-Fnd: pre-compute Founder display + forfeit props server-side. AccountView is module-scope
  // and doesn't have env; pre-compute here and pass through.
  const isFoundingCopyLive = env.F_FND_COPY_LIVE === 'true';

  const founderForfeit =
    isFoundingCopyLive
      && sub.founding_order_seq != null
      && sub.founding_status === 'active'
      && sub.status === 'active'
      && sub.cancel_pending_at == null
      && sub.current_period_end != null
      ? {
          seq: sub.founding_order_seq,
          formattedPrice: formatTierPrice(sub.founding_tier_locks, sub.product_id, env),
          periodEndStr: formatDate(sub.current_period_end),
        }
      : null;

  const founderDisplay =
    sub.founding_order_seq != null && sub.founding_status != null
      ? {
          seq: sub.founding_order_seq,
          status: sub.founding_status,
          formattedPrice: sub.founding_status === 'active'
            ? formatTierPrice(sub.founding_tier_locks, sub.product_id, env)
            : '',
          cancelledDateStr: sub.founding_cancelled_at != null
            ? formatDate(sub.founding_cancelled_at)
            : null,
        }
      : null;

  return (
    <AccountView
      sub={sub}
      portalUrl={portalUrl}
      tier={tier}
      founderForfeit={founderForfeit}
      founderDisplay={founderDisplay}
    />
  );
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
  tier,
  founderForfeit,
  founderDisplay,
}: {
  sub: SubscriptionRow;
  portalUrl: string | null;
  tier: string;  // F-Fnd: M1 fix; resolved server-side via resolveTierFromProductId
  founderForfeit: {
    seq: number;
    formattedPrice: string;
    periodEndStr: string;
  } | null;
  founderDisplay: {
    seq: number;
    status: 'active' | 'cancelled';
    formattedPrice: string;
    cancelledDateStr: string | null;
  } | null;
}) {
  const nowSec = Math.floor(Date.now() / 1000);
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

          {/* F-Fnd: Founder identity card — rendered between h1 and state label */}
          {founderDisplay && founderDisplay.status === 'active' && (
            <div className="mt-2 text-sm text-[var(--color-muted)]">
              You are Founding Member #{founderDisplay.seq}. Your Founding pricing of
              {' '}{founderDisplay.formattedPrice} is locked while your subscription remains
              active, subject to your subscription agreement.
            </div>
          )}
          {founderDisplay && founderDisplay.status === 'cancelled' && (
            <div className="mt-2 text-sm text-[var(--color-muted)]">
              You were Founding Member #{founderDisplay.seq}; pricing lock{' '}
              {founderDisplay.cancelledDateStr
                ? `expired on ${founderDisplay.cancelledDateStr}`
                : 'has expired'}.
            </div>
          )}

          <p className="mt-6 text-lg text-[var(--color-muted)]">{stateLabel}</p>

          <div className="mt-10 border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6">
            <AccountActions
              subscriptionId={sub.subscription_id}
              actionMode={actionMode}
              founderForfeit={founderForfeit}
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
