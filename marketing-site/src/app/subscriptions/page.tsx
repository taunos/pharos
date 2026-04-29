import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "Subscriptions — $149 AutoPilot / $899 Concierge — Astrant",
  description:
    "Keep your agent-discoverability stack healthy and measure its impact. Two tiers: AutoPilot ($149/month, fully automated) and Concierge ($899/month, human updates + strategy). Month-to-month, cancel anytime.",
  alternates: {
    types: { "text/markdown": "/subscriptions.md" },
  },
};

// PRE-LAUNCH MODE — paid checkouts disabled site-wide. Subscription CTAs
// now point at the /audit waitlist (which captures URL + email via
// /api/waitlist). To restore real Dodo checkouts, swap these back to:
//   AUTOPILOT: https://checkout.dodopayments.com/buy/pdt_0NdQEw8wrcH0nd5OlZ3IJ?quantity=1
//   CONCIERGE: https://checkout.dodopayments.com/buy/pdt_0NdQEbaRcrAC3qQuCAlnh?quantity=1
const CHECKOUT_AUTOPILOT_URL = "/audit#waitlist";
const CHECKOUT_CONCIERGE_URL = "/audit#waitlist";

const serviceLd = [
  {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "AutoPilot Subscription",
    provider: { "@type": "Organization", name: "Astrant" },
    serviceType: "Agent Engine Optimization",
    areaServed: "Worldwide",
    url: "https://astrant.io/subscriptions",
    offers: {
      "@type": "Offer",
      name: "AutoPilot Subscription",
      url: "https://astrant.io/subscriptions",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: "149",
        priceCurrency: "USD",
        billingDuration: "P1M",
      },
      description:
        "Automated ongoing optimization and the monthly 6-section agent-traffic report.",
    },
  },
  {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "Concierge Subscription",
    provider: { "@type": "Organization", name: "Astrant" },
    serviceType: "Agent Engine Optimization",
    areaServed: "Worldwide",
    url: "https://astrant.io/subscriptions",
    offers: {
      "@type": "Offer",
      name: "Concierge Subscription",
      url: "https://astrant.io/subscriptions",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: "899",
        priceCurrency: "USD",
        billingDuration: "P1M",
      },
      description:
        "Everything in AutoPilot plus content updates, quarterly strategy calls, and competitor tracking.",
    },
  },
];

const FAQS = [
  {
    q: "Do I need to complete Implementation first?",
    a: "No — you can start AutoPilot anytime to get the monthly scan and report. Concierge is strongest if you've done Implementation; otherwise there's less to \"manage.\"",
  },
  {
    q: "Can I upgrade AutoPilot to Concierge mid-month?",
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

const AUTOPILOT_INCLUDES = [
  "Hosted MCP server (uptime, security updates, MCP spec evolution)",
  "Monthly auto-generated 6-section agent-traffic report (PDF)",
  "Monthly auto-rescan of your site against the 6-dimension rubric",
  "Citation monitoring across ChatGPT, Claude, Perplexity, Gemini (read-only dashboard)",
];

const CONCIERGE_EXTRAS = [
  "Content updates as your site evolves (new pricing, new products, new case studies — reflected in the AEO stack)",
  "Quarterly strategy call",
  "Competitor tracking with narrative analysis, not just data",
  "JSON-LD maintenance as schema.org evolves",
  "Priority support (email response within 1 business day)",
];

const EXCLUDED = [
  "New MCP tools or new feature builds (separate Implementation or Custom work)",
  "Major content rewrites (small updates are in scope for Concierge; full rewrites aren't)",
  "Non-AEO SEO work (that's a different business, not ours)",
];

function AutoPilotCta({ label }: { label: string }) {
  return (
    <a
      href={CHECKOUT_AUTOPILOT_URL}
      className="inline-flex rounded-md bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110"
    >
      {label}
    </a>
  );
}

function ConciergeCta({ label }: { label: string }) {
  return (
    <a
      href={CHECKOUT_CONCIERGE_URL}
      className="inline-flex rounded-md border border-[var(--color-accent)] px-6 py-3 text-base font-semibold text-[var(--color-accent)] transition hover:bg-[var(--color-accent)] hover:text-black"
    >
      {label}
    </a>
  );
}

export default function SubscriptionsPage() {
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
          <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
            Subscriptions
          </h1>
          <p className="mt-6 max-w-3xl text-lg text-[var(--color-muted)] sm:text-xl">
            Keep your agent-discoverability stack healthy and measure its impact.
            Two tiers: AutoPilot ($149/month, fully automated) and Concierge
            ($899/month, includes human content updates and strategy calls).
            Month-to-month on both. Cancel anytime.
          </p>
        </section>

        {/* COMPARE TIERS */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Compare tiers
            </h2>
            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              {/* AUTOPILOT CARD */}
              <div className="flex flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-2xl font-semibold">AutoPilot</h3>
                  <span className="text-xl font-bold text-[var(--color-accent)]">
                    $149 / month
                  </span>
                </div>
                <p className="mt-4 text-[var(--color-muted)]">
                  For teams that want the infrastructure running and the monthly
                  numbers, without human overhead.
                </p>
                <ul className="mt-6 flex flex-col gap-3 text-base">
                  {AUTOPILOT_INCLUDES.map((i) => (
                    <li key={i} className="flex gap-3">
                      <span className="mt-1 shrink-0 text-[var(--color-accent)]">
                        ✓
                      </span>
                      <span className="text-[var(--color-muted)]">{i}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-8">
                  <AutoPilotCta label="Notify me when AutoPilot launches" />
                </div>
              </div>

              {/* CONCIERGE CARD */}
              <div className="flex flex-col rounded-lg border border-[var(--color-accent)] bg-[var(--color-surface)] p-6">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-2xl font-semibold">Concierge</h3>
                  <span className="text-xl font-bold text-[var(--color-accent)]">
                    $899 / month
                  </span>
                </div>
                <p className="mt-4 text-[var(--color-muted)]">
                  For teams post-Implementation who want ongoing hands-on
                  optimization. Includes everything in AutoPilot, plus:
                </p>
                <ul className="mt-6 flex flex-col gap-3 text-base">
                  {CONCIERGE_EXTRAS.map((i) => (
                    <li key={i} className="flex gap-3">
                      <span className="mt-1 shrink-0 text-[var(--color-accent)]">
                        ✓
                      </span>
                      <span className="text-[var(--color-muted)]">{i}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-8">
                  <ConciergeCta label="Notify me when Concierge launches" />
                </div>
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
            <p className="mt-6 max-w-3xl text-lg text-[var(--color-muted)]">
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
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6"
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
              <AutoPilotCta label="Notify me when AutoPilot launches" />
              <ConciergeCta label="Notify me when Concierge launches" />
            </div>
            <p className="mt-4 text-sm italic text-[var(--color-muted)]">
              Not sure? Start with AutoPilot and upgrade later — all settings carry
              over.
            </p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
