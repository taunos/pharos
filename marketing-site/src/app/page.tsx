import Link from "next/link";
import ScanForm from "@/components/ScanForm";
import ScorePanel from "@/components/ScorePanel";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import SixDimensions from "@/components/SixDimensions";

const STATS = [
  {
    figure: "6",
    label: <>signals agents read before they&apos;ll recommend you</>,
    sub: <>Miss one and you fall out of the answer entirely.</>,
  },
  {
    figure: "~70%",
    label: <>of AI traffic arrives with no referrer</>,
    sub: (
      <>
        You can&apos;t see the buyers AI sends you &#8212; or the ones it sends
        elsewhere.
      </>
    ),
  },
  {
    figure: "4",
    label: <>AI engines already fielding buying questions in your category</>,
    sub: <>They answer today &#8212; with or without you.</>,
  },
];

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

type BadgeKind = "free" | "instant" | "call";

const CORE_TIERS: Array<{
  name: string;
  price: string;
  body: string;
  href: string;
  badge: string;
  badgeKind: BadgeKind;
}> = [
  {
    name: "Score",
    price: "Free",
    body: "URL-input scan, public grade, emailed gap report.",
    href: "/score",
    badge: "Free",
    badgeKind: "free",
  },
  {
    name: "Audit",
    price: "$79",
    body: "Rich PDF in 60 seconds. Live citation data, competitor comparison.",
    href: "/audit",
    badge: "Instant",
    badgeKind: "instant",
  },
  {
    name: "Implementation",
    price: "$1,299",
    body: "Automated build. Full stack deployed in <24h.",
    href: "/implementation",
    badge: "<24h",
    badgeKind: "instant",
  },
  {
    name: "Custom",
    price: "from $4,999",
    body: "Bespoke builds. Complex APIs, multi-region, custom tools.",
    href: "/custom",
    badge: "Call required",
    badgeKind: "call",
  },
];

const SUBSCRIPTION_TIERS: Array<{
  name: string;
  price: string;
  body: string;
  href: string;
}> = [
  {
    name: "Standard",
    price: "$149/mo",
    body: "Stay visible to ChatGPT, Claude, Perplexity, and Gemini — measured monthly, no infrastructure on your side.",
    href: "/subscriptions",
  },
  {
    name: "Pro",
    price: "$899/mo",
    body: "Standard, faster. Daily citation probes across all four engines for sub-24-hour competitive signal.",
    href: "/subscriptions",
  },
];

