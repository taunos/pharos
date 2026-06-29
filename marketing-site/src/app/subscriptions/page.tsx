import type { Metadata } from "next";
import { Fragment } from "react";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// Force dynamic rendering: capacity-gate read at §3.10 requires runtime D1 access
// (not available during static prerender).
export const dynamic = "force-dynamic";

// F3 OQ-16.D: render-time capacity gate. Reads customer_probe_targets count via
// the cross-bound CITATION_DB. When at capacity (count >= env.MAX_PROBE_TARGETS),
// forces the Standard CTA to waitlist regardless of the manual-flip CHECKOUT_STANDARD_URL.
// Fail-closed: D1 errors route to waitlist (better than accepting payment when over capacity).
// B1.3 v1.1: ceiling raised from hardcoded 3 to env.MAX_PROBE_TARGETS (default "30").
interface CapacityCheckEnv {
  CITATION_DB: D1Database;
  // B1.3 v1.1 — replaces hardcoded ceiling=3 (default "30").
  MAX_PROBE_TARGETS?: string;
  // F-Fnd Phase 3.0 widening: gates the Founding-pricing section render.
  F_FND_COPY_LIVE: string;
}
async function getActiveCustomerCountAndCeiling(): Promise<{ count: number; ceiling: number }> {
  let ceiling = 30;
  try {
    const env = getCloudflareContext().env as unknown as CapacityCheckEnv;
    ceiling = parseInt(env.MAX_PROBE_TARGETS ?? "30", 10);
    const row = await env.CITATION_DB.prepare(
      `SELECT COUNT(*) AS c FROM customer_probe_targets WHERE status='active'`
    ).first<{ c: number }>();
    return { count: row?.c ?? 0, ceiling };
  } catch (err) {
    console.error("F3_CAPACITY_CHECK_FAILED", err);
    return { count: 99, ceiling };  // fail closed
  }
}

export const metadata: Metadata = {
  title: "Subscriptions -- $149 Standard / $899 Pro -- Astrant",
  description:
    "Keep your agent-discoverability stack healthy and measure its impact. Two tiers: Standard ($149/month, fully automated) and Pro ($899/month, daily probe cadence). Month-to-month, cancel anytime.",
  alternates: {
    types: { "text/markdown": "/subscriptions.md" },
  },
};

// PRE-LAUNCH MODE -- paid checkouts disabled site-wide. Subscription CTAs now point at
// the /audit waitlist (which captures URL + email via /api/waitlist).
// To restore real Dodo checkouts at gate-revert, swap the const values to:
//   CHECKOUT_STANDARD_URL = `https://checkout.dodopayments.com/buy/${env.STANDARD_PRODUCT_ID}?quantity=1`
//     = https://checkout.dodopayments.com/buy/pdt_0NdQEbaRcrAC3qQuCAlnh?quantity=1  -> Standard $149
//   CHECKOUT_PRO_URL = `https://checkout.dodopayments.com/buy/${env.PRO_PRODUCT_ID}?quantity=1`
//     = https://checkout.dodopayments.com/buy/pdt_0NdQEw8wrcH0nd5OlZ3IJ?quantity=1     -> Pro $899
const CHECKOUT_STANDARD_URL = "/audit#waitlist";
const CHECKOUT_PRO_URL = "/audit#waitlist";

const serviceLd = [
  {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "Standard Subscription",
    provider: { "@type": "Organization", name: "Astrant" },
    serviceType: "Agent Engine Optimization",
    areaServed: "Worldwide",
    url: "https://astrant.io/subscriptions",
    offers: {
      "@type": "Offer",
      name: "Standard Subscription",
      url: "https://astrant.io/subscriptions",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: "149",
        priceCurrency: "USD",
        billingDuration: "P1M",
      },
      description:
        "Stay legible to ChatGPT, Claude, Perplexity, and Gemini — twice-weekly citation probes detecting mentions of your brand and tracked competitors, monthly agent-citation report, monthly Astrant Score recalibration, hosted MCP endpoint.",
    },
  },
  {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "Pro Subscription",
    provider: { "@type": "Organization", name: "Astrant" },
    serviceType: "Agent Engine Optimization",
    areaServed: "Worldwide",
    url: "https://astrant.io/subscriptions",
    offers: {
      "@type": "Offer",
      name: "Pro Subscription",
      url: "https://astrant.io/subscriptions",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: "899",
        priceCurrency: "USD",
        billingDuration: "P1M",
      },
      description:
        "Everything in Standard plus daily citation probes and gap intelligence — which tracked competitors get cited in the prompts where your brand is absent — across ChatGPT, Claude, Perplexity, and Gemini, with sub-24-hour competitive change detection.",
    },
  },
];

