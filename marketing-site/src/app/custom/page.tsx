import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import TriageForm from "@/components/TriageForm";

export const metadata: Metadata = {
  title: "Custom Implementation — fit check — Astrant",
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
  provider: { "@type": "Organization", name: "Astrant" },
  serviceType: "Agent Engine Optimization",
  areaServed: "Worldwide",
  url: "https://astrant.io/custom",
  offers: {
    "@type": "Offer",
    name: "Custom Implementation",
    price: "4999",
    priceCurrency: "USD",
    url: "https://astrant.io/custom",
    description:
      "Bespoke builds for complex APIs, multi-region content, custom MCP tools. From $4,999 — fixed quote after a $250-deposit scoping call (deposit is credited toward the final quote).",
  },
};

const FAQS = [
  {
    q: "What's the $250 deposit for, and what happens if I don't proceed?",
    a: "It secures your scoping call slot and is credited toward your final fixed quote — not an extra fee. The deposit is non-refundable if you decide not to proceed; that's deliberate, so the 30-minute slots go to prospects ready to commit to exploring the engagement.",
  },
  {
    q: "How quickly will the scoping call be scheduled?",
    a: "Within one business day of the deposit clearing. We send a Cal.com link with available 30-minute slots over the following 3–5 business days. Most prospects book within 24 hours of receiving the link.",
  },
  {
    q: "What happens if my project actually fits Standard Implementation after the scoping call?",
    a: "We tell you, and credit your $250 deposit toward the Standard build instead of Custom. We'd rather lose Custom-tier margin than sell you a build you don't need — the trust is worth more long-term than the spread.",
  },
  {
    q: "Can the fit-check be wrong?",
    a: "It can. Edge cases sometimes route to Standard when they're actually Custom, or to \"not a fit\" when there's a real conversation worth having. If your situation feels different from what the recommendation says, email us — we read every override request, and the form is one input into the decision, not the decision itself.",
  },
  {
    q: "Do you sign NDAs before the scoping call?",
    a: "Yes. We use a standard mutual NDA we can send before the call, or sign yours if you have a preferred template. We regularly work with regulated industries (fintech, healthcare-adjacent) where NDA-first is the default.",
  },
  {
    q: "Can my CTO or security team join the scoping call?",
    a: "Yes, please bring them. Custom calls are often 3–4 people on the customer side (founder, CTO, sometimes security or compliance). 30 minutes works for an initial scoping conversation; for deeper technical reviews we'll schedule a follow-up.",
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
      />
      <SiteHeader />

      <main>
        {/* HERO */}
        <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          {/* Eyebrow — emerald short-pill, parity with the Audit/Implementation
              V2 hero eyebrows (text-sm is the shipped value). */}
          <div className="inline-flex rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-sm font-mono text-emerald-400">
            Custom · from $4,999 · 2–4 weeks
          </div>
          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">
            Agent discoverability,
            <br />
            <span className="text-[var(--color-muted)]">for the hardest problems.</span>
          </h1>
          <p className="mt-6 text-lg text-[var(--color-muted)] sm:text-xl">
            The cases that warrant senior engineering and a proper scope — complex
            APIs, multiple regions, real-time MCP tools, compliance to clear. A
            hands-on engagement, built with your team, under NDA, in 2–4 weeks.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <a
              href="#fit-check"
              className="inline-flex bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110"
            >
              Take the 2-minute fit-check →
            </a>
            {/* Secondary: same-origin launch-notify → /audit#waitlist. Ghost
                style; NO target/rel (same-site link must not open a new tab). */}
            <a
              href="/audit#waitlist"
              className="inline-flex border border-[var(--color-border)] bg-[var(--color-bg)] px-6 py-3 text-base font-semibold text-[var(--color-fg)] transition hover:border-[var(--color-fg)]"
            >
              Notify me when available →
            </a>
          </div>
          <p className="mt-4 text-sm text-[var(--color-muted)]">
            A 2-minute fit-check — a few questions about your APIs, regions,
            timeline, and compliance — points you to Standard Implementation,
            Custom, or a focused scoping call, so we only spend a call on the
            right problem.
          </p>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            The deposit credits toward your fixed quote.
          </p>
          {/* Trust row */}
          <p className="mt-6 font-mono text-xs text-[var(--color-muted)]">
            NDA-first · CTOs welcome (bring security) · Routes to Standard
            Implementation if it fits
          </p>
        </section>

        {/* WHEN STANDARD IS ENOUGH */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              When Standard Implementation is enough
            </h2>
            <p className="mt-6 text-lg text-[var(--color-muted)]">
              If you have a typical B2B SaaS site, our $1,299 Standard
              Implementation covers it: llms.txt, MCP server, OpenAPI spec,
              JSON-LD schema, baseline monitoring — emailed within 24 hours as a
              Git-applicable patch your developer applies in five minutes. No
              call required, no repo access required from us.
            </p>
          </div>
        </section>

        {/* WHEN CUSTOM */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              When Custom is the right call
            </h2>
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {CUSTOM_TRIGGERS.map((t) => (
                <div
                  key={t}
                  className="border border-[var(--color-border)] bg-[var(--color-surface-2)] p-5 text-base text-[var(--color-fg)]"
                >
                  {t}
                </div>
              ))}
            </div>
            <div className="mt-6 border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6">
              <h3 className="text-base font-semibold text-[var(--color-fg)]">
                Bonus for Custom-tier customers
              </h3>
              <p className="mt-2 text-base text-[var(--color-muted)]">
                If you&apos;d like us to open the PR directly rather than deliver
                a patch file, we can arrange a temporary deploy key or GitHub App
                installation during the scoping call. Most customers prefer the
                patch-file delivery, but the option exists.
              </p>
            </div>
          </div>
        </section>

        {/* TRIAGE FORM */}
        <section
          id="fit-check"
          className="border-t border-[var(--color-border)] scroll-mt-20"
        >
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl">
              2-minute fit check
            </h2>
            <p className="mt-4 max-w-3xl text-lg text-[var(--color-muted)]">
              Tell us what you need. Our triage agent will recommend the right
              tier — instant, no signup required.
            </p>
            <div className="mt-10 max-w-3xl">
              <TriageForm />
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Common questions
            </h2>
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
      </main>

      <SiteFooter />
    </div>
  );
}
