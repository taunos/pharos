import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ScanForm from "@/components/ScanForm";

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

// A5 — labeled self-scan example. Real V12 astrant.io values (2026-06-16),
// abridged display projection; Dim 6 surfaced as a demo-preview marker. Not
// byte-pinned — refresh from a live astrant.io scan at deploy/hot rounds.
const SELF_SCAN_EXAMPLE = `{
  "url": "astrant.io",
  "score": 89,
  "grade": "A-",
  "view": "abridged",
  "dimensions": {
    "llms_txt":   { "score": 93, "weight": 15 },
    "mcp_server": { "score": 100, "weight": 20 },
    "openapi":    { "score": 0, "weight": 10 },
    "jsonld":     { "score": 73, "weight": 20 },
    "parsable":   { "score": 93, "weight": 15 },
    "citation":   { "demo_preview": true, "note": "live with $79 Audit" }
  },
  "next": "Run the $79 Audit for prioritized gaps"
}`;

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
        {/* HERO — two-column intro (copy | self-scan example) ABOVE a
            full-width scan form. ScanForm renders ScanResults inline, so it
            MUST stay full-width — keeping it inside a half-width grid column
            crushes the results grid. Typography / slotting are hot-class. */}
        <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-start lg:gap-16">
            <div>
              <div className="inline-flex border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-sm font-mono uppercase tracking-wider text-emerald-400">
                Free · No signup
              </div>
              <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">
                Your Astrant Score
              </h1>
              <p className="mt-4 text-lg text-[var(--color-muted)] sm:text-xl">
                An agent-discoverability rating across six dimensions.
              </p>
              <p className="mt-6 max-w-xl text-base text-[var(--color-muted)]">
                A live, public score — no signup. Five dimensions are scored
                live; Citation Visibility (dimension 6) is a static demo preview
                on the free Score, and runs live across 4 AI models with the $79
                Audit. Content-only sites have OpenAPI auto-marked N/A.
              </p>
            </div>

            {/* Self-scan code block (A5). min-w-0 lets the <pre> scroll inside
                the column instead of overflowing and clipping the card. */}
            <div className="min-w-0 lg:pt-2">
              <div className="border border-[var(--color-border)] bg-[var(--color-surface-2)]">
                <div className="border-b border-[var(--color-border)] px-4 py-2 text-xs font-mono uppercase tracking-wider text-[var(--color-muted)]">
                  example · astrant.io self-scan
                </div>
                <pre className="overflow-x-auto p-4 text-xs leading-relaxed font-mono text-[var(--color-fg)]">
                  <code>{SELF_SCAN_EXAMPLE}</code>
                </pre>
              </div>
            </div>
          </div>

          {/* Scan form — full width so ScanResults renders full-width. */}
          <div className="mt-12">
            <ScanForm />
          </div>
          <p className="mt-6 max-w-2xl text-sm italic text-[var(--color-muted)]">
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

        {/* WHAT WE SCORE — six-column dimension strip */}
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
            <p className="mt-4 max-w-3xl text-lg text-[var(--color-muted)]">
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
            <p className="mt-4 max-w-3xl text-lg text-[var(--color-muted)]">
              The scanner runs on Cloudflare Workers. Citation audits go through
              Profound&apos;s enterprise API. Everything is MCP-callable — agents
              can invoke the scanner against any URL programmatically, the same way
              our clients&apos; MCPs are invoked. When the score ships, we&apos;ll
              score ourselves first and publish the result here.
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
              {/* Logo + Foundation slice: routes to /audit (503-gated paid
                  checkout). Per decision 5 EXCEPTION amber retained on this
                  CTA. Radius stripped per decision 4. */}
              <Link
                href="/audit"
                className="inline-flex bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110"
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
