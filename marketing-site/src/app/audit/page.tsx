import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "AEO Audit — $79 instant delivery — Pharos",
  description:
    "Pay $79, paste your URL, get a rich PDF in about 60 seconds. Six-dimension deep analysis, live citation audit, competitor comparison, prioritized gaps with lift estimates, and a JSON export.",
  alternates: {
    types: { "text/markdown": "/audit.md" },
  },
};

// TODO(bruno): replace with real Dodo Payments checkout URL before launch.
const CHECKOUT_AUDIT_URL = "https://checkout.dodopayments.com/buy/pdt_0NdQDsS4Shhe1BrDzQDaa?quantity=1";

const serviceLd = {
  "@context": "https://schema.org",
  "@type": "Service",
  name: "AEO Audit",
  provider: { "@type": "Organization", name: "Pharos" },
  serviceType: "Agent Engine Optimization",
  areaServed: "Worldwide",
  url: "https://pharos.dev/audit",
  offers: {
    "@type": "Offer",
    name: "AEO Audit",
    price: "79",
    priceCurrency: "USD",
    url: "https://pharos.dev/audit",
    description:
      "Instant automated audit. Rich PDF with 6-dimension analysis, live citation audit, competitor comparison, and prioritized gap list.",
  },
};

const FAQS = [
  {
    q: "Do I need to give you access to my site?",
    a: "No. The audit is read-only. Just the URL.",
  },
  {
    q: "How is this instant if the report is that deep?",
    a: "LLM inference does the analysis, Profound's API handles the citation audit, and competitor identification is automated. Nothing human-gated.",
  },
  {
    q: "Can I audit a competitor instead?",
    a: "Yes. Paste any URL you have a legitimate interest in analyzing.",
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
  "Six-dimension deep analysis (each gap explained in plain language, scored against our public rubric)",
  "Live citation audit: where your site is cited across ChatGPT, Claude, Perplexity, Gemini, and Google AI Overviews for prompts in your category",
  "Competitor comparison: your citation share versus three inferred competitors",
  "Prioritized recommendations ranked by predicted referral lift per fix",
  "Implementation effort estimates (hours + dollar cost if we did it)",
  "Machine-readable data export (JSON) — for agents or programmatic workflows",
];

const STEPS = [
  {
    title: "Pay",
    body: "Dodo Payments handles USD billing and tax as Merchant of Record. Delivery is triggered immediately on successful payment.",
  },
  {
    title: "Paste your URL",
    body: "One field. No login, no questionnaire, no kickoff call.",
  },
  {
    title: "Get your report",
    body: "Delivered to your email within 60 seconds, along with a JSON export for programmatic use.",
  },
];

function Cta({ label }: { label: string }) {
  return (
    <a
      href={CHECKOUT_AUDIT_URL}
      className="inline-flex rounded-md bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110"
    >
      {label}
    </a>
  );
}

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
        {/* HERO */}
        <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <div className="inline-flex rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-sm font-mono text-emerald-400">
            $79 · instant delivery
          </div>
          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">
            AEO Audit
          </h1>
          <p className="mt-6 max-w-3xl text-lg text-[var(--color-muted)] sm:text-xl">
            Pay, paste your URL, get a rich PDF analysis of your site&apos;s agent
            discoverability in about 60 seconds. Six-dimension deep analysis, live
            citation audit across ChatGPT, Claude, Perplexity, and Gemini, competitor
            comparison, prioritized gap list with predicted referral lift. No call
            required — the scoring engine does all the work.
          </p>
          <div className="mt-10">
            <Cta label="Run your audit" />
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
                <li key={i} className="flex gap-4">
                  <span className="mt-1 shrink-0 text-[var(--color-accent)]">✓</span>
                  <span className="text-[var(--color-muted)]">{i}</span>
                </li>
              ))}
            </ul>
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
                <li
                  key={s.title}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6"
                >
                  <div className="text-sm font-mono text-[var(--color-accent)]">
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
            <p className="mt-6 max-w-3xl text-lg text-[var(--color-muted)]">
              The free Score gives you a public grade across six dimensions. The
              Audit goes deeper: actual competitor comparison against real prompts
              in your category, live citation data from the AI engines themselves,
              implementation estimates you can take to a developer, and the
              machine-readable JSON export. If the free score says &ldquo;work on
              Dimension 4,&rdquo; the Audit tells you exactly which JSON-LD types
              to add, on which pages, and what lift to expect.
            </p>
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
            <div className="mt-10">
              <Cta label="Run your audit now" />
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
