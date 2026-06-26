import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import AuditCheckoutForm from "@/components/AuditCheckoutForm";
import AuditSamplePanel from "@/components/AuditSamplePanel";

export const metadata: Metadata = {
  title: "AEO Audit — $79 instant delivery — Astrant",
  description:
    "Pay $79, paste your URL, get a rich PDF in about 60 seconds. Six-dimension deep analysis with developer-ready remediation guidance for each gap, plus a machine-readable JSON export.",
  alternates: {
    types: { "text/markdown": "/audit.md" },
  },
};

const serviceLd = {
  "@context": "https://schema.org",
  "@type": "Service",
  name: "AEO Audit",
  provider: { "@type": "Organization", name: "Astrant" },
  serviceType: "Agent Engine Optimization",
  areaServed: "Worldwide",
  url: "https://astrant.io/audit",
  offers: {
    "@type": "Offer",
    name: "AEO Audit",
    price: "79",
    priceCurrency: "USD",
    url: "https://astrant.io/audit",
    description:
      "Instant automated audit. Rich PDF with 6-dimension analysis and developer-ready remediation guidance for each gap, plus machine-readable JSON export. Includes a one-time Citation Visibility snapshot across ChatGPT, Claude, Perplexity, and Gemini. Ongoing citation tracking over time and competitor comparison are coming in a future iteration.",
  },
};

const FAQS = [
  {
    q: "Do I need to give you access to my site?",
    a: "No. The audit is read-only. Just the URL.",
  },
  {
    q: "How is this instant if the report is that deep?",
    a: "LLM inference does the analysis and remediation drafting; nothing is human-gated. PDF rendering takes a few extra seconds; the whole pipeline finishes in about 60 seconds end-to-end.",
  },
  {
    q: "Can I audit a competitor instead?",
    a: "Yes. Paste any URL you have a legitimate interest in analyzing.",
  },
  {
    q: "Is ongoing citation tracking and competitor comparison in here yet?",
    a: "The Audit includes a one-time Citation Visibility snapshot — whether ChatGPT, Claude, Perplexity, and Gemini cite you right now — as one of its six dimensions. What's not in v0: ongoing citation tracking over time (that's the monitoring subscription) and side-by-side competitor comparison. We'd rather under-promise and over-deliver than ship a hollow report.",
  },
  {
    q: "What if the report is wrong?",
    a: "Full refund, no questions, first 30 days. We'd rather have the feedback than the $79.",
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

const INCLUDES = [
  "Every gap explained in plain language — what it is and why it costs you agent visibility",
  "An effort estimate on every fix, so you can hand it straight to a developer",
  "A composite score + grade you can share with stakeholders",
  "A machine-readable JSON export — for agents or programmatic workflows",
];

const STEPS = [
  {
    title: "Submit URL + email",
    body: "Two fields, one form. We use the email to send your audit if you ever lose the bookmark.",
  },
  {
    title: "Pay",
    body: "Dodo Payments handles USD billing and tax as Merchant of Record. Delivery triggers the moment payment confirms.",
  },
  {
    title: "Get your report",
    body: "We redirect you to a results page that polls until your PDF is ready — usually about 60 seconds. JSON export available alongside the PDF.",
  },
];

export default function AuditPage() {
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
        {/* HERO — split: pitch + waitlist-gated form left | sample report right */}
        <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-start lg:gap-16">
            <div>
              <div className="inline-flex rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-sm font-mono text-emerald-400">
                $79 · instant delivery
              </div>
              <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">
                Find out why AI isn&apos;t recommending you yet.
              </h1>
              <p className="mt-6 text-lg text-[var(--color-muted)] sm:text-xl">
                When someone asks ChatGPT, Claude, or Perplexity for a tool like
                yours and your name never comes up, the Audit tells you why. A
                deep six-dimension read of what agents can and can&apos;t parse
                on your site, with a specific, developer-ready fix for every gap
                &#8212; delivered as a PDF in about 60 seconds. No call required.
              </p>
              {/* Form rendered UNCHANGED inside the layout wrapper — zero-touch
                  (no props, component not edited); w-full fills the column. */}
              <div className="mt-10">
                <AuditCheckoutForm />
              </div>
              <p className="mt-4 font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
                30-day refund · No call · No login
              </p>
            </div>

            <aside>
              <AuditSamplePanel />
            </aside>
          </div>
        </section>

        {/* WHAT'S INCLUDED */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              The full analysis includes
            </h2>
            <ul className="mt-10 flex flex-col gap-4 text-lg">
              {INCLUDES.map((i) => (
                // Logo + Foundation slice: checkmark color demoted accent → muted.
                <li key={i} className="flex gap-4">
                  <span className="mt-1 shrink-0 text-[var(--color-muted)]">
                    ✓
                  </span>
                  <span className="text-[var(--color-muted)]">{i}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm italic text-[var(--color-muted)]">
              Coming in a future iteration: ongoing citation tracking over time
              (the monitoring subscription) and side-by-side competitor
              visibility comparison. The Audit already includes a one-time
              Citation Visibility snapshot as one of its six dimensions; we&apos;ll
              add the longitudinal and competitor pieces once we can deliver them
              at the same quality bar as the rest of the audit.
            </p>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Three steps
            </h2>
            <ol className="mt-10 grid gap-6 lg:grid-cols-3">
              {STEPS.map((s, i) => (
                // Logo + Foundation slice: rounded-lg stripped; step-number
                // mono caption demoted accent → muted (mono uppercase already
                // sufficient affordance).
                <li
                  key={s.title}
                  className="border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6"
                >
                  <div className="text-sm font-mono text-[var(--color-muted)]">
                    Step {i + 1}
                  </div>
                  <h3 className="mt-2 text-xl font-semibold">{s.title}</h3>
                  <p className="mt-3 text-[var(--color-muted)]">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* WHY NOT FREE SCORE */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              What the Audit adds
            </h2>
            <p className="mt-6 text-lg text-[var(--color-muted)]">
              The free Score gives you a public grade across six dimensions. The
              Audit goes deeper: per-gap remediation guidance written
              specifically for your site&apos;s findings (not generic playbook
              language), effort estimates you can take to a developer, and the
              machine-readable JSON export. If the free score says &ldquo;work
              on Dimension 4,&rdquo; the Audit tells you exactly which
              JSON-LD types to add and on which pages.
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              FAQ
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

        {/* FINAL CTA */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Ready?
            </h2>
            <div className="mt-10">
              <AuditCheckoutForm />
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
