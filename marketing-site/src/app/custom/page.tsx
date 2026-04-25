import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import TriageForm from "@/components/TriageForm";

export const metadata: Metadata = {
  title: "Custom Implementation — fit check — Pharos",
  description:
    "Custom Implementation is for B2B SaaS sites that exceed our standard scope — complex APIs, multi-region content, bespoke MCP tools. Take the 2-minute fit check; an LLM triage agent will recommend Standard, Custom, or a different path.",
  alternates: {
    types: { "text/markdown": "/custom.md" },
  },
};

const serviceLd = {
  "@context": "https://schema.org",
  "@type": "Service",
  name: "Custom Implementation",
  provider: { "@type": "Organization", name: "Pharos" },
  serviceType: "Agent Engine Optimization",
  areaServed: "Worldwide",
  url: "https://pharos.dev/custom",
  offers: {
    "@type": "Offer",
    name: "Custom Implementation",
    price: "5000",
    priceCurrency: "USD",
    url: "https://pharos.dev/custom",
    description:
      "Bespoke builds for complex APIs, multi-region content, custom MCP tools. From $5,000 — fixed quote after a $250-deposit scoping call (deposit is credited toward the final quote).",
  },
};

const CUSTOM_TRIGGERS = [
  "Complex public API (10+ operations) requiring tailored OpenAPI work",
  "Multi-region or multi-language content",
  "Custom MCP tools specific to your business (real-time inventory, booking, etc.)",
  "Major content rewrites (20+ pages)",
  "Multi-stakeholder approvals (legal / ops / IT involvement)",
  "Aggressive deadlines (delivery needed in under 2 weeks)",
];

export default function CustomPage() {
  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceLd) }}
      />
      <SiteHeader />

      <main>
        {/* HERO */}
        <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <div className="inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-sm font-mono text-[var(--color-muted)]">
            From $5,000 · 2–4 weeks typical
          </div>
          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">
            Custom Implementation
          </h1>
          <p className="mt-6 max-w-3xl text-lg text-[var(--color-muted)] sm:text-xl">
            For B2B SaaS sites that exceed our standard Implementation scope —
            complex APIs, multi-region content, bespoke MCP tools, deep content
            rewrites, multi-stakeholder engagements. Most prospects don&apos;t
            actually need this. Take the 2-minute fit check below and we&apos;ll
            route you to the right option.
          </p>
          <div className="mt-8">
            <a
              href="#fit-check"
              className="inline-flex rounded-md bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110"
            >
              Take the fit check ↓
            </a>
          </div>
        </section>

        {/* WHEN STANDARD IS ENOUGH */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              When standard Implementation is enough
            </h2>
            <p className="mt-6 max-w-3xl text-lg text-[var(--color-muted)]">
              If you have a typical B2B SaaS site, our $1,299 Standard
              Implementation covers it: llms.txt, MCP server, OpenAPI spec, JSON-LD
              schema, baseline monitoring — all delivered as a pull request to
              your repo within 24 hours. No call required.
            </p>
          </div>
        </section>

        {/* WHEN CUSTOM */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              When Custom is genuinely needed
            </h2>
            <ul className="mt-10 flex flex-col gap-4 text-lg">
              {CUSTOM_TRIGGERS.map((t) => (
                <li key={t} className="flex gap-4">
                  <span className="mt-1 shrink-0 text-[var(--color-accent)]">✓</span>
                  <span className="text-[var(--color-muted)]">{t}</span>
                </li>
              ))}
            </ul>
            <p className="mt-10 max-w-3xl text-base text-[var(--color-muted)]">
              Booking a Custom scoping call requires a $250 deposit — credited
              toward your final fixed quote, not an extra fee. It&apos;s a
              seriousness filter so we only take calls with prospects committed
              enough to put cash down.
            </p>
          </div>
        </section>

        {/* TRIAGE FORM */}
        <section
          id="fit-check"
          className="border-t border-[var(--color-border)] scroll-mt-20"
        >
          <div className="mx-auto max-w-3xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              2-minute fit check
            </h2>
            <p className="mt-4 text-lg text-[var(--color-muted)]">
              Tell us what you need. Our triage agent (an LLM running on
              Cloudflare Workers AI) will recommend the right tier — instant, no
              signup required.
            </p>
            <div className="mt-10">
              <TriageForm />
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
