const DIMENSIONS = [
  {
    name: "llms.txt Quality",
    weight: "15%",
    description:
      "Machine-readable sitemap telling agents what your site offers, and where.",
  },
  {
    name: "MCP Server Discoverability",
    weight: "20%",
    description:
      "Your agent-invocable endpoint, discoverable via .well-known/mcp.json.",
  },
  {
    name: "OpenAPI / API Catalog",
    weight: "10%",
    description: "Structured API description for service-based businesses. Auto-marked N/A on content-only sites.",
  },
  {
    name: "Structured Capability Data",
    weight: "20%",
    description: "JSON-LD schema: Organization, Service, Offer, FAQPage.",
  },
  {
    name: "Agent-Parsable Content",
    weight: "15%",
    description:
      "Pages that render cleanly without JavaScript; pricing in text, not images.",
  },
  {
    name: "Citation Visibility & Monitoring",
    weight: "20%",
    description:
      "Live audit of where you're cited across ChatGPT, Claude, Perplexity, Gemini.",
  },
];

export default function SixDimensions() {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {DIMENSIONS.map((d) => (
        // Logo + Foundation slice: rounded-lg stripped; weight chip color
        // demoted accent → fg (the mono pairs the weight number with the
        // dimension name; bold text-fg is sufficient hierarchy).
        <div
          key={d.name}
          className="border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-lg font-semibold">{d.name}</h3>
            <span className="text-sm font-mono text-[var(--color-fg)]">
              {d.weight}
            </span>
          </div>
          <p className="mt-3 text-[var(--color-muted)]">{d.description}</p>
        </div>
      ))}
    </div>
  );
}
