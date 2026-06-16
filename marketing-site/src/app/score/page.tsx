import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ScanForm from "@/components/ScanForm";
import ScorePanel from "@/components/ScorePanel";

export const metadata: Metadata = {
  title: "Astrant Score — Free AI Discoverability Check",
  description:
    "Free Astrant Score: six dimensions of AI-agent discoverability — five scored live, plus a Citation Visibility demo preview. Citation Visibility runs live across 4 AI models with the $79 Audit.",
  alternates: {
    types: { "text/markdown": "/score.md" },
  },
};

const serviceLd = {
  "@context": "https://schema.org",
  "@type": "Service",
  name: "Astrant Score",
  provider: { "@type": "Organization", name: "Astrant" },
  serviceType: "Agent Engine Optimization",
  areaServed: "Worldwide",
  url: "https://astrant.io/score",
  offers: {
    "@type": "Offer",
    name: "Astrant Score",
    price: "0",
    priceCurrency: "USD",
    url: "https://astrant.io/score",
    description:
      "Free URL-input scan across 6 dimensions with public score and emailed gap report.",
  },
};

const FAQS = [
  {
    q: "What's the difference between Score and Audit?",
    a: "The free Score gives you a public grade across six dimensions. The $79 Audit adds live citation audit across major AI engines, competitor comparison, implementation estimates, and a JSON export for programmatic use. If you just want to know where you stand, use the Score. If you want a prioritized action plan, use the Audit.",
  },
  {
    q: "Does the free Score check Citation Visibility?",
    a: "The free Score includes a static demo preview of Citation Visibility (dimension 6). The live check — your brand probed across 4 AI models — runs with the $79 Audit.",
  },
  {
    q: "What's the free tier vs paid tier difference for Dim 5?",
    a: "Dim 5 (Agent-Parsable Content) checks whether your homepage content is visible without JavaScript. The free Score uses a static fetch — it tells you if the static-only signal is healthy. The $79 Audit additionally runs a real browser render and diffs the two: the diff is what reveals which content (pricing, FAQs, capabilities) requires JS to appear. If your site is static-rendered or SSR'd, the free check is sufficient. If it's a JS-heavy SPA, the Audit's render diff is where the real signal lives.",
  },
  {
    q: "Will you charge for the Score later?",
    a: "No. The Score stays free. The paid tiers (Audit, Implementation, Custom, Standard, Pro) go deeper.",
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

// Six-column dimension strip — codes/weights mirror scanner scoring
// (D1–D6 / 15·20·10·20·15·20).
const DIMENSION_STRIP = [
  { code: "D1", name: "llms.txt Quality", weight: 15 },
  { code: "D2", name: "MCP Server Discoverability", weight: 20 },
  { code: "D3", name: "OpenAPI / API Catalog", weight: 10 },
  { code: "D4", name: "Structured Capability Data", weight: 20 },
  { code: "D5", name: "Agent-Parsable Content", weight: 15 },
  { code: "D6", name: "Citation Visibility", weight: 20 },
];

// Sample · astrant.io self-scan, rendered as a SCORE via ScorePanel (not raw
// JSON). Real V12 astrant.io values (2026-06-16); Dim 6 carries the
// free_tier_dim6_preview sub-check so it renders as a demo-preview row (not a
// 0-bar). SNAPSHOT — refresh these from a live astrant.io scan on redeploy so
// the sample doesn't drift from a visitor's own live result.
const SAMPLE_SCAN = {
  composite: { score: 89, grade: "A-" },
  dimensions: [
    { dimension_id: 1, dimension_name: "llms.txt Quality", score: 93, grade: "A", sub_checks: [] },
    { dimension_id: 2, dimension_name: "MCP Server Discoverability", score: 100, grade: "A", sub_checks: [] },
    { dimension_id: 3, dimension_name: "OpenAPI / API Catalog", score: 0, grade: "F", na: true, sub_checks: [] },
    { dimension_id: 4, dimension_name: "Structured Capability Data", score: 73, grade: "B", sub_checks: [] },
    { dimension_id: 5, dimension_name: "Agent-Parsable Content", score: 93, grade: "A", sub_checks: [] },
    {
      dimension_id: 6,
      dimension_name: "Citation Visibility",
      score: 0,
      grade: "F",
      na: true,
      sub_checks: [
        {
          id: "free_tier_dim6_preview",
          name: "Citation Visibility (free-tier preview)",
          weight: 1,
          score: 0,
          passed: false,
          notes: "",
          na: true,
        },
      ],
    },
  ],
};

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
        {/* HERO — centered single-column entry: copy + width-constrained scan
            form. Scans route to /score/[id] (no inline results). Eyebrow /
            typography / slotting are hot-class. */}
        <section className="mx-auto max-w-3xl px-6 py-20 text-center sm:py-28">
          <div className="inline-flex border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-sm font-mono uppercase tracking-wider text-emerald-400">
            Free · No signup
          </div>
          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">
            Your Astrant Score
          </h1>
          <p className="mt-4 text-lg text-[var(--color-muted)] sm:text-xl">
            An agent-discoverability rating across six dimensions.
          </p>
          <p className="mt-6 text-base text-[var(--color-muted)]">
            A live, public score — no signup. Five dimensions are scored live;
            Citation Visibility (dimension 6) is a static demo preview on the
            free Score, and runs live across 4 AI models with the $79 Audit.
            Content-only sites have OpenAPI auto-marked N/A.
          </p>
          {/* Width-constrained wrapper (NOT a ScanForm edit — ScanForm is
              shared with the homepage, I6). */}
          <div className="mx-auto mt-10 max-w-xl">
            <ScanForm />
          </div>
          <p className="mx-auto mt-6 max-w-xl text-sm italic text-[var(--color-muted)]">
            Want the deeper analysis now? The $79 Audit delivers a full report
            with live citation data in 60 seconds.{" "}
            {/* Logo + Foundation slice: inline upsell link demoted accent → fg;
                underline-on-hover preserved as the affordance. */}
            <Link
              href="/audit"
              className="not-italic text-[var(--color-fg)] underline-offset-4 hover:underline"
            >
              Run your audit →
            </Link>
          </p>
        </section>

        {/* SAMPLE — astrant.io's own self-scan rendered as a score (not JSON).
            The SAMPLE caption is rendered so it never reads as the visitor's
            own live result. */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
              Sample · astrant.io
            </p>
            <div className="mt-8">
              <ScorePanel
                composite={SAMPLE_SCAN.composite}
                dimensions={SAMPLE_SCAN.dimensions}
              />
            </div>
          </div>
        </section>

        {/* AUDIT CTA — directly below the score (sample panel). Routes to
            /audit (503-gated paid checkout); amber retained per decision 5. */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Want a deeper read?
            </h2>
            <p className="mt-4 text-lg text-[var(--color-muted)]">
              The free Score tells you where you stand. The $79 Audit gives you a
              prioritized action plan with live citation data and competitor
              comparison — delivered as a PDF in 60 seconds.
            </p>
            <div className="mt-8">
              <Link
                href="/audit"
                className="inline-flex bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110"
              >
                Run your audit →
              </Link>
            </div>
          </div>
        </section>

        {/* WHAT WE SCORE — six-column dimension strip */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              The six dimensions
            </h2>
            <p className="mt-4 text-lg text-[var(--color-muted)]">
              Each dimension maps to a specific piece of technical infrastructure.
              The score tells you where you stand; the gap report tells you exactly
              what to fix.
            </p>
            <div className="mt-10 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
              {DIMENSION_STRIP.map((d) => (
                <div key={d.code}>
                  <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
                    {d.code} · {d.weight}%
                  </p>
                  <p className="mt-2 text-sm font-semibold leading-tight">
                    {d.name}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* DIFFERENTIATORS */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Why this, not the free Cloudflare tool?
            </h2>
            <p className="mt-4 text-lg text-[var(--color-muted)]">
              Cloudflare shipped a free Agent Readiness Score tool in 2026 that does
              pass/fail checks across five categories. It&apos;s a good free check.
              We go deeper in three places:
            </p>
            <div className="mt-10 grid gap-6 lg:grid-cols-3">
              {DIFFERENTIATORS.map((d) => (
                <div
                  key={d.name}
                  className="border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6"
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
            <p className="mt-4 text-lg text-[var(--color-muted)]">
              The scanner runs on Cloudflare Workers. Citation audits go through
              Profound&apos;s enterprise API. Everything is MCP-callable — agents
              can invoke the scanner against any URL programmatically, the same way
              our clients&apos; MCPs are invoked. The Score is live now — and we
              score ourselves first: astrant.io&apos;s own Astrant Score is the
              sample above.
            </p>
            <p className="mt-6 text-base">
              See our MCP server →{" "}
              {/* Logo + Foundation slice: link demoted accent → fg. */}
              <a
                href="https://mcp.astrant.io/mcp"
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[var(--color-fg)] underline-offset-4 hover:underline"
              >
                https://mcp.astrant.io/mcp
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
