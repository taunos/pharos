import type { Metadata } from "next";
import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { ImplementationCheckoutForm } from "@/components/ImplementationCheckoutForm";
import { ImplPatchEvidence } from "@/components/ImplPatchEvidence";

// F2 v6.1 — page renders D1 ceiling state per request (D18 Stage 1 page-CTA gate).
// Force-dynamic ensures the SELECT COUNT(*) check runs on every load, not at build time.
export const dynamic = "force-dynamic";

interface ImplementationPageEnv {
  CITATION_DB: D1Database;
  // B1.3 v1.1 — replaces hardcoded ceiling=3 (default "30").
  MAX_PROBE_TARGETS?: string;
}

export const metadata: Metadata = {
  title: "AEO Implementation — $1,299, delivered in <24h — Astrant",
  description:
    "Automated build pipeline. Pay $1,299, answer 5 scoping questions, and we deploy the full agent-discoverability stack — llms.txt, MCP server, OpenAPI, JSON-LD, baseline monitoring — within 24 hours. For standard B2B SaaS sites.",
  alternates: {
    types: { "text/markdown": "/implementation.md" },
  },
};

// F2 v6.1 D21 — both <Cta> hero + FINAL_CTA buttons now scroll to the
// <ImplementationCheckoutForm> below (id="implementation-checkout"). Page-CTA gate
// is server-side via the form's atCapacity prop derived from D1 ceiling read.
const CHECKOUT_IMPL_ANCHOR = "#implementation-checkout";

function buildServiceLd(atCapacity: boolean) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "AEO Implementation",
    provider: { "@type": "Organization", name: "Astrant" },
    serviceType: "Agent Engine Optimization",
    areaServed: "Worldwide",
    url: "https://astrant.io/implementation",
    offers: {
      "@type": "Offer",
      name: "AEO Implementation",
      price: "1299",
      priceCurrency: "USD",
      url: "https://astrant.io/implementation#implementation-checkout",
      availability: atCapacity
        ? "https://schema.org/SoldOut"
        : "https://schema.org/InStock",
      description:
        "Automated technical build delivered in under 24 hours. llms.txt, MCP server, OpenAPI, JSON-LD schema, baseline monitoring.",
    },
  };
}

