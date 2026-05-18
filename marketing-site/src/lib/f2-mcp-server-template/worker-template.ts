// Static TS Worker template — Astrant-authored, security-reviewable, version-locked.
// LLM-generated JSON config substitutes only into `{{...}}` slots; no LLM-emitted code.
//
// What the Worker does:
//   GET  /.well-known/mcp.json  → returns customer MCP discovery card
//   POST /mcp/call              → dispatches to one of 4 static tool responses
//
// All tool responses come from the rendered `{{tool_responses_json}}` block — a
// JSON literal substituted at render-time. No dynamic code paths.

export const WORKER_TEMPLATE = `// Astrant Implementation MCP Server for {{brand_name}}
// Generated at fulfillment time. Deploy via \`npx wrangler deploy\` from this directory.
// Tagline: {{tagline}}

export interface Env {
  // No Astrant bindings; this Worker runs entirely on the customer's CF account.
}

// Static tool responses generated at fulfillment time from the customer's mcp-server-config.
// Editable freely post-deploy in the customer's repo.
const TOOL_RESPONSES = {{tool_responses_json}};

const MCP_DISCOVERY = {
  name: "{{brand_name}}",
  domain: "{{domain}}",
  category: "{{category}}",
  tagline: "{{tagline}}",
  tools: Object.keys(TOOL_RESPONSES).map((name) => ({
    name,
    description: TOOL_RESPONSES[name]?._description ?? "",
  })),
};

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/.well-known/mcp.json") {
      return Response.json(MCP_DISCOVERY, {
        headers: { "cache-control": "public, max-age=300" },
      });
    }

    if (request.method === "POST" && url.pathname === "/mcp/call") {
      let body: { tool?: string };
      try {
        body = (await request.json()) as { tool?: string };
      } catch {
        return new Response("Invalid JSON body", { status: 400 });
      }
      const tool = body.tool ?? "";
      if (!(tool in TOOL_RESPONSES)) {
        return new Response(\`Unknown tool: \${tool}\`, { status: 404 });
      }
      // Strip internal _description meta before returning to caller.
      const { _description: _omit, ...response } = TOOL_RESPONSES[tool] as Record<string, unknown>;
      return Response.json(response);
    }

    return new Response("Not found", { status: 404 });
  },
};
`;
