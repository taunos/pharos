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
    a: "It secures your scoping call slot and is credited toward your final fixed quote — not an extra fee. The deposit is non-refundable if you decide not to proceed, but that's deliberate: it filters for prospects genuinely committed to exploring the engagement, not a profit center on its own. We'd rather have $250 from serious prospects than spend free 30-minute slots on tire-kickers.",
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
          <div className="inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-sm font-mono text-[var(--color-muted)]">
            From $4,999 · 2–4 weeks typical
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
            <div className="mt-6 max-w-3xl rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
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
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6"
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
