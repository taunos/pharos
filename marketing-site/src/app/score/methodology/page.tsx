// /score/methodology — Slice 3b Task 18.
//
// Full content for Dim 6 (Citation Visibility). Stub anchors for Dims 1-5
// (filled in subsequent slices — they're load-bearing for trust but no
// regression risk to ship them empty/short here for now).
//
// The Dim 6 section pulls from the SINGLE SOURCE OF TRUTH at
// marketing-site/src/lib/dim6/disclosure.ts (locked decision 10). Don't
// inline-rewrite — change the SOT and the mirror, both surfaces update.

import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { DIM6_DISCLOSURE } from "@/lib/dim6/disclosure";

export const metadata: Metadata = {
  title: "Scoring methodology — Astrant",
  description:
    "How Astrant scores Agent Discoverability across 6 dimensions. Full methodology for Dim 6 (Citation Visibility). Stub anchors for Dims 1-5.",
};

export default function MethodologyPage() {
  // Convert the SOT `long` string (which contains \n\n paragraph breaks) into
  // an array of paragraphs the JSX renderer can map. Keeps the SOT plain-text
  // and avoids any Markdown dependency for this single page.
  const longParagraphs = DIM6_DISCLOSURE.long.split("\n\n");

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-3xl px-6 py-16">
          <p className="text-sm font-mono uppercase tracking-wider text-[var(--color-muted)]">
            Astrant Score · methodology
          </p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">
            How Astrant scores
          </h1>
          <p className="mt-6 text-lg text-[var(--color-muted)]">
            Six dimensions of agent discoverability, weighted per the OQ-04 spec.
            Each dimension is measured by 3-5 sub-checks; sub-checks may be
            marked N/A and dropped from the formula when they don&apos;t apply
            (e.g. no API surface for the OpenAPI dimension on a content-only
            site). The composite is computed across the dimensions that
            actually applied to your site, not the catalog.
          </p>

          <div className="mt-10 border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6">
            <h2 className="text-base font-semibold">Dimension weights</h2>
            <ul className="mt-3 grid gap-1 text-sm font-mono text-[var(--color-muted)]">
              <li><span className="text-[var(--color-fg)]">15</span> · Dim 1 — llms.txt Quality</li>
              <li><span className="text-[var(--color-fg)]">20</span> · Dim 2 — MCP Server Discoverability</li>
              <li><span className="text-[var(--color-fg)]">10</span> · Dim 3 — OpenAPI / API Catalog</li>
              <li><span className="text-[var(--color-fg)]">20</span> · Dim 4 — Structured Capability Data</li>
              <li><span className="text-[var(--color-fg)]">15</span> · Dim 5 — Agent-Parsable Content</li>
              <li><span className="text-[var(--color-fg)]">20</span> · Dim 6 — Citation Visibility</li>
            </ul>
          </div>

          {/* ── Dim 6 — full content ────────────────────────────────────── */}
          <h2
            id="dim-6"
            className="mt-16 scroll-mt-20 text-3xl font-bold tracking-tight"
          >
            Dimension 6 — Citation Visibility
          </h2>
          <p className="mt-2 text-sm text-[var(--color-muted)] italic">
            Weight 20 · Engine v1 · 4 hosted models · ~10 prompts · ~40 cells per audit
          </p>
          <div className="mt-6 flex flex-col gap-5 text-base text-[var(--color-muted)]">
            {longParagraphs.map((p, i) => (
              <p key={i} className={i === 0 ? "text-[var(--color-fg)] text-lg" : undefined}>
                {p}
              </p>
            ))}
          </div>

          <h3 className="mt-12 text-xl font-semibold">Sub-check signatures</h3>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            Dim 6 emits four sub-check signatures in every paid audit. The
            same signatures are emitted under the future Profound-swap path
            — only the corpus row&apos;s <code className="font-mono bg-[var(--color-surface)] px-1">source</code> field changes
            (<code className="font-mono bg-[var(--color-surface)] px-1">diy</code> vs <code className="font-mono bg-[var(--color-surface)] px-1">profound</code>).
          </p>
          <ul className="mt-4 flex flex-col gap-3 text-sm text-[var(--color-muted)]">
            <li>
              <span className="text-[var(--color-fg)] font-semibold">citation_domain_named_rate</span>{" "}
              (weight 40) — what fraction of measurable cells named your domain at all.
            </li>
            <li>
              <span className="text-[var(--color-fg)] font-semibold">citation_url_referenced_rate</span>{" "}
              (weight 30) — what fraction included an actual URL on your host (not just the brand name).
            </li>
            <li>
              <span className="text-[var(--color-fg)] font-semibold">citation_context_relevant_rate</span>{" "}
              (weight 20) — what fraction positioned your domain in the first half of the response (vs a footer-style mention).
            </li>
            <li>
              <span className="text-[var(--color-fg)] font-semibold">citation_no_competitor_first_rate</span>{" "}
              (weight 10) — what fraction avoided naming a competitor BEFORE your domain.
            </li>
          </ul>

          <h3 className="mt-12 text-xl font-semibold">Cell states</h3>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            Each cell is one (model × query) trial. A measurable cell scores
            0–100. An unmeasurable cell is excluded from the score formula
            entirely so a network blip or a safety refusal doesn&apos;t
            penalize you. A truncated cell (response hit max_tokens) is
            included with a flag — the response was valid up to the cap.
          </p>

          <h3 className="mt-12 text-xl font-semibold">Validator-driven trust pattern</h3>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            Every Dim 6 call uses the same six-rung validator-driven trust pattern we use
            on the audit-fulfill remediation generator: deterministic
            generation (temperature 0; seed 42 where the provider supports it
            — OpenAI and Perplexity do, Anthropic and Gemini don&apos;t),
            structural validators, retry-once-with-feedback on validator
            failure, templated fallback to <code className="font-mono bg-[var(--color-surface)] px-1">unmeasurable: true</code>{" "}
            (never a fake 0), 30-day cache, and engine versioning so
            engine-version bumps invalidate stale cells automatically.
          </p>

          <p className="mt-10 text-xs font-mono uppercase tracking-wider text-[var(--color-muted)]">
            {DIM6_DISCLOSURE.engineLine}
          </p>

          {/* ── Dim 1-5 stub anchors ────────────────────────────────────── */}
          <h2 id="dim-1" className="mt-20 scroll-mt-20 text-3xl font-bold tracking-tight">
            Dimension 1 — llms.txt Quality
          </h2>
          <p className="mt-3 text-sm text-[var(--color-muted)] italic">
            Full methodology section coming in a subsequent release. Sub-checks:
            presence, spec compliance, linked-pages quality, curation quality,
            blockquote eval. Weight 15.
          </p>

          <h2 id="dim-2" className="mt-12 scroll-mt-20 text-3xl font-bold tracking-tight">
            Dimension 2 — MCP Server Discoverability
          </h2>
          <p className="mt-3 text-sm text-[var(--color-muted)] italic">
            Full methodology section coming in a subsequent release. Sub-checks:
            well-known card, tool coverage, OAuth metadata, live invocation,
            DNS TXT. Weight 20.
          </p>

          <h2 id="dim-3" className="mt-12 scroll-mt-20 text-3xl font-bold tracking-tight">
            Dimension 3 — OpenAPI / API Catalog
          </h2>
          <p className="mt-3 text-sm text-[var(--color-muted)] italic">
            Full methodology section coming in a subsequent release. Sub-checks:
            discovery, spec validity, info completeness, security schemes,
            operation coverage. Weight 10. Whole-dim N/A on content-only sites.
          </p>

          <h2 id="dim-4" className="mt-12 scroll-mt-20 text-3xl font-bold tracking-tight">
            Dimension 4 — Structured Capability Data
          </h2>
          <p className="mt-3 text-sm text-[var(--color-muted)] italic">
            Full methodology section coming in a subsequent release. Sub-checks:
            JSON-LD presence, Organization, Service/Offer, FAQ, Review schemas.
            Weight 20.
          </p>

          <h2 id="dim-5" className="mt-12 scroll-mt-20 text-3xl font-bold tracking-tight">
            Dimension 5 — Agent-Parsable Content
          </h2>
          <p className="mt-3 text-sm text-[var(--color-muted)] italic">
            Full methodology section coming in a subsequent release. Sub-checks:
            JS-vs-no-JS render diff, page weight + LCP, markdown negotiation,
            pricing text visibility, case-study scannability. Weight 15.
          </p>

          <p className="mt-16 text-sm text-[var(--color-muted)]">
            Questions about methodology?{" "}
            <Link href="/score" className="text-[var(--color-fg)] underline-offset-4 hover:underline">
              Run a free Score
            </Link>{" "}
            on your domain or{" "}
            <Link href="/audit" className="text-[var(--color-fg)] underline-offset-4 hover:underline">
              book the $79 Audit
            </Link>{" "}
            for the full Dim 6 live citation audit.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