const FAQS = [
  {
    q: "What if the automated build doesn't fit my stack?",
    a: "The questionnaire catches common mismatches and steers you to Custom before you pay.",
  },
  {
    q: "Which Git providers do you support?",
    a: "All of them. We deliver a Git-applicable patch file that works for GitHub, GitLab, Bitbucket, Azure DevOps, and self-hosted Git. Your team applies it locally with `git am` and reviews via your normal PR workflow. We never need direct access to your repo.",
  },
  {
    q: "Do you need write access to my repo?",
    a: "No. The patch-file delivery model means we never touch your code directly. Many B2B security teams prefer this — fewer external service accounts with repo access is a security improvement, not a limitation. (If you're on the Custom tier and want us to open the PR for you, that can be arranged during the scoping call with a temporary deploy key.)",
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

const STACK = [
  {
    name: "llms.txt",
    body: "Generated from your sitemap and homepage content. Curated, not dumped. Scored against our own rubric before delivery.",
  },
  {
    name: "MCP Server",
    body: "Hosted at mcp.yourdomain.com (you point the CNAME). Baseline tools: get_capabilities, get_pricing, get_services, book_demo, check_llms_txt, plus anything inferable from your pricing page.",
  },
  {
    name: "OpenAPI spec",
    body: "Generated from your public API if detectable; skipped otherwise.",
  },
  {
    name: "JSON-LD schema",
    body: "Organization, Service, Offer, FAQPage injected into your key pages. Delivered as part of the Git-applicable patch you receive via email — works with any Git provider, no repo access from us required.",
  },
  {
    name: "Baseline monitoring",
    body: "Worker deployed to ingest your site's Cloudflare logs and parse AI user-agents + referrers. Dashboard URL delivered with the build.",
  },
  {
    name: "Handoff documentation",
    body: "README included in the patch, explaining what was built and how to modify it. Lands in your repo when your team applies the patch.",
  },
];

const CUSTOM_TRIGGERS = [
  "Complex public API with dozens of operations requiring tailored OpenAPI work",
  "Multi-region or multi-language content",
  "Bespoke MCP tools beyond the standard set (industry-specific capabilities, deep integrations)",
  "Major content rewrites across 20+ pages",
  "Multi-stakeholder approvals (your ops / legal / IT need a human liaison)",
  "Aggressive timeline constraints",
];

const FLOW = [
  { title: "Pay", body: "$1,299 via Dodo Payments." },
  {
    title: "Short questionnaire",
    body: "Your site URL, what your three most important pages are, what your core service offerings are, and a delivery email for the patch. 5 questions, ~3 minutes. No repo URL needed — we don't touch your code.",
  },
  {
    title: "Pipeline runs",
    body: "Automated build kicks off. You'll get progress updates by email as each stage completes.",
  },
  {
    title: "Delivery",
    body: "Within 24 hours for standard sites. MCP server live, monitoring dashboard URL in your inbox, plus a Git-applicable patch file your developer applies with `git am` in about five minutes. You review the diff in your repo's normal workflow and merge when ready — no access to your repo or infrastructure required from us.",
  },
];

// Implementation V2 (A5) — compact hero process strip; the lower FLOW section
// stays as the detailed version (D11).
const STEPS = [
  { stage: "Pay", detail: "$1,299 via Dodo" },
  { stage: "Questionnaire", detail: "5 questions, ~3 minutes" },
  { stage: "Pipeline", detail: "build runs, email progress" },
  { stage: "Patch", detail: "<24h · git am-applicable file" },
];

// Anchor-link CTA (F2 v6.1) — scrolls to the in-page ImplementationCheckoutForm.
// Replaces the pre-launch waitlist CTA after F2 ships.
function Cta({ label }: { label: string }) {
  return (
    <a
      href={CHECKOUT_IMPL_ANCHOR}
      className="inline-flex bg-[var(--color-accent)] px-8 py-4 text-lg font-semibold text-black transition hover:brightness-110"
    >
      {label}
    </a>
  );
}

function BundleDisclosure() {
  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6">
      <h3 className="text-lg font-semibold">Your $1,299 Implementation includes</h3>
      <ul className="mt-4 flex flex-col gap-2 text-[var(--color-muted)]">
        <li>• A <code>git am</code>-applicable patch with deployable MCP server code, llms.txt, OpenAPI, JSON-LD, and monitoring scripts</li>
        <li>• One-command deploy via <code>npx @astrant/deploy-mcp</code> (shipping shortly)</li>
        <li>• 90 days of citation-tracking probes across 4 major-model providers</li>
        <li>• 3 follow-up audits at Day 30, Day 60, Day 90</li>
        <li>• Standard continuation option at Day 90 ($149/mo) for ongoing measurement</li>
      </ul>
    </div>
  );
}

export default async function ImplementationPage() {
  const env = getCloudflareContext().env as unknown as ImplementationPageEnv;

  // D18 Stage 1 — server-side ceiling check at render-time.
  // B1.3 v1.1 — MAX_PROBE_TARGETS env binding replaces hardcoded 3.
  const maxProbeTargets = parseInt(env.MAX_PROBE_TARGETS ?? "30", 10);
  const ceilingResult = await env.CITATION_DB.prepare(
    `SELECT COUNT(*) AS count FROM customer_probe_targets WHERE status='active'`,
  ).first<{ count: number }>();
  const atCapacity = (ceilingResult?.count ?? 0) >= maxProbeTargets;

  const serviceLd = buildServiceLd(atCapacity);

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
        {/* HERO — Implementation V2 patch-evidence split (D1) */}
        <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            {/* LEFT — pitch + process + checkout CTA */}
            <div className="min-w-0">
              <div className="inline-flex rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-sm font-mono text-emerald-400">
                $1,299 · delivered in &lt;24 hours
              </div>
              <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
                The reason agents don&apos;t mention you is fixable in one merge.
              </h1>
              <p className="mt-6 text-lg text-[var(--color-muted)]">
                The whole agent-discoverability stack as a patch file, reviewed in
                your repo&apos;s normal workflow. No deploy keys, no service
                accounts.
              </p>
              <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {STEPS.map((s) => (
                  <div
                    key={s.stage}
                    className="border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3"
                  >
                    <div className="text-sm font-semibold">{s.stage}</div>
                    <div className="mt-1 text-xs text-[var(--color-muted)]">
                      {s.detail}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-10 flex flex-col items-start gap-4">
                <Cta label="Buy Implementation — $1,299" />
                <Link
                  href="/custom"
                  className="text-sm text-[var(--color-muted)] underline-offset-4 hover:text-[var(--color-fg)] hover:underline"
                >
                  Need something custom? See the Custom tier →
                </Link>
              </div>
            </div>
            {/* RIGHT — labelled representative patch (A1/A2) */}
            <ImplPatchEvidence />
          </div>
        </section>

        {/* STACK */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              The full standard stack
            </h2>
            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              {STACK.map((s) => (
                <div
                  key={s.name}
                  className="border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6"
                >
                  <h3 className="text-lg font-semibold">{s.name}</h3>
                  <p className="mt-3 text-[var(--color-muted)]">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* F2 v6.1 D21 + D22 — bundle disclosure + checkout form (anchor target for hero + FINAL_CTA buttons) */}
        <section
          id="implementation-checkout"
          className="border-t border-[var(--color-border)]"
        >
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              What you&apos;re buying
            </h2>
            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              <BundleDisclosure />
              <ImplementationCheckoutForm atCapacity={atCapacity} />
            </div>
          </div>
        </section>

        {/* WHEN NOT STANDARD */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Go Custom if you need any of these
            </h2>
            <p className="mt-4 max-w-3xl text-lg text-[var(--color-muted)]">
              The $1,299 Implementation tier works for about 80% of B2B SaaS
              sites. Consider Custom if:
            </p>
            <ul className="mt-10 flex flex-col gap-4 text-lg">
              {CUSTOM_TRIGGERS.map((t) => (
                // Logo + Foundation slice: arrow-bullet color demoted accent → muted.
                <li key={t} className="flex gap-4">
                  <span className="mt-1 shrink-0 text-[var(--color-muted)]">→</span>
                  <span className="text-[var(--color-muted)]">{t}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8">
              {/* Logo + Foundation slice: secondary navigation CTA — hover-border
                  demoted accent → fg; radius stripped. */}
              <Link
                href="/custom"
                className="inline-flex border border-[var(--color-border)] bg-[var(--color-surface-2)] px-6 py-3 text-base font-semibold text-[var(--color-fg)] transition hover:border-[var(--color-fg)]"
              >
                See the Custom tier →
              </Link>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              From payment to deployment
            </h2>
            <ol className="mt-10 flex flex-col gap-6">
              {FLOW.map((f, i) => (
                // Logo + Foundation slice: rounded-lg stripped; step caption
                // demoted accent → muted.
                <li
                  key={f.title}
                  className="border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6"
                >
                  <div className="text-sm font-mono text-[var(--color-muted)]">
                    Step {i + 1}
                  </div>
                  <h3 className="mt-2 text-xl font-semibold">{f.title}</h3>
                  <p className="mt-3 text-[var(--color-muted)]">{f.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* OWNERSHIP */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Everything we build, you own
            </h2>
            <p className="mt-6 text-lg text-[var(--color-muted)]">
              No black box. Every artifact lives on your infrastructure. MCP
              server on your Cloudflare account. JSON-LD and content in your
              codebase via the patch your team applied. No dependency on Astrant
              for ongoing operation. You can cancel the subscription, move off our
              monitoring, or take everything in-house at any time.
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
              Ready?
            </h2>
            <div className="mt-10">
              <Cta label="Buy Implementation — $1,299" />
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
