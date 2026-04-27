import Link from "next/link";
import WaitlistForm from "@/components/WaitlistForm";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import SixDimensions from "@/components/SixDimensions";

const STATS = [
  { figure: "527%", label: "YoY growth in AI-sourced sessions" },
  {
    figure: "~70%",
    label: "of AI traffic arrives with no referrer (invisible in GA4)",
  },
  { figure: "50%", label: "of B2B buyers begin research in AI, not search" },
];

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
    name: "AutoPilot",
    price: "$149/mo",
    body: "Monthly scan, auto report, MCP uptime.",
    href: "/subscriptions",
  },
  {
    name: "Concierge",
    price: "$899/mo",
    body: "AutoPilot + content updates + strategy calls.",
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
    q: "Do I need a developer to use Pharos?",
    a: "No. The free Score tool and the $79 Audit are entirely self-serve — paste your URL, get results. The $1,299 automated Implementation also doesn't require your developer to write any code; we email a Git-applicable patch file that your developer applies with `git am` in about five minutes and reviews via your normal PR workflow. We never need access to your repo or infrastructure. Only Custom builds (from $4,999) involve back-and-forth with your engineering team.",
  },
  {
    q: "What's the difference between the free Score and the paid Audit?",
    a: "The free Score gives you a public 0–100 grade across multiple dimensions of agent discoverability with summary findings. The $79 Audit goes deeper: live citation audit across the major AI engines, competitor comparison, implementation effort estimates per gap, and a machine-readable JSON export. Audit is delivered in about 60 seconds.",
  },
  {
    q: "Will my customers see anything change on my site?",
    a: "No. All the changes Pharos makes are invisible to human visitors — they live in /llms.txt, /.well-known/ files, JSON-LD schema, and content reformatted for agent parseability. Your existing design, copy, and brand are untouched.",
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
    <span
      className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-mono ${cls}`}
    >
      {label}
    </span>
  );
}

function CoreCard({ tier }: { tier: (typeof CORE_TIERS)[number] }) {
  return (
    <Link
      href={tier.href}
      className="group flex flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 transition hover:border-[var(--color-accent)] hover:shadow-lg hover:shadow-black/30"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-xl font-semibold">{tier.name}</h3>
        <Badge kind={tier.badgeKind} label={tier.badge} />
      </div>
      <div className="mt-2 text-2xl font-bold text-[var(--color-accent)]">
        {tier.price}
      </div>
      <p className="mt-4 text-[var(--color-muted)]">{tier.body}</p>
      <div className="mt-6 flex justify-end text-sm font-medium text-[var(--color-accent)] opacity-80 transition group-hover:opacity-100">
        Learn more →
      </div>
    </Link>
  );
}

function SubscriptionCard({ tier }: { tier: (typeof SUBSCRIPTION_TIERS)[number] }) {
  return (
    <Link
      href={tier.href}
      className="group flex flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/60 p-5 transition hover:border-[var(--color-accent)] hover:bg-[var(--color-surface)]"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold">{tier.name}</h3>
        <span className="text-sm font-bold text-[var(--color-accent)]">
          {tier.price}
        </span>
      </div>
      <p className="mt-2 text-sm text-[var(--color-muted)]">{tier.body}</p>
      <div className="mt-3 flex justify-end text-xs font-medium text-[var(--color-accent)] opacity-70 transition group-hover:opacity-100">
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
        {/* HERO */}
        <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
            Is your site findable by AI agents?
          </h1>
          <p className="mt-6 max-w-3xl text-lg text-[var(--color-muted)] sm:text-xl">
            Pharos makes businesses structurally discoverable and invokable by
            ChatGPT, Claude, Perplexity, and every agent built on MCP. We implement
            the technical layer — llms.txt, MCP server, structured capability data,
            agent-parsable content — and monitor the results.
          </p>
          <div className="mt-10">
            <WaitlistForm idPrefix="hero" />
          </div>
        </section>

        {/* SECTION 1 — shift is happening */}
        <section className="border-t border-[var(--color-border)]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Half of B2B buyers now start research in AI chatbots
            </h2>
            <div className="mt-10 grid gap-6 sm:grid-cols-3">
              {STATS.map((s) => (
                <div
                  key={s.figure}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6"
                >
                  <div className="text-4xl font-bold text-[var(--color-accent)]">
                    {s.figure}
                  </div>
                  <p className="mt-3 text-[var(--color-muted)]">{s.label}</p>
                </div>
              ))}
            </div>
            <p className="mt-10 max-w-3xl text-lg text-[var(--color-muted)]">
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
            <p className="mt-4 max-w-3xl text-lg text-[var(--color-muted)]">
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
            <p className="mt-4 max-w-3xl text-lg text-[var(--color-muted)]">
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
              Pharos is its own first reference implementation
            </h2>
            <p className="mt-4 max-w-3xl text-lg text-[var(--color-muted)]">
              Every layer we sell is live on our own brand. You can inspect the
              dogfood directly — no login, no sales call.
            </p>
            <ul className="mt-10 flex flex-col gap-4 text-base">
              <li>
                <span className="font-semibold">llms.txt</span> —{" "}
                <a
                  href="/llms.txt"
                  className="font-mono text-[var(--color-accent)] underline-offset-4 hover:underline"
                >
                  <code>https://this-site/llms.txt</code>
                </a>
              </li>
              <li>
                <span className="font-semibold">MCP Server</span> —{" "}
                <code className="font-mono">
                  <a
                    href="https://pharos-mcp.pharos-dev.workers.dev/mcp"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--color-accent)] underline-offset-4 hover:underline"
                  >
                    https://pharos-mcp.pharos-dev.workers.dev/mcp
                  </a>
                </code>{" "}
                — six tools, including <code>check_llms_txt</code> you can call
                against any site
              </li>
              <li>
                <span className="font-semibold">Server Card</span> —{" "}
                <code className="font-mono">
                  <a
                    href="https://pharos-mcp.pharos-dev.workers.dev/.well-known/mcp.json"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--color-accent)] underline-offset-4 hover:underline"
                  >
                    https://pharos-mcp.pharos-dev.workers.dev/.well-known/mcp.json
                  </a>
                </code>{" "}
                — SEP-1960 discovery metadata
              </li>
            </ul>
            <p className="mt-8 text-sm italic text-[var(--color-muted)]">
              When the Score tool goes live, this page will self-report its own
              score here.
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
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6"
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
              Ready to see how agent-ready your site is?
            </h2>
            <div className="mt-10">
              <WaitlistForm idPrefix="cta" />
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
