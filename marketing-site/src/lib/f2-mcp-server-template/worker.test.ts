import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { renderMcpServerWorker } from "./index";
import { generateMcpServerConfig } from "../f2-generators/mcp-server-config";

// The delivered MCP Worker (mcp-server/index.ts), rendered from the real
// generator config and imported as a module: every request below goes to its
// fetch handler in-process. No network.

type Worker = { fetch(r: Request, env: unknown): Promise<Response> };

const kv = { get: async () => null, put: async () => undefined } as unknown as KVNamespace;
const BASE = { brand_name: "Acme", domain: "acme.com", category: "Developer Tools", competitors: [], baseline_scan_summary: "x" };
const ORIGIN = "https://astrant-mcp-acme.acct.workers.dev";
const TOOL_NAMES = ["get_capabilities", "get_pricing", "get_case_studies", "get_contact_tools"];
const LF = String.fromCharCode(10);

async function render(brand = "Acme") {
  const config = await generateMcpServerConfig({ SESSIONS: kv }, { ...BASE, brand_name: brand });
  return { config, files: renderMcpServerWorker(config) };
}

async function load(src: string): Promise<Worker & Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), "f2-mcp-worker-"));
  writeFileSync(join(dir, "index.ts"), src);
  const mod = (await import(/* @vite-ignore */ pathToFileURL(join(dir, "index.ts")).href)) as Record<string, unknown>;
  return Object.assign(mod.default as Worker, { module: mod });
}

const { config: CONFIG, files: FILES } = await render();
const worker = await load(FILES["mcp-server/index.ts"]);

function post(body: unknown, headers: Record<string, string> = {}, path = "/mcp"): Promise<Response> {
  return worker.fetch(
    new Request(ORIGIN + path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    {},
  );
}

async function rpc(method: string, params?: unknown, id: unknown = 1) {
  const res = await post({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
  return { status: res.status, type: res.headers.get("content-type"), body: (await res.json()) as Record<string, any> };
}

describe("delivered MCP Worker: JSON-RPC over Streamable HTTP", () => {
  it("initialize negotiates the protocol version and declares tools", async () => {
    for (const v of ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]) {
      const r = await rpc("initialize", { protocolVersion: v, capabilities: {}, clientInfo: { name: "t", version: "1" } });
      expect(r.status).toBe(200);
      expect(r.type).toBe("application/json");
      expect(r.body).toEqual({
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: v,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "Acme", version: "1.0.0" },
        },
      });
    }
    // Unknown or missing version: the server answers with its newest one.
    for (const params of [{ protocolVersion: "1999-01-01" }, {}, undefined]) {
      expect((await rpc("initialize", params)).body.result.protocolVersion).toBe("2025-11-25");
    }
  });

  it("notifications and client responses get 202 with no body", async () => {
    for (const msg of [
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } },
      { jsonrpc: "2.0", id: 9, result: {} },
    ]) {
      const res = await post(msg, { "mcp-protocol-version": "2025-06-18" });
      expect(res.status).toBe(202);
      expect(await res.text()).toBe("");
    }
  });

  it("tools/list returns the 4 delivered tools with descriptions and an inputSchema", async () => {
    const r = await rpc("tools/list", {});
    expect(r.body.result.tools).toEqual(
      CONFIG.capabilities.map((c) => ({ name: c.name, description: c.description, inputSchema: { type: "object", properties: {} } })),
    );
    expect(r.body.result.tools.map((t: { name: string }) => t.name)).toEqual(TOOL_NAMES);
  });

  it("tools/call returns each tool's static response as text content, without _description", async () => {
    for (const cap of CONFIG.capabilities) {
      const r = await rpc("tools/call", { name: cap.name, arguments: {} }, `call-${cap.name}`);
      expect(r.body.id).toBe(`call-${cap.name}`);
      expect(r.body.result.isError).toBe(false);
      expect(r.body.result.content).toHaveLength(1);
      expect(r.body.result.content[0].type).toBe("text");
      expect(JSON.parse(r.body.result.content[0].text)).toEqual(cap.response);
    }
    // arguments may be omitted
    expect((await rpc("tools/call", { name: "get_pricing" })).body.result.content).toHaveLength(1);
  });

  it("ping answers an empty result", async () => {
    expect((await rpc("ping")).body).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it("JSON-RPC errors: unknown tool / method, invalid params, invalid request, parse error", async () => {
    for (const name of ["nope", "__proto__", "constructor", "toString", "hasOwnProperty", 42, undefined]) {
      const r = await rpc("tools/call", { name });
      expect(r.status).toBe(200);
      expect(r.body.error).toEqual({ code: -32602, message: "Unknown tool" });
    }
    expect((await rpc("tools/call", { name: "get_pricing", arguments: [1] })).body.error.code).toBe(-32602);
    expect((await rpc("tools/call", [1])).body.error.code).toBe(-32602);
    expect((await rpc("resources/list")).body).toEqual({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } });
    for (const bad of [{ id: 1, method: "ping" }, { jsonrpc: "1.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: {}, method: "ping" }, 7, '"x"', null]) {
      const res = await post(bad);
      expect(((await res.json()) as { error: { code: number } }).error.code).toBe(-32600);
    }
    const parse = await post("{not json");
    expect(parse.status).toBe(400);
    expect(await parse.json()).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  });

  it("batches (2025-03-26 clients) answer every request and skip notifications", async () => {
    const res = await post([
      { jsonrpc: "2.0", id: "a", method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: "b", method: "tools/list" },
    ]);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.map((m) => m.id)).toEqual(["a", "b"]);
    expect((await post([{ jsonrpc: "2.0", method: "notifications/initialized" }])).status).toBe(202);
    expect((await post([])).status).toBe(400);
  });

  it("transport rules: POST only, JSON only, supported MCP-Protocol-Version, bounded body", async () => {
    for (const method of ["GET", "DELETE", "PUT"]) {
      const res = await worker.fetch(new Request(ORIGIN + "/mcp", { method, headers: { accept: "text/event-stream" } }), {});
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { "content-type": "text/plain" })).status).toBe(415);
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { "content-type": "application/json; charset=utf-8" })).status).toBe(200);
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { "mcp-protocol-version": "2099-01-01" })).status).toBe(400);
    expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { "mcp-protocol-version": "2025-11-25" })).status).toBe(200);
    expect((await post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", pad: "x".repeat(70000) }))).status).toBe(413);
  });

  it("a body streamed without Content-Length is cut off at the cap, not buffered whole", async () => {
    const CHUNK = 16 * 1024;
    const TOTAL_CHUNKS = 256; // 4 MiB offered
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled === 0) controller.enqueue(new TextEncoder().encode('{"jsonrpc":"2.0","id":1,"method":"ping","pad":"'));
        if (++pulled >= TOTAL_CHUNKS) controller.close();
        else controller.enqueue(new Uint8Array(CHUNK).fill(120));
      },
    });
    const req = new Request(ORIGIN + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(req.headers.get("content-length")).toBeNull();
    const res = await worker.fetch(req, {});
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(16); // ~64 KiB / 16 KiB, plus stream lookahead
  });

  it("a body held open after its first byte is cut off by the 10s read deadline (408, stream cancelled)", async () => {
    vi.useFakeTimers();
    try {
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{"));
        },
        cancel() {
          cancelled = true;
        },
      });
      const req = new Request(ORIGIN + "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: stream,
        duplex: "half",
      } as RequestInit);
      const pending = worker.fetch(req, {});
      await vi.advanceTimersByTimeAsync(9_000);
      expect(await Promise.race([pending.then(() => "settled"), Promise.resolve("pending")])).toBe("pending");
      await vi.advanceTimersByTimeAsync(1_500);
      const res = await Promise.race([pending, Promise.resolve(null)]);
      expect(res?.status).toBe(408);
      expect(await res!.json()).toMatchObject({ error: { code: -32000 } });
      expect(cancelled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the legacy POST /mcp/call route is gone", async () => {
    const res = await post({ tool: "get_capabilities" }, {}, "/mcp/call");
    expect(res.status).toBe(404);
    expect(FILES["mcp-server/index.ts"]).not.toContain("/mcp/call");
    expect(FILES["mcp-server/README.md"]).not.toContain("/mcp/call");
  });

  it("/.well-known/mcp.json: identity, tools, and a streamable-http transport at this origin's /mcp", async () => {
    const res = await worker.fetch(new Request(ORIGIN + "/.well-known/mcp.json"), {});
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const card = (await res.json()) as Record<string, any>;
    expect(card).toMatchObject({
      name: "Acme",
      domain: "acme.com",
      category: "Developer Tools",
      version: "1.0.0",
      transports: [{ type: "streamable-http", url: `${ORIGIN}/mcp` }],
      authentication: { type: "none" },
    });
    expect(card.tools.map((t: { name: string }) => t.name)).toEqual(TOOL_NAMES);
    // The card follows the host it is served on (e.g. a custom domain).
    const custom = (await (await worker.fetch(new Request("https://mcp.acme.com/.well-known/mcp.json"), {})).json()) as Record<string, any>;
    expect(custom.transports[0].url).toBe("https://mcp.acme.com/mcp");
    expect((await worker.fetch(new Request(ORIGIN + "/.well-known/mcp.json", { method: "POST" }), {})).status).toBe(405);
    expect((await worker.fetch(new Request(ORIGIN + "/"), {})).status).toBe(404);
  });
});

