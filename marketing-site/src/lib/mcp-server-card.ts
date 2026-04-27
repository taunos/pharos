// SEP-1960 server card published at /.well-known/mcp.json (and the SEP-1649
// alias at /.well-known/mcp/server-card.json). Both routes import this so they
// stay in sync. The tools[] descriptions must mirror the live MCP at
// https://pharos-mcp.pharos-dev.workers.dev/mcp — keep both this file and the
// MCP's own SERVER_CARD constant in F:\pharos\mcp-server\src\index.ts in
// lockstep when adding/removing/renaming tools.

export const SERVER_CARD = {
  $schema: "https://modelcontextprotocol.io/schema/server-card-v1",
  name: "Pharos",
  version: "0.0.1",
  description:
    "Pharos: Agent Discoverability as a Service for B2B SaaS. Tools for AEO posture inspection, capability discovery, and audit booking.",
  vendor: { name: "Pharos", url: "https://pharos-marketing.pharos-dev.workers.dev" },
  transports: [
    { type: "streamable-http", url: "https://pharos-mcp.pharos-dev.workers.dev/mcp" },
  ],
  tools: [
    {
      name: "get_capabilities",
      description:
        "Returns the services Pharos offers — Score (free), Audit ($79), Implementation ($1,299), Custom (from $4,999), AutoPilot Subscription ($149/mo), Concierge Subscription ($899/mo) — as structured data for agents.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_pricing",
      description: "Returns Pharos pricing for each service tier as structured data.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_case_studies",
      description: "Returns Pharos client case studies and reference implementations.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "book_audit",
      description: "Returns a URL where the user can book a paid AEO audit.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "check_llms_txt",
      description:
        "Fetches the /llms.txt file at a given site URL and reports presence, HTTP status, first H1, blockquote summary, link count, and redirect status. Quick AEO posture check.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", format: "uri", description: "Site URL to check" },
        },
        required: ["url"],
      },
    },
    {
      name: "score_url",
      description:
        "Returns the live Agent Discoverability Score for a given site URL — composite 0–100 score plus per-dimension breakdown across multiple dimensions of agent discoverability.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", format: "uri", description: "Site URL to score" },
        },
        required: ["url"],
      },
    },
  ],
  authentication: { type: "none" },
};
