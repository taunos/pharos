import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Astrant — Agent Discoverability, Implemented",
  description:
    "Astrant makes B2B SaaS structurally discoverable and invokable by AI agents. We implement llms.txt, MCP servers, OpenAPI specs, structured capability data, and agent-parsable content — and monitor the results.",
  other: {
    "ai-summary":
      "Astrant is an Agent Discoverability service for B2B SaaS. Automated tiers: Score (free), Audit ($79, instant PDF), Implementation ($1,299, <24h build), Custom (from $4,999, bespoke). Subscriptions at $149/mo (AutoPilot) and $899/mo (Concierge). Agent-callable MCP at mcp.astrant.io.",
    "service-category":
      "Agent Engine Optimization, AEO, agent discoverability, LLM SEO",
  },
};

const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Astrant",
    url: "https://astrant.io",
    logo: "https://astrant.io/brand/astrant-wordmark-dark.svg",
    description:
      "Agent Discoverability as a Service. Astrant makes B2B SaaS businesses structurally findable, invokable, and trustworthy to AI agents.",
    // sameAs PLACEHOLDER — fill in after Phase 4.4 social handle claiming.
    // Expected entries (replace with actual claimed handles):
    //   "https://twitter.com/astrant_io",
    //   "https://github.com/astrant-io",
    //   "https://www.linkedin.com/company/astrant",
    //   "https://bsky.app/profile/astrant.io"
    sameAs: [],
  },
  {
    "@context": "https://schema.org",
    "@type": "Service",
    provider: { "@type": "Organization", name: "Astrant" },
    name: "Agent Discoverability Implementation",
    description:
      "Technical implementation of llms.txt, MCP server, OpenAPI specs, structured capability data, and agent-parsable content for B2B SaaS companies. Monthly monitoring of agent-referred traffic and citation visibility.",
    serviceType: "Agent Engine Optimization",
    areaServed: "Worldwide",
    offers: [
      {
        "@type": "Offer",
        name: "Agent Discoverability Score",
        url: "https://astrant.io/score",
        price: "0",
        priceCurrency: "USD",
        description:
          "Free URL-input scan across 6 dimensions. Public score + emailed gap report + monthly auto-rescan.",
      },
      {
        "@type": "Offer",
        name: "AEO Audit",
        url: "https://astrant.io/audit",
        price: "79",
        priceCurrency: "USD",
        description:
          "Instant automated audit. Rich PDF with 6-dimension analysis and developer-ready remediation guidance for each gap, plus machine-readable JSON export.",
      },
      {
        "@type": "Offer",
        name: "AEO Implementation",
        url: "https://astrant.io/implementation",
        price: "1299",
        priceCurrency: "USD",
        description:
          "Automated technical build delivered in under 24 hours. llms.txt, MCP server, OpenAPI, JSON-LD schema, baseline monitoring.",
      },
      {
        "@type": "Offer",
        name: "Custom Implementation",
        url: "https://astrant.io/custom",
        price: "4999",
        priceCurrency: "USD",
        priceSpecification: {
          "@type": "PriceSpecification",
          price: "4999",
          priceCurrency: "USD",
          valueAddedTaxIncluded: false,
        },
        description:
          "Bespoke builds for complex APIs, multi-region content, custom MCP tools. From $4,999 — fixed quote after scoping call.",
      },
      {
        "@type": "Offer",
        name: "AutoPilot Subscription",
        url: "https://astrant.io/subscriptions",
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
        name: "Concierge Subscription",
        url: "https://astrant.io/subscriptions",
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: "899",
          priceCurrency: "USD",
          billingDuration: "P1M",
        },
        description:
          "Everything in AutoPilot plus content updates, quarterly strategy calls, and competitor tracking.",
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