const FAQS = [
  {
    q: "What is agent discoverability?",
    a: "When AI agents like ChatGPT, Claude, or Perplexity answer questions on behalf of users, they don't browse like humans do — they fetch structured signals: llms.txt files, MCP servers, OpenAPI specs, JSON-LD schema. If your site doesn't expose these signals correctly, agents can't find you, recommend you, or invoke your services. Agent discoverability is the technical layer that makes a business legible to agents.",
  },
  {
    q: "How is this different from SEO?",
    a: "Traditional SEO optimizes for human search behavior on Google. Agent discoverability optimizes for programmatic consumption by language models — an entirely different surface. Some techniques overlap (clean URLs, structured data), but the core deliverables — llms.txt, MCP servers, agent-parsable content — are AEO-specific. Most SEO agencies don't do this work yet.",
  },
  {
    q: "Do I need a developer to use Astrant?",
    a: "No. The free Score tool and the $79 Audit are entirely self-serve — paste your URL, get results. The $1,299 automated Implementation also doesn't require your developer to write any code; we email a Git-applicable patch file that your developer applies with `git am` in about five minutes and reviews via your normal PR workflow. We never need access to your repo or infrastructure. Only Custom builds (from $4,999) involve back-and-forth with your engineering team.",
  },
  {
    q: "What's the difference between the free Score and the paid Audit?",
    a: "The free Score gives you a public 0–100 grade across multiple dimensions of agent discoverability with summary findings. The $79 Audit goes deeper: live citation audit across the major AI engines, competitor comparison, implementation effort estimates per gap, and a machine-readable JSON export. Audit is delivered in about 60 seconds.",
  },
  {
    q: "Will my customers see anything change on my site?",
    a: "No. All the changes Astrant makes are invisible to human visitors — they live in /llms.txt, /.well-known/ files, JSON-LD schema, and content reformatted for agent parseability. Your existing design, copy, and brand are untouched.",
  },
  {
    q: "How do I know agents are actually using the optimizations?",
    a: "Both subscription tiers include a 6-section monthly report covering MCP invocations, agent-fetched pages, AI-referrer click-throughs, citation share across ChatGPT/Claude/Perplexity/Gemini, and conversion attribution. About 70% of AI-driven traffic doesn't carry a referrer in 2026 — measuring it well requires the layered measurement stack we operate.",
  },
  {
    q: "What if AI search loses momentum and this becomes irrelevant?",
    a: "Possible but unlikely on the 1–3 year horizon — Shopify reports AI-attributed orders grew 11x between Jan 2025 and Mar 2026. Even if growth slows, the AEO infrastructure we install (llms.txt, JSON-LD, MCP) doesn't break or harm your traditional SEO; it's net-positive in any scenario. Nothing we deploy is reversible work.",
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

const AUDIENCES = [
  {
    name: "SaaS companies",
    body: "SaaS companies that want to show up when ChatGPT, Claude, and Perplexity answer questions in their category. You know the problem isn't content — it's the technical layer underneath. We build it.",
  },
  {
    name: "Marketing & SEO agencies",
    body: "Marketing and SEO agencies whose clients are asking about AI search. White-label our methodology: you bring the relationship, we bring the technical delivery. Same infrastructure, your brand.",
  },
];

function Badge({ kind, label }: { kind: BadgeKind; label: string }) {
  const cls =
    kind === "call"
      ? "border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-muted)]"
      : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
  return (
    // Logo + Foundation slice: rounded-full retained — small badge pill is the
    // shape token for status chips; not a card. Will revisit per page slice.
    <span
      className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-mono ${cls}`}
    >
      {label}
    </span>
  );
}

function CoreCard({ tier }: { tier: (typeof CORE_TIERS)[number] }) {
  return (
    // Logo + Foundation slice: card border-hover demoted from --color-accent
    // (decision 5) to --color-fg; rounded-lg stripped per radius-free aesthetic.
    <Link
      href={tier.href}
      className="group flex flex-col border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6 transition hover:border-[var(--color-fg)] hover:shadow-lg hover:shadow-black/30"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-xl font-semibold">{tier.name}</h3>
        <Badge kind={tier.badgeKind} label={tier.badge} />
      </div>
      {/* Logo + Foundation slice: price color demoted accent → fg (already bold). */}
      <div className="mt-2 text-2xl font-bold text-[var(--color-fg)]">
        {tier.price}
      </div>
      <p className="mt-4 text-[var(--color-muted)]">{tier.body}</p>
      {/* Logo + Foundation slice: "Learn more" affordance demoted accent → muted. */}
      <div className="mt-6 flex justify-end text-sm font-medium text-[var(--color-muted)] opacity-80 transition group-hover:opacity-100 group-hover:text-[var(--color-fg)]">
        Learn more →
      </div>
    </Link>
  );
}

function SubscriptionCard({ tier }: { tier: (typeof SUBSCRIPTION_TIERS)[number] }) {
  return (
    // Logo + Foundation slice: same demotions as CoreCard. Radius stripped.
    <Link
      href={tier.href}
      className="group flex flex-col border border-[var(--color-border)] bg-[var(--color-surface-2)]/60 p-5 transition hover:border-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold">{tier.name}</h3>
        <span className="text-sm font-bold text-[var(--color-fg)]">
          {tier.price}
        </span>
      </div>
      <p className="mt-2 text-sm text-[var(--color-muted)]">{tier.body}</p>
      <div className="mt-3 flex justify-end text-xs font-medium text-[var(--color-muted)] opacity-70 transition group-hover:opacity-100 group-hover:text-[var(--color-fg)]">
        Learn more →
      </div>
    </Link>
  );
}

export default function Page() {
  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
      />
      <SiteHeader />

      <main>
        <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-start lg:gap-20">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
                Free · No signup
              </p>
              <h1 className="mt-5 text-5xl font-bold tracking-tight sm:text-7xl">
                Is your site findable by AI agents?
              </h1>
              <p className="mt-6 text-lg text-[var(--color-muted)] sm:text-xl">
                Astrant makes businesses structurally discoverable and invokable by
                ChatGPT, Claude, Perplexity, and every agent built on MCP. We implement
                the technical layer — llms.txt, MCP server, structured capability data,
                agent-parsable content — and monitor the results.
              </p>
              <div className="mt-10">
                <ScanForm variant="hero" />
              </div>
              <p className="mt-4 font-mono text-xs uppercase tracking-wider text-[var(--color-muted)]">
                No signup · Public result · MCP-callable
              </p>
            </div>

            <aside>
              <div className="border border-[var(--color-border)] bg-[var(--color-surface-2)] p-5">
                <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
                  Sample · astrant.io self-scan
                </p>
                <div className="mt-5">
                  <ScorePanel
                    compact
                    dim6="auditNote"
                    composite={SAMPLE_SCAN.composite}
                    dimensions={SAMPLE_SCAN.dimensions}
                  />
                </div>
              </div>
            </aside>
          </div>

          <div className="mt-20">
            <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-accent)]">
              The shift already happened
            </p>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              Agents are already recommending vendors in your category.{" "}
              <span className="text-[var(--color-muted)]">
                The only question is whether yours is one of them.
              </span>
            </h2>
          </div>

          <div className="mt-10 grid border-y border-[var(--color-rule)] sm:grid-cols-3">
            {STATS.map((s) => (
              <div
                key={s.figure}
                className="border-b border-[var(--color-rule)] py-8 sm:border-b-0 sm:border-r sm:px-8 sm:py-10 first:sm:pl-0 last:sm:border-r-0 last:sm:pr-0"
              >
                <div className="text-5xl font-bold tracking-tight text-[var(--color-fg)] sm:text-6xl">
                  {s.figure}
                </div>
                <p className="mt-4 text-sm font-medium text-[var(--color-fg)]">
                  {s.label}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
                  {s.sub}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* SECTION 1 — shift is happening */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Half of B2B buyers now start research in AI chatbots
            </h2>
            <p className="mt-10 text-lg text-[var(--color-muted)]">
              The agentic discovery shift is well underway. Most sites aren&apos;t
              structured to be found, understood, or invoked by agents. SEO agencies
              are rebadging old content playbooks. The technical layer is missing —
              and that&apos;s what we build.
            </p>
          </div>
        </section>

        {/* SECTION 2 — six dimensions */}
        <section
          id="how-it-works"
          className="border-t border-[var(--color-border)] scroll-mt-20"
        >
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Six dimensions of agent discoverability
            </h2>
            <p className="mt-4 text-lg text-[var(--color-muted)]">
              Our Agent Discoverability Score evaluates the full technical stack.
              Each dimension maps to a specific service deliverable.
            </p>
            <div className="mt-10">
              <SixDimensions />
            </div>
          </div>
        </section>

        {/* SECTION 3 — pricing */}
        <section
          id="pricing"
          className="border-t border-[var(--color-border)] scroll-mt-20"
        >
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              From first check to full deployment
            </h2>
            <p className="mt-4 text-lg text-[var(--color-muted)]">
              Free to start, instant delivery on core tiers. Humans only when the
              work genuinely requires it.
            </p>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {CORE_TIERS.map((t) => (
                <CoreCard key={t.name} tier={t} />
              ))}
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {SUBSCRIPTION_TIERS.map((t) => (
                <SubscriptionCard key={t.name} tier={t} />
              ))}
            </div>
          </div>
        </section>

        {/* SECTION 4 — dogfood */}
        <section
          id="dogfood"
          className="border-t border-[var(--color-border)] scroll-mt-20"
        >
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Astrant is its own first reference implementation
            </h2>
            <p className="mt-4 text-lg text-[var(--color-muted)]">
              Every layer we sell is live on our own brand. You can inspect the
              dogfood directly — no login, no sales call.
            </p>
            <ul className="mt-10 flex flex-col gap-4 text-base">
              <li>
                <span className="font-semibold">llms.txt</span> —{" "}
                {/* Logo + Foundation slice: link color demoted accent → fg;
                    underline-on-hover preserved as sole affordance. */}
                <a
                  href="/llms.txt"
                  className="font-mono text-[var(--color-fg)] underline-offset-4 hover:underline"
                >
                  <code>https://this-site/llms.txt</code>
                </a>
              </li>
              <li>
                <span className="font-semibold">MCP Server</span> —{" "}
                <code className="font-mono">
                  {/* Logo + Foundation slice: link demoted accent → fg. */}
                  <a
                    href="https://mcp.astrant.io/mcp"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--color-fg)] underline-offset-4 hover:underline"
                  >
                    https://mcp.astrant.io/mcp
                  </a>
                </code>{" "}
                — six tools, including <code>check_llms_txt</code> you can call
                against any site
              </li>
              <li>
                <span className="font-semibold">Server Card</span> —{" "}
                <code className="font-mono">
                  {/* Logo + Foundation slice: link demoted accent → fg. */}
                  <a
                    href="https://mcp.astrant.io/.well-known/mcp.json"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--color-fg)] underline-offset-4 hover:underline"
                  >
                    https://mcp.astrant.io/.well-known/mcp.json
                  </a>
                </code>{" "}
                — SEP-1960 discovery metadata
              </li>
            </ul>
            <div className="mt-12 border-l-4 border-[var(--color-accent)] pl-6 py-4">
              <div className="text-xs font-mono uppercase tracking-wider text-[var(--color-muted)]">
                MEASUREMENT LAYER
              </div>
              <blockquote
                cite="https://www.astrant.io/methodology"
                className="mt-2 text-lg leading-relaxed"
              >
                Astrant has validated its citation-confabulation methodology across structurally distinct brand profiles — producing the strongest level of agreement among independent AI judge models.
              </blockquote>
              <div className="mt-2 text-sm font-mono text-[var(--color-muted)]">
                Engine version dim6:v3
              </div>
              <a
                href="/methodology"
                className="mt-3 inline-block text-[var(--color-accent)] underline-offset-4 hover:underline"
              >
                Inspect the methodology →
              </a>
            </div>
            <p className="mt-8 text-sm italic text-[var(--color-muted)]">
              The free Score tool is live — try it above. Astrant&apos;s own audit
              score will render here once dogfood self-display ships.
            </p>
          </div>
        </section>

        {/* SECTION 5 — who it's for */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Built for
            </h2>
            <div className="mt-10 grid gap-6 sm:grid-cols-2">
              {AUDIENCES.map((a) => (
                <div
                  key={a.name}
                  className="border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6"
                >
                  <h3 className="text-xl font-semibold">{a.name}</h3>
                  <p className="mt-4 text-[var(--color-muted)]">{a.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* SECTION 6 — FAQ */}
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

        {/* FINAL CTA */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Ready to see how agent-ready your site is?
            </h2>
            <p className="mt-4 text-lg text-[var(--color-muted)]">
              Free 5-of-6-dimension scan, public composite score on screen, no signup. Optional email for the gap-report PDF and monthly auto-rescan.
            </p>
            <div className="mt-8">
              {/* Bottom CTA links back to the dedicated /score page rather
                  than rendering a second ScanForm — ScanForm uses a unique
                  id="scan-url" that can't appear twice on a single page. */}
              <Link
                href="/score"
                className="inline-flex bg-[var(--color-accent)] px-6 py-3 text-base font-semibold text-black transition hover:brightness-110"
              >
                Run your free score →
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
