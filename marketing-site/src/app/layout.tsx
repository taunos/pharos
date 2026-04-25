import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pharos — Agent Discoverability, Implemented",
  description:
    "Pharos makes B2B SaaS structurally discoverable and invokable by AI agents. We implement llms.txt, MCP servers, OpenAPI specs, structured capability data, and agent-parsable content — and monitor the results.",
  other: {
    "ai-summary":
      "Pharos is an Agent Discoverability service for B2B SaaS. Automated tiers: Score (free), Audit ($79, instant PDF), Implementation ($1,299, <24h build), Custom (from $5K, bespoke). Retainers at $149/mo (Auto) and $899/mo (Managed). Agent-callable MCP at pharos-mcp.pharos-dev.workers.dev.",
    "service-category":
      "Agent Engine Optimization, AEO, agent discoverability, LLM SEO",
  },
};

const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Pharos",
    url: "https://pharos.dev",
    description:
      "Agent Discoverability as a Service. Pharos makes B2B SaaS businesses structurally findable, invokable, and trustworthy to AI agents.",
    sameAs: [],
  },
  {
    "@context": "https://schema.org",
    "@type": "Service",
    provider: { "@type": "Organization", name: "Pharos" },
    name: "Agent Discoverability Implementation",
    description:
      "Technical implementation of llms.txt, MCP server, OpenAPI specs, structured capability data, and agent-parsable content for B2B SaaS companies. Monthly monitoring of agent-referred traffic and citation visibility.",
    serviceType: "Agent Engine Optimization",
    areaServed: "Worldwide",
    offers: [
      {
        "@type": "Offer",
        name: "Agent Discoverability Score",
        url: "https://pharos.dev/score",
        price: "0",
        priceCurrency: "USD",
        description:
          "Free URL-input scan across 6 dimensions. Public score + emailed gap report + monthly auto-rescan.",
      },
      {
        "@type": "Offer",
        name: "AEO Audit",
        url: "https://pharos.dev/audit",
        price: "79",
        priceCurrency: "USD",
        description:
          "Instant automated audit. Rich PDF with 6-dimension analysis, live citation audit, competitor comparison, and prioritized gap list.",
      },
      {
        "@type": "Offer",
        name: "AEO Implementation",
        url: "https://pharos.dev/implementation",
        price: "1299",
        priceCurrency: "USD",
        description:
          "Automated technical build delivered in under 24 hours. llms.txt, MCP server, OpenAPI, JSON-LD schema, baseline monitoring.",
      },
      {
        "@type": "Offer",
        name: "Custom Implementation",
        url: "https://pharos.dev/custom",
        price: "5000",
        priceCurrency: "USD",
        priceSpecification: {
          "@type": "PriceSpecification",
          price: "5000",
          priceCurrency: "USD",
          valueAddedTaxIncluded: false,
        },
        description:
          "Bespoke builds for complex APIs, multi-region content, custom MCP tools. From $5,000 — fixed quote after scoping call.",
      },
      {
        "@type": "Offer",
        name: "Monthly Retainer — Auto",
        url: "https://pharos.dev/retainer",
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: "149",
          priceCurrency: "USD",
          billingDuration: "P1M",
        },
        description:
          "Automated ongoing optimization and the monthly 6-section agent-traffic report.",
      },
      {
        "@type": "Offer",
        name: "Monthly Retainer — Managed",
        url: "https://pharos.dev/retainer",
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: "899",
          priceCurrency: "USD",
          billingDuration: "P1M",
        },
        description:
          "Everything in Auto plus content updates, quarterly strategy calls, and competitor tracking.",
      },
    ],
  },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
