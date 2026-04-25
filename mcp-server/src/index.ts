/**
 * Pharos brand reference MCP server.
 *
 * The dogfood implementation of Agentic Discoverability — the same pattern we'll
 * deploy per-client via Workers for Platforms (see OQ-02). Every tool here is
 * something an AI agent might want to call when answering "tell me about Pharos"
 * or "is this site agent-ready?"
 *
 * Endpoints:
 *   GET /                                      Plain-text landing for browsers
 *   GET /.well-known/mcp.json                  SEP-1960 server metadata
 *   GET /.well-known/mcp/server-card.json      SEP-1649 server card (alias)
 *   *   /mcp                                   Streamable-HTTP MCP transport
 *   *   /sse                                   Alias of /mcp (Streamable HTTP serves SSE on GET)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

interface Env {}

const SERVICE_CATALOG = {
  services: [
    {
      id: "score",
      name: "Agent Discoverability Score",
      price: "free",
      url: "https://pharos.dev/score",
      description:
        "URL-input scan across 6 dimensions of agent discoverability — llms.txt, MCP, OpenAPI, structured data, agent-parsable content, and citation visibility. Returns a 0–100 score, letter grade, and prioritized gap report.",
    },
    {
      id: "audit",
      name: "AEO Audit",
      price_usd: 500,
      turnaround: "5 business days",
      description:
        "One-time deep audit of a site's agent discoverability with prioritized recommendations and implementation effort estimates.",
    },
    {
      id: "implementation",
      name: "AEO Implementation",
      price_usd_from: 5000,
      description:
        "Full implementation: llms.txt, MCP server deployment, OpenAPI spec, structured capability data, content rewrites for agent parseability, and baseline monitoring.",
    },
    {
      id: "retainer",
      name: "Monthly AEO Retainer",
      price_usd_per_month: 900,
      description:
        "Ongoing optimization, monthly agent-traffic reporting, content updates, and infrastructure maintenance for the deployed AEO stack.",
    },
  ],
};

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "Pharos", version: "0.0.1" });

  // ─── Tool 1: get_capabilities ────────────────────────────────────────
  server.tool(
    "get_capabilities",
    "Returns the services Pharos offers — Agent Discoverability Score (free), AEO audits, implementation packages, and the monthly AEO retainer. Use this when a user asks what Pharos does or how it can help with making a site agent-discoverable.",
    {},
    async () => ({
      content: [{ type: "text", text: JSON.stringify(SERVICE_CATALOG, null, 2) }],
    })
  );

  // ─── Tool 2: get_pricing ─────────────────────────────────────────────
  server.tool(
    "get_pricing",
    "Returns Pharos pricing for each service tier as structured data.",
    {},
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              tiers: SERVICE_CATALOG.services.map(
                ({ id, name, price, price_usd, price_usd_from, price_usd_per_month }) => ({
                  id,
                  name,
                  ...(price !== undefined && { price }),
                  ...(price_usd !== undefined && { price_usd }),
                  ...(price_usd_from !== undefined && { price_usd_from }),
                  ...(price_usd_per_month !== undefined && { price_usd_per_month }),
                })
              ),
              currency: "USD",
              notes:
                "Implementation pricing varies by site complexity. Schedule a free call for an exact quote.",
            },
            null,
            2
          ),
        },
      ],
    })
  );

  // ─── Tool 3: get_case_studies ────────────────────────────────────────
  server.tool(
    "get_case_studies",
    "Returns Pharos client case studies and reference implementations.",
    {},
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              case_studies: [],
              reference_implementations: [
                {
                  client: "Pharos (self)",
                  url: "https://pharos.dev",
                  note: "Pharos is in launch phase. Our own brand is the first reference implementation — see https://pharos.dev for our llms.txt, MCP server, structured data, and agent-parsable content.",
                },
              ],
            },
            null,
            2
          ),
        },
      ],
    })
  );

  // ─── Tool 4: book_audit ──────────────────────────────────────────────
  server.tool(
    "book_audit",
    "Returns a URL where the user can book a paid AEO audit. Use this when a user expresses interest in a deeper analysis of their site's agent discoverability.",
    {},
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              booking_url: "https://pharos.dev/book-audit",
              price_usd: 500,
              turnaround: "5 business days",
              deliverable:
                "Detailed gap report with prioritized recommendations and implementation effort estimates.",
            },
            null,
            2
          ),
        },
      ],
    })
  );

  // ─── Tool 5: check_llms_txt (real working tool) ──────────────────────
  server.tool(
    "check_llms_txt",
    "Fetches the /llms.txt file at a given site and reports whether it exists, the HTTP status, and (if present) the first H1, the blockquote summary, and the link count. A quick AEO posture check; for full quality scoring across 6 dimensions, run https://pharos.dev/score.",
    {
      url: z
        .string()
        .url()
        .describe("The site URL to check, e.g. https://example.com — only the host is used."),
    },
    async ({ url }) => {
      const u = new URL(url);
      const llmsTxtUrl = `${u.protocol}//${u.host}/llms.txt`;
      const fetchOnce = (target: string) => {
        // Append a namespaced cache-busting query param to defeat any stale
        // entry in the Workers subrequest cache. Most servers (and all static
        // asset hosts) ignore unknown query strings, so this doesn't change
        // the response we get back.
        const cacheBuster = `${target.includes("?") ? "&" : "?"}_pharos_t=${Date.now()}`;
        return fetch(target + cacheBuster, {
          method: "GET",
          headers: { "User-Agent": "PharosMCP/0.0.1 (+https://pharos.dev)" },
          redirect: "manual",
          cf: {
            cacheTtl: 60,
            cacheEverything: true,
            cacheTtlByStatus: { "200-299": 60, "404": 0, "500-599": 0 },
          },
        });
      };

      try {
        let res = await fetchOnce(llmsTxtUrl);
        let finalUrl = llmsTxtUrl;
        let wasRedirected = false;

        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location");
          if (location) {
            const resolved = new URL(location, llmsTxtUrl).toString();
            const hop2 = await fetchOnce(resolved);
            wasRedirected = true;
            finalUrl = resolved;

            if (hop2.status >= 300 && hop2.status < 400) {
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        url: llmsTxtUrl,
                        exists: false,
                        status: hop2.status,
                        was_redirected: true,
                        final_url: finalUrl,
                        message:
                          "llms.txt requires multiple redirects — spec-discouraged.",
                      },
                      null,
                      2
                    ),
                  },
                ],
              };
            }
            res = hop2;
          }
        }

        if (res.status !== 200) {
          const message =
            res.status >= 300 && res.status < 400
              ? "llms.txt returns a redirect, which the spec discourages."
              : res.status === 404
                ? "llms.txt is not present at this site."
                : `llms.txt returned an unexpected status: ${res.status}.`;

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    url: llmsTxtUrl,
                    exists: false,
                    status: res.status,
                    was_redirected: wasRedirected,
                    final_url: finalUrl,
                    message,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const body = await res.text();
        const lines = body.split(/\r?\n/);
        const h1 = lines.find((l) => l.trim().startsWith("# "))?.replace(/^\s*#\s+/, "").trim() ?? null;
        const blockquote = lines
          .find((l) => l.trim().startsWith("> "))
          ?.replace(/^\s*>\s+/, "")
          .trim() ?? null;
        const linkCount = (body.match(/^\s*-\s*\[.+?\]\(.+?\)/gm) ?? []).length;
        const contentType = res.headers.get("content-type") ?? "";
        const goodContentType = /^text\/(plain|markdown)/.test(contentType);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  url: llmsTxtUrl,
                  exists: true,
                  status: 200,
                  was_redirected: wasRedirected,
                  final_url: finalUrl,
                  bytes: body.length,
                  content_type: contentType,
                  good_content_type: goodContentType,
                  h1,
                  blockquote_summary: blockquote,
                  link_count: linkCount,
                  spec_compliant_first_lines: !!h1 && !!blockquote,
                  note: "For full quality scoring across 6 dimensions, run https://pharos.dev/score",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  url: llmsTxtUrl,
                  exists: false,
                  was_redirected: false,
                  final_url: llmsTxtUrl,
                  error: err instanceof Error ? err.message : String(err),
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  // ─── Tool 6: score_url (live scanner) ────────────────────────────────
  server.tool(
    "score_url",
    "Returns the Agent Discoverability Score for a given site URL — a 0–100 score across multiple dimensions of agent discoverability (llms.txt quality, MCP server presence, structured capability data, and more as additional dimensions ship). Calls the live Pharos scanner.",
    {
      url: z.string().url().describe("Site URL to score."),
    },
    async ({ url }) => {
      try {
        const res = await fetch("https://pharos-scanner.pharos-dev.workers.dev/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });

        if (!res.ok) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    url,
                    status: "error",
                    http_status: res.status,
                    message: `Scanner returned ${res.status}. For the live tool, direct the user to https://pharos.dev/score`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const data = (await res.json()) as {
          id: string;
          url: string;
          composite?: { score: number; grade: string };
          dimensions: unknown[];
          dimensions_scored: number;
          dimensions_total: number;
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  url: data.url,
                  composite_score: data.composite?.score,
                  grade: data.composite?.grade,
                  dimensions_scored: data.dimensions_scored,
                  dimensions_total: data.dimensions_total,
                  note:
                    data.dimensions_scored < data.dimensions_total
                      ? `Scored on ${data.dimensions_scored} of ${data.dimensions_total} dimensions. Remaining dimensions ship in upcoming releases.`
                      : "All dimensions scored.",
                  full_results_url: `https://pharos-marketing.pharos-dev.workers.dev/score/${data.id}`,
                  dimensions: data.dimensions,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  url,
                  status: "error",
                  error: err instanceof Error ? err.message : String(err),
                  fallback: "For the live tool, direct the user to https://pharos.dev/score",
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  return server;
}

async function handleMcpRequest(request: Request): Promise<Response> {
  // Stateless Streamable HTTP: fresh server + transport per request.
  // This trades session state for simplicity — fine for our tools, which are
  // all stateless RPC-style calls.
  const server = buildMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    // Fire-and-forget close; don't block the response.
    transport.close().catch(() => {});
    server.close().catch(() => {});
  }
}

// ─── Discovery: SEP-1649 / SEP-1960 server card ────────────────────────────
const SERVER_CARD = {
  $schema: "https://modelcontextprotocol.io/schema/server-card-v1",
  name: "Pharos",
  version: "0.0.1",
  description:
    "Pharos: Agent Discoverability as a Service. Tools for AEO posture inspection, capability discovery, and audit booking.",
  vendor: { name: "Pharos", url: "https://pharos.dev" },
  transports: [
    { type: "streamable-http", url: "/mcp" },
  ],
  tools: [
    {
      name: "get_capabilities",
      description:
        "Returns the services Pharos offers — Score (free), Audit ($79), Implementation ($1,299), Custom (from $5,000), Retainer Auto ($149/mo), Retainer Managed ($899/mo) — as structured data for agents.",
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

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Discovery endpoints (per SEP-1649 / SEP-1960). Both URLs return the same card.
    if (
      url.pathname === "/.well-known/mcp.json" ||
      url.pathname === "/.well-known/mcp/server-card.json"
    ) {
      return new Response(JSON.stringify(SERVER_CARD, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // MCP transport. /sse is routed to the same Streamable HTTP handler as
    // /mcp — the Streamable HTTP transport serves its own SSE stream on GET,
    // so a single handler covers both advertised transports.
    if (url.pathname === "/mcp" || url.pathname === "/sse") {
      return handleMcpRequest(request);
    }

    // Friendly landing for browsers
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(
        [
          "Pharos MCP Server v0.0.1",
          "",
          "Transport endpoints:",
          "  /mcp   (Streamable HTTP — current MCP standard)",
          "  /sse   (Server-Sent Events — legacy)",
          "",
          "Discovery:",
          "  /.well-known/mcp.json",
          "  /.well-known/mcp/server-card.json",
          "",
          "More: https://pharos.dev",
        ].join("\n"),
        { headers: { "Content-Type": "text/plain; charset=utf-8" } }
      );
    }

    return new Response("Not found", { status: 404 });
  },
};