describe("rendering hostile brand names", () => {
  const HOSTILE = [
    'Acme: "Pro" # 1',
    "- Acme",
    "* Acme",
    "Ac\"me \\ `${x}` </b>",
    ["Line1", "export const pwned = 1;"].join(LF),
    "Acme" + String.fromCharCode(0x2028) + "export const pwned2 = 2;",
    "Acme" + String.fromCharCode(13) + "x",
    "São Paulo — 東京 🚀",
    "'; process.exit(1); //",
    "$(touch /tmp/pwn) `id`",
    "*/ }; export const pwned3 = 3; /*",
  ];

  it("the Worker parses, serves the exact brand, and no brand text becomes code", async () => {
    for (const brand of HOSTILE) {
      const { files } = await render(brand);
      const w = await load(files["mcp-server/index.ts"]);
      expect(Object.keys((w as unknown as { module: Record<string, unknown> }).module), brand).toEqual(["default"]);
      const init = await w.fetch(
        new Request(ORIGIN + "/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }),
        }),
        {},
      );
      expect(((await init.json()) as { result: { serverInfo: { name: string } } }).result.serverInfo.name, brand).toBe(brand);
      const card = (await (await w.fetch(new Request(ORIGIN + "/.well-known/mcp.json"), {})).json()) as { name: string };
      expect(card.name).toBe(brand);
    }
  });

  it("package.json stays valid JSON and README headings stay on one line", async () => {
    for (const brand of HOSTILE) {
      const { files } = await render(brand);
      const pkg = JSON.parse(files["mcp-server/package.json"]) as { description: string };
      expect(pkg.description).toBe(`Astrant-generated MCP server for ${brand}`);
      const firstLine = files["mcp-server/README.md"].split(LF)[0];
      expect(firstLine.startsWith("# ")).toBe(true);
      expect(firstLine.endsWith(" MCP Server")).toBe(true);
    }
  });
});
