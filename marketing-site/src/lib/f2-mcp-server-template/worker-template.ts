// Static TS Worker template — Astrant-authored, security-reviewable, version-locked.
// LLM-generated JSON config substitutes only into `{{...}}` slots; no LLM-emitted code.
// Every slot is either a JSON literal (JSON.stringify at render time) or a
// single-line comment value with line terminators removed (see index.ts).
//
// What the Worker does — an MCP server over the Streamable HTTP transport,
// stateless (no sessions, no server-initiated SSE stream):
//   POST /mcp                   JSON-RPC 2.0: initialize (protocol version
//                               negotiation), ping, tools/list, tools/call;
//                               notifications and client responses get 202
//   GET/DELETE /mcp             405 (no SSE stream, no session to delete)
//   GET  /.well-known/mcp.json  discovery card whose transport points at /mcp
//
// Patterns follow Astrant's own servers: customer-mcp/src/mcp-handler.ts (the
// same 4 tools, hand-rolled JSON-RPC) and mcp-server/src/index.ts (stateless
// Streamable HTTP via the SDK; server card shape). The template stays
// dependency-free so the delivered Worker has no runtime packages.
//
// All tool responses come from the rendered `{{tool_responses_json}}` block — a
// JSON literal substituted at render-time. No dynamic code paths.

export const WORKER_TEMPLATE = `// Astrant Implementation MCP Server for {{brand_name_comment}}
// Generated at fulfillment time. Deploy via \`npx wrangler deploy\` from this directory.
// Tagline: {{tagline_comment}}
//
// MCP server over the Streamable HTTP transport (stateless):
//   POST /mcp                   JSON-RPC 2.0: initialize, ping, tools/list, tools/call
//   GET  /.well-known/mcp.json  discovery card pointing MCP clients at /mcp

export interface Env {
  // No Astrant bindings; this Worker runs entirely on the customer's CF account.
}

// Static tool responses generated at fulfillment time from the customer's mcp-server-config.
// Editable freely post-deploy in the customer's repo. "_description" is the tool
// description shown to MCP clients; it is not part of the tool result.
const TOOL_RESPONSES: Record<string, Record<string, unknown>> = {{tool_responses_json}};

const SERVER_NAME = {{brand_name_js}};
const SERVER_VERSION = "1.0.0";
// Newest first. initialize answers with the client's version when it is listed
// here, otherwise with the newest one (MCP lifecycle: version negotiation).
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_BODY_BYTES = 64 * 1024;

const TOOLS = Object.keys(TOOL_RESPONSES).map((name) => ({
  name,
  description: String(TOOL_RESPONSES[name]._description ?? ""),
  inputSchema: { type: "object", properties: {} },
}));

const MCP_DISCOVERY = {
  name: {{brand_name_js}},
  domain: {{domain_js}},
  category: {{category_js}},
  tagline: {{tagline_js}},
};

function serverCard(origin: string) {
  return {
    $schema: "https://modelcontextprotocol.io/schema/server-card-v1",
    ...MCP_DISCOVERY,
    version: SERVER_VERSION,
    description: MCP_DISCOVERY.tagline,
    transports: [{ type: "streamable-http", url: origin + "/mcp" }],
    tools: TOOLS,
    authentication: { type: "none" },
  };
}

type JsonRpcId = string | number | null;

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function isRequestId(id: unknown): id is string | number {
  return typeof id === "string" || (typeof id === "number" && Number.isFinite(id));
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// One JSON-RPC message in, its response out (null = nothing to send back).
function handleMessage(msg: unknown): Record<string, unknown> | null {
  if (!isObject(msg) || msg.jsonrpc !== "2.0") {
    return rpcError(isObject(msg) && isRequestId(msg.id) ? msg.id : null, -32600, "Invalid Request");
  }
  if (typeof msg.method !== "string") {
    // A response from the client (we never send requests, but accept it quietly).
    if (isRequestId(msg.id) && ("result" in msg || "error" in msg)) return null;
    return rpcError(isRequestId(msg.id) ? msg.id : null, -32600, "Invalid Request");
  }
  // Notification (notifications/initialized, notifications/cancelled, ...): no reply.
  if (!("id" in msg)) return null;
  if (!isRequestId(msg.id)) return rpcError(null, -32600, "Invalid Request");
  const id = msg.id;
  if (msg.params !== undefined && !isObject(msg.params)) return rpcError(id, -32602, "Invalid params");
  const params = (msg.params ?? {}) as Record<string, unknown>;

  switch (msg.method) {
    case "initialize": {
      const requested = params.protocolVersion;
      const protocolVersion =
        typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : SUPPORTED_PROTOCOL_VERSIONS[0];
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const name = params.name;
      if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(TOOL_RESPONSES, name)) {
        return rpcError(id, -32602, "Unknown tool");
      }
      if (params.arguments !== undefined && !isObject(params.arguments)) {
        return rpcError(id, -32602, "Invalid arguments");
      }
      const { _description: _omit, ...data } = TOOL_RESPONSES[name];
      return rpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        isError: false,
      });
    }
    default:
      return rpcError(id, -32601, "Method not found");
  }
}

async function handleMcpPost(request: Request): Promise<Response> {
  const version = request.headers.get("mcp-protocol-version");
  if (version !== null && !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
    return json(rpcError(null, -32000, "Unsupported MCP-Protocol-Version"), 400);
  }
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") {
    return json(rpcError(null, -32000, "Content-Type must be application/json"), 415);
  }
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) {
    return json(rpcError(null, -32000, "Request body too large"), 413);
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return json(rpcError(null, -32000, "Request body too large"), 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 400);
  }
  if (Array.isArray(body)) {
    // JSON-RPC batch (protocol 2025-03-26 clients).
    if (body.length === 0) return json(rpcError(null, -32600, "Invalid Request"), 400);
    const replies = body.map(handleMessage).filter((r) => r !== null);
    return replies.length === 0 ? new Response(null, { status: 202 }) : json(replies);
  }
  const reply = handleMessage(body);
  return reply === null ? new Response(null, { status: 202 }) : json(reply);
}

export default {
  async fetch(request: Request, _env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/.well-known/mcp.json") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
      }
      return Response.json(serverCard(url.origin), {
        headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" },
      });
    }

    if (url.pathname === "/mcp") {
      // Stateless server: no SSE stream to open on GET, no session to DELETE.
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
      }
      return handleMcpPost(request);
    }

    return new Response("Not found", { status: 404 });
  },
};
`;