const FAQS = [
  {
    q: "Do I need to complete Implementation first?",
    a: "No — you can start Standard anytime to get the monthly scan and report. Pro is strongest if you've done Implementation; otherwise there's less to \"manage.\"",
  },
  {
    q: "Can I upgrade Standard to Pro mid-month?",
    a: "Yes. Prorated via Dodo Payments; takes effect immediately.",
  },
  {
    q: "What happens if I cancel?",
    a: "You keep every artifact. MCP server stays live on your Cloudflare account. Monthly reports stop.",
  },
];

const faqLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
};

// D13 comparison-table model (locked design 2026-06-29). Shared rows = ✓✓ both tiers;
// diff rows carry the tier split. Literal apostrophes inside TS strings (C9).
const SUBS_SHARED = [
  "Hosted MCP endpoint on your domain",
  "Monthly PDF intelligence report",
  "Monthly Astrant Score recalibration",
  "Brand mention detection — see when you're cited",
  "Competitor presence — who gets cited in your category",
];

const SUBS_DIFF: { label: string; standard: string; pro: string }[] = [
  { label: "Citation-probe cadence", standard: "Twice-weekly", pro: "Daily — 3.5×" },
  {
    label: "Gap intelligence — where competitors win and you're not cited",
    standard: "✗",
    pro: "✓ Included",
  },
];

// Light amber wash for the two differentiator rows (inline style — color-mix in a
// Tailwind arbitrary value is brittle across builds).
const amberWash = { background: "color-mix(in srgb, var(--color-accent) 8%, transparent)" } as const;

// Neutral row divider for the Pro column interior cells: a thin grey top border
// (matching the Standard column) while Tailwind keeps the amber left/right sides.
// Inline style avoids brittle per-side Tailwind arbitrary border colors.
const rowDivider = { borderTop: "1px solid var(--color-border)" } as const;

const EXCLUDED = [
  "New MCP tools or new feature builds (separate Implementation or Custom work)",
  "Major content rewrites (small updates are in scope for Pro; full rewrites aren't)",
  "Non-AEO SEO work (that's a different business, not ours)",
];

// Logo + Foundation slice — both CTAs are 503-gated waitlist mode (per the
// CHECKOUT_*_URL constants pointing at /audit#waitlist). Decision 5 EXCEPTION:
// 503-gated CTAs keep amber. Only the radius is stripped per decision 4.
function StandardCta({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href}
      className="inline-flex bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110"
    >
      {label}
    </a>
  );
}

function ProCta({ label }: { label: string }) {
  return (
    <a
      href={CHECKOUT_PRO_URL}
      className="inline-flex border border-[var(--color-accent)] px-6 py-3 text-base font-semibold text-[var(--color-accent)] transition hover:bg-[var(--color-accent)] hover:text-black"
    >
      {label}
    </a>
  );
}

function Check() {
  return <span className="text-lg text-[var(--color-fg)]">✓</span>;
}

