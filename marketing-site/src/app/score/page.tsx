import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import SixDimensions from "@/components/SixDimensions";
import ScanForm from "@/components/ScanForm";

export const metadata: Metadata = {
  title: "Agent Discoverability Score — Pharos",
  description:
    "A live URL-input scan across the dimensions of agent discoverability. Free, public score on screen, no signup. Slice 1 covers 3 of 6 dimensions; remaining ship soon.",
  alternates: {
    types: { "text/markdown": "/score.md" },
  },
};

const serviceLd = {
  "@context": "https://schema.org",
  "@type": "Service",
  name: "Agent Discoverability Score",
  provider: { "@type": "Organization", name: "Pharos" },
  serviceType: "Agent Engine Optimization",
  areaServed: "Worldwide",
  url: "https://pharos.dev/score",
  offers: {
    "@type": "Offer",
    name: "Agent Discoverability Score",
    price: "0",
    priceCurrency: "USD",
    url: "https://pharos.dev/score",
    description:
      "Free URL-input scan across 6 dimensions with public score and emailed gap report.",
  },
};

const FAQS = [
  {
    q: "What's the difference between Score and Audit?",
    a: "The free Score gives you a public grade across the dimensions we currently cover. The $79 Audit adds live citation audit across major AI engines, competitor comparison, implementation estimates, and a JSON export for programmatic use. If you just want to know where you stand, use the Score. If you want a prioritized action plan, use the Audit.",
  },
  {
    q: "Why does it say \"3 of 6 dimensions\"?",
    a: "Slice 1 ships the three dimensions that need no external API access: llms.txt Quality, MCP Server Discoverability, and Structured Capability Data. Dimensions 3 (OpenAPI), 5 (Agent-Parsable Content), and 6 (Citation Visibility) ship in upcoming releases. Your score is computed on what's currently scored — when more dimensions ship, your scan will rerun automatically if you opted into the monthly rescan.",
  },
  {
    q: "Will you charge for the Score later?",
    a: "No. The Score stays free. The paid tiers (Audit, Implementation, Custom, Retainer) go deeper.",
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

const DIFFERENTIATORS = [
  {
    name: "Quality rubrics, not pass/fail",
    body: "Our llms.txt check doesn't just verify the file exists; it scores curation quality, blockquote elevator-pitch, and whether the linked pages return good markdown. Same depth on every other dimension.",
  },
  {
    name: "Predicted referral lift per gap",
    body: "Each gap is annotated with an estimated impact on agent-attributed traffic. You fix what moves the needle first, not what's easy to check off.",
  },
  {
    name: "Live citation audit",
    body: "We query ChatGPT, Claude, Perplexity, and Gemini for prompts in your category and report your current citation share against competitors. Cloudflare can't see inside those engines. We can.",
  },
];

export default function ScorePage() {
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
            Free
          </div>
          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">
            Agent Discoverability Score
          </h1>
          <p className="mt-6 max-w-3xl text-lg text-[var(--color-muted)] sm:text-xl">
            Live URL-input scan across the technical dimensions of agent
            discoverability. Public score on screen — no signup. Slice 1 covers
            3 of 6 dimensions today (llms.txt, MCP, Structured Data); the
            remaining three ship in upcoming releases.
          </p>
          <div className="mt-10">
            <ScanForm />
          </div>
          <p className="mt-6 max-w-2xl text-sm italic text-[var(--color-muted)]">
            Want the deeper analysis now? The $79 Audit delivers a full report
            with live citation data in 60 seconds.{" "}
            <Link
              href="/audit"
              className="not-italic text-[var(--color-accent)] underline-offset-4 hover:underline"
            >
              Run your audit →
            </Link>
          </p>
        </section>

        {/* WHAT WE SCORE */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              The six dimensions
            </h2>
            <p className="mt-4 max-w-3xl text-lg text-[var(--color-muted)]">
              Each dimension maps to a specific piece of technical infrastructure.
              The score tells you where you stand; the gap report tells you exactly
              what to fix.
            </p>
            <div className="mt-10">
              <SixDimensions />
            </div>
          </div>
        </section>

        {/* DIFFERENTIATORS */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Why this, not the free Cloudflare tool?
            </h2>
            <p className="mt-4 max-w-3xl text-lg text-[var(--color-muted)]">
              Cloudflare shipped a free Agent Readiness Score tool in 2026 that does
              pass/fail checks across five categories. It&apos;s a good free check.
              We go deeper in three places:
            </p>
            <div className="mt-10 grid gap-6 lg:grid-cols-3">
              {DIFFERENTIATORS.map((d) => (
                <div
                  key={d.name}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6"
                >
                  <h3 className="text-lg font-semibold">{d.name}</h3>
                  <p className="mt-3 text-[var(--color-muted)]">{d.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* BUILT IN THE OPEN */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Built the way we build for clients
            </h2>
            <p className="mt-4 max-w-3xl text-lg text-[var(--color-muted)]">
              The scanner runs on Cloudflare Workers. Citation audits go through
              Profound&apos;s enterprise API. Everything is MCP-callable — agents
              can invoke the scanner against any URL programmatically, the same way
              our clients&apos; MCPs are invoked. When the score ships, we&apos;ll
              score ourselves first and publish the result here.
            </p>
            <p className="mt-6 text-base">
              See our MCP server →{" "}
              <a
                href="https://pharos-mcp.pharos-dev.workers.dev/mcp"
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[var(--color-accent)] underline-offset-4 hover:underline"
              >
                https://pharos-mcp.pharos-dev.workers.dev/mcp
              </a>
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
              Want a deeper read?
            </h2>
            <p className="mt-4 max-w-3xl text-lg text-[var(--color-muted)]">
              The free Score tells you where you stand. The $79 Audit gives you a
              prioritized action plan with live citation data and competitor
              comparison — delivered as a PDF in 60 seconds.
            </p>
            <div className="mt-8">
              <Link
                href="/audit"
                className="inline-flex rounded-md bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110"
              >
                Run your audit →
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