export default async function SubscriptionsPage() {
  // F3 OQ-16.D capacity gate — layered on top of the manual-flip CHECKOUT_STANDARD_URL.
  // B1.3 v1.1 — MAX_PROBE_TARGETS env binding replaces hardcoded 3.
  const { count: customerCount, ceiling: maxProbeTargets } = await getActiveCustomerCountAndCeiling();
  const atCapacity = customerCount >= maxProbeTargets;
  const effectiveStandardUrl = atCapacity ? "/audit#waitlist" : CHECKOUT_STANDARD_URL;

  // F-Fnd: cohort lookup gated by F_FND_COPY_LIVE flag. Renders Founding section only
  // when flag is "true" AND cohort still has slots (reserved_count < cap).
  // Counter freshness: per-request (no ISR; force-dynamic above).
  const env = getCloudflareContext().env as unknown as CapacityCheckEnv;
  const isFoundingCopyLive = env.F_FND_COPY_LIVE === "true";
  let foundingCohort: { reserved: number; cap: number } | null = null;
  if (isFoundingCopyLive) {
    const row = await env.CITATION_DB.prepare(
      "SELECT reserved_count, cap FROM founding_cohort_meta WHERE id = 1"
    ).first<{ reserved_count: number; cap: number }>();
    if (row && row.reserved_count < row.cap) {
      foundingCohort = { reserved: row.reserved_count, cap: row.cap };
    }
  }

  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
      />
      <SiteHeader />

      <main>
        {/* HERO */}
        <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <span className="inline-flex rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-sm font-mono text-emerald-400">
            Standard $149 · Pro $899 · month-to-month
          </span>
          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">
            Stay findable.{" "}
            <span className="text-[var(--color-muted)]">Track what moves.</span>
          </h1>
          <p className="mt-6 text-lg text-[var(--color-muted)] sm:text-xl">
            Keep your agent-discoverability stack legible to ChatGPT, Claude,
            Perplexity, and Gemini — and measure what changes. Two tiers,
            month-to-month, cancel anytime.
          </p>
        </section>

        {/* F-FND FOUNDING SECTION — rendered only when F_FND_COPY_LIVE="true" AND cohort has slots */}
        {foundingCohort && (
          <section className="border-t border-[var(--color-border)]">
            <div className="mx-auto max-w-6xl px-6 py-20">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Founding Customer pricing
              </h2>
              <p className="mt-4 text-lg text-[var(--color-muted)]">
                {foundingCohort.reserved} of {foundingCohort.cap} founding subscriptions claimed
              </p>
              <p className="mt-6 max-w-3xl text-base text-[var(--color-muted)]">
                Founding Customer pricing locks at your subscription&apos;s launch price for as long as
                your subscription remains active. <strong>Cancelling your subscription permanently forfeits
                your Founding pricing</strong> &mdash; you&apos;ll be welcome back at our current rates, but your
                original Founding price won&apos;t apply on re-subscribe. Cumulative cohort: once 30 Founders
                sign up, the cohort closes permanently regardless of subsequent cancellations.
              </p>
            </div>
          </section>
        )}

        {/* COMPARE TIERS */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Compare tiers
            </h2>
            {/* DESKTOP — comparison table */}
            <div className="mt-10 hidden rounded-[14px] border border-[var(--color-border)] lg:grid lg:grid-cols-[1.7fr_1fr_1fr]">
              {/* Header: framing (fills the old empty column) */}
              <div className="flex flex-col justify-end p-6">
                <p className="font-mono text-xs uppercase tracking-[0.08em] text-[var(--color-accent)]">
                  Compare plans
                </p>
                <p className="mt-2 text-[17px] leading-snug text-[var(--color-fg)]">
                  Standard keeps you visible.
                  <br />
                  Pro shows where you&apos;re losing.
                </p>
              </div>
              {/* Header: Standard */}
              <div className="border-l border-[var(--color-border)] p-6 text-center">
                <div className="text-2xl font-semibold">Standard</div>
                <div className="mt-1.5 text-[var(--color-muted)]">
                  $149<span className="text-[13px]"> / mo</span>
                </div>
              </div>
              {/* Header: Pro (highlighted) */}
              <div className="relative rounded-t-[14px] border-x border-t border-[var(--color-accent)] bg-white/[0.02] p-6 text-center">
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[var(--color-accent)] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-black">
                  Best value
                </span>
                <div className="text-2xl font-semibold">Pro</div>
                <div className="mt-1.5 text-[var(--color-muted)]">
                  $899<span className="text-[13px]"> / mo</span>
                </div>
              </div>

              {/* Shared rows — full-contrast, equal in both columns */}
              {SUBS_SHARED.map((f) => (
                <Fragment key={f}>
                  <div className="flex items-center border-t border-[var(--color-border)] px-5 py-[18px] text-[15px]">
                    {f}
                  </div>
                  <div className="flex items-center justify-center border-t border-[var(--color-border)] px-5 py-[18px]">
                    <Check />
                  </div>
                  <div
                    className="flex items-center justify-center border-x border-[var(--color-accent)] bg-white/[0.02] px-5 py-[18px]"
                    style={rowDivider}
                  >
                    <Check />
                  </div>
                </Fragment>
              ))}

              {/* Differentiator rows — light amber wash across the whole row */}
              {SUBS_DIFF.map((d) => (
                <Fragment key={d.label}>
                  <div
                    className="flex items-center border-t border-[var(--color-border)] px-5 py-[18px] text-[15px] font-medium"
                    style={amberWash}
                  >
                    {d.label}
                  </div>
                  <div
                    className="flex items-center justify-center border-t border-[var(--color-border)] px-5 py-[18px] text-[15px]"
                    style={amberWash}
                  >
                    <span className={d.standard === "✗" ? "text-[var(--color-muted)]" : "text-[var(--color-fg)]"}>
                      {d.standard}
                    </span>
                  </div>
                  <div
                    className="flex items-center justify-center border-x border-[var(--color-accent)] px-5 py-[18px] text-[15px] font-semibold"
                    style={{ ...amberWash, ...rowDivider }}
                  >
                    {d.pro}
                  </div>
                </Fragment>
              ))}

              {/* CTA row */}
              <div className="flex items-center border-t border-[var(--color-border)] px-5 py-5 text-[13px] italic text-[var(--color-muted)]">
                Month-to-month. Cancel anytime.
              </div>
              <div className="flex items-center justify-center border-l border-t border-[var(--color-border)] px-5 py-5">
                <a
                  href={effectiveStandardUrl}
                  className="inline-flex border border-[var(--color-accent)] px-[18px] py-2.5 text-sm font-semibold text-[var(--color-accent)] transition hover:bg-[var(--color-accent)] hover:text-black"
                >
                  Notify me — Standard
                </a>
              </div>
              <div
                className="flex items-center justify-center rounded-b-[14px] border-x border-b border-[var(--color-accent)] bg-white/[0.02] px-5 py-5"
                style={rowDivider}
              >
                <a
                  href={CHECKOUT_PRO_URL}
                  className="inline-flex bg-[var(--color-accent)] px-[18px] py-2.5 text-sm font-semibold text-black transition hover:brightness-110"
                >
                  Notify me — Pro
                </a>
              </div>
            </div>

            {/* MOBILE — stacked cards */}
            <div className="mt-10 flex flex-col gap-6 lg:hidden">
              {/* Standard */}
              <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-2xl font-semibold">Standard</h3>
                  <span className="text-[var(--color-muted)]">$149 / mo</span>
                </div>
                <ul className="mt-5 flex flex-col gap-3 text-[15px]">
                  {SUBS_SHARED.map((f) => (
                    <li key={f} className="flex gap-3">
                      <span className="shrink-0 text-[var(--color-fg)]">✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                  {SUBS_DIFF.map((d) => (
                    <li key={d.label} className="flex justify-between gap-3 border-t border-[var(--color-border)] pt-3">
                      <span>{d.label}</span>
                      <span className="shrink-0 text-[var(--color-muted)]">{d.standard}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href={effectiveStandardUrl}
                  className="mt-6 inline-flex border border-[var(--color-accent)] px-[18px] py-2.5 text-sm font-semibold text-[var(--color-accent)] transition hover:bg-[var(--color-accent)] hover:text-black"
                >
                  Notify me — Standard
                </a>
              </div>
              {/* Pro (highlighted) */}
              <div className="relative rounded-[14px] border border-[var(--color-accent)] bg-white/[0.02] p-6">
                <span className="absolute -top-3 left-6 rounded-full bg-[var(--color-accent)] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-black">
                  Best value
                </span>
                <div className="flex items-baseline justify-between">
                  <h3 className="text-2xl font-semibold">Pro</h3>
                  <span className="text-[var(--color-muted)]">$899 / mo</span>
                </div>
                <ul className="mt-5 flex flex-col gap-3 text-[15px]">
                  {SUBS_SHARED.map((f) => (
                    <li key={f} className="flex gap-3">
                      <span className="shrink-0 text-[var(--color-fg)]">✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                  {SUBS_DIFF.map((d) => (
                    <li
                      key={d.label}
                      className="flex justify-between gap-3 border-t border-[var(--color-border)] pt-3 font-medium"
                    >
                      <span>{d.label}</span>
                      <span className="shrink-0 font-semibold">{d.pro}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href={CHECKOUT_PRO_URL}
                  className="mt-6 inline-flex bg-[var(--color-accent)] px-[18px] py-2.5 text-sm font-semibold text-black transition hover:brightness-110"
                >
                  Notify me — Pro
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* MONTHLY REPORT */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              What you get each month
            </h2>
            <p className="mt-6 text-lg text-[var(--color-muted)] sm:text-xl">
              One PDF, six sections. Direct MCP invocations, agent fetches of your
              pages, agent-attributed click-throughs, citation share across AI
              engines, conversion attribution where applicable, and three specific
              recommendations for the next month. You&apos;ll see exactly which AI
              engines surface your site, which prompts cite you, and how that ties
              to measurable business outcomes.
            </p>
          </div>
        </section>

        {/* EXCLUDED */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Clear boundaries
            </h2>
            <p className="mt-4 max-w-3xl text-lg text-[var(--color-muted)]">
              Subscriptions are optimization and operations. They don&apos;t cover:
            </p>
            <ul className="mt-10 flex flex-col gap-4 text-lg">
              {EXCLUDED.map((e) => (
                <li key={e} className="flex gap-4">
                  <span className="mt-1 shrink-0 text-red-400">✗</span>
                  <span className="text-[var(--color-muted)]">{e}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* FAQ */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">FAQ</h2>
            <dl className="mt-10 flex flex-col gap-6">
              {FAQS.map((f) => (
                <div
                  key={f.q}
                  className="border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6"
                >
                  <dt className="text-lg font-semibold">{f.q}</dt>
                  <dd className="mt-2 text-[var(--color-muted)]">{f.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Ready?
            </h2>
            <div className="mt-10 flex flex-wrap gap-4">
              <StandardCta label="Notify me when Standard launches" href={effectiveStandardUrl} />
              <ProCta label="Notify me when Pro launches" />
            </div>
            <p className="mt-4 text-sm italic text-[var(--color-muted)]">
              Not sure? Start with Standard and upgrade later — all settings carry
              over.
            </p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
