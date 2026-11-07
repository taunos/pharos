// E12 (code-quality audit 2026-11-05): scoring defects in Dim 2 and Dim 3.
// Fixtures only: every fetch is stubbed, no network.
import { describe, it, expect, vi, afterEach } from "vitest";
import { runDim2, findJsonRpcResponse, decodeTxtData, DNS_TXT_INFO_NOTE, MCP_PROTOCOL_VERSION, MAX_JSON_PARSES, MAX_SSE_PARSE_CHARS } from "./checks/dim2-mcp";
import { runDim3 } from "./checks/dim3-openapi";
import { runScan } from "./run-scan";
import { SCORING_VERSION } from "./version";

afterEach(() => {
  vi.unstubAllGlobals();
});

const env = () =>
  ({
    CACHE: { get: async () => null, put: async () => {} },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) },
    AI: { run: async () => ({ response: "50" }) },
  }) as never;

type Route = (init: RequestInit & { headers: Headers }) => Response | Promise<Response>;
const NOT_FOUND = () => new Response("", { status: 404 });

/** Stubs fetch with exact-URL routes (query string included); everything else 404s. */
function routes(map: Record<string, Route>) {
  const calls: Array<{ url: string; method: string; headers: Headers; body: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      calls.push({ url: String(u), method: init.method ?? "GET", headers, body: typeof init.body === "string" ? init.body : "" });
      return (map[String(u)] ?? NOT_FOUND)({ ...init, headers });
    })
  );
  return calls;
}

const json = (v: unknown, type = "application/json") => () => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": type } });
const html = (s: string) => () => new Response(s, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

const SPEC = { openapi: "3.1.0", info: { title: "Acme", version: "1", description: "x".repeat(30) }, paths: {} };
const LINKSET = { linkset: [{ anchor: "https://acme.com/api", "service-desc": [{ href: "https://acme.com/openapi.json" }] }] };

// ── Dim 3: soft-404s are not discoveries ─────────────────────────────────

describe("E12 Dim 3: a 200 must plausibly be a spec or catalog", () => {
  it("HTML soft-404 at /.well-known/api-catalog (and everywhere else) => whole dimension N/A", async () => {
    const soft404 = html("<!doctype html><html><body>Page not found</body></html>");
    routes({
      "https://acme.com/.well-known/api-catalog": soft404,
      "https://acme.com/.well-known/openapi": soft404,
      "https://acme.com/openapi.json": soft404,
      "https://acme.com/openapi.yaml": soft404,
      "https://acme.com/openapi.yml": soft404,
      "https://acme.com/swagger.json": soft404,
    });
    const d = await runDim3("https://acme.com/", env());
    expect(d.na).toBe(true);
    expect(d.unmeasured).toBeUndefined();
  });

  it("HTML served with a JSON content type is still rejected", async () => {
    routes({ "https://acme.com/.well-known/api-catalog": () => new Response("<html>404</html>", { status: 200, headers: { "content-type": "application/json" } }) });
    expect((await runDim3("https://acme.com/", env())).na).toBe(true);
  });

  it("an unparseable text body at /openapi.json is rejected", async () => {
    routes({ "https://acme.com/openapi.json": () => new Response("Not Found", { status: 200, headers: { "content-type": "text/plain" } }) });
    expect((await runDim3("https://acme.com/", env())).na).toBe(true);
  });

  it("a soft-404 at the well-known path falls through to the real canonical spec", async () => {
    routes({
      "https://acme.com/.well-known/api-catalog": html("<html>nope</html>"),
      "https://acme.com/openapi.json": json(SPEC),
    });
    const d = await runDim3("https://acme.com/", env());
    expect(d.na).toBeUndefined();
    expect(d.sub_checks[0]).toMatchObject({ id: "discovery", score: 75 });
    expect(d.sub_checks[0].notes).toContain("canonical /openapi.json");
  });

  it("an RFC 9727 linkset at /.well-known/api-catalog still counts as discovered", async () => {
    routes({ "https://acme.com/.well-known/api-catalog": json(LINKSET, "application/linkset+json") });
    const d = await runDim3("https://acme.com/", env());
    expect(d.sub_checks[0]).toMatchObject({ id: "discovery", score: 100 });
  });

  it("a YAML spec served as text/plain still counts", async () => {
    routes({ "https://acme.com/openapi.yaml": () => new Response("openapi: 3.0.3\ninfo:\n  title: A\n", { status: 200, headers: { "content-type": "text/plain" } }) });
    const d = await runDim3("https://acme.com/", env());
    expect(d.sub_checks.find((s) => s.id === "spec_validity")!.score).toBe(50);
  });
});

// ── Dim 3: homepage-link discovery is reachable ──────────────────────────

const HOME = '<html><head><link rel="service-desc" href="/api/spec.json"></head><body>Acme</body></html>';

describe("E12 Dim 3: homepage-link discovery", () => {
  it("a spec linked from the homepage is discovered (score 50) when the probes miss", async () => {
    routes({ "https://acme.com/api/spec.json": json(SPEC) });
    const d = await runDim3("https://acme.com/", env(), Promise.resolve({ html: HOME, url: "https://acme.com/" }));
    expect(d.na).toBeUndefined();
    expect(d.sub_checks[0]).toMatchObject({ id: "discovery", score: 50 });
    expect(d.sub_checks[0].notes).toContain("homepage link https://acme.com/api/spec.json");
  });

  it("a homepage link that soft-404s is rejected like the probes", async () => {
    routes({ "https://acme.com/api/spec.json": html("<html>gone</html>") });
    expect((await runDim3("https://acme.com/", env(), Promise.resolve({ html: HOME, url: "https://acme.com/" }))).na).toBe(true);
  });

  it("the homepage promise is not awaited when a probe hits", async () => {
    routes({ "https://acme.com/openapi.json": json(SPEC) });
    const never = new Promise<null>(() => {});
    const d = await runDim3("https://acme.com/", env(), never);
    expect(d.sub_checks[0].score).toBe(75);
  });

  it("runScan wires Dim 4's homepage read into Dim 3 without an extra homepage fetch", async () => {
    const scan = () => runScan(env(), "https://acme.com/", "free", { useCache: false, throwOnInsertFail: false });
    const homeFetches = (calls: Array<{ url: string }>) => calls.filter((c) => c.url === "https://acme.com/").length;
    // Baseline: same scan with a homepage that has no spec link.
    const before = routes({ "https://acme.com/": html("<html><body>Acme</body></html>") });
    await scan();
    const calls = routes({ "https://acme.com/": html(HOME), "https://acme.com/api/spec.json": json(SPEC) });
    const r = await scan();
    const d3 = r.dimensions.find((d) => d.dimension_id === 3)!;
    expect(d3.na).toBeUndefined();
    expect(d3.sub_checks[0].notes).toContain("homepage link https://acme.com/api/spec.json");
    // Dim 3 adds no homepage fetch of its own.
    expect(homeFetches(calls)).toBe(homeFetches(before));
    expect(r.scoring_version).toBe(SCORING_VERSION);
  });

  it("runScan: a homepage that fails to load leaves Dim 3 N/A (no hang)", async () => {
    routes({});
    const r = await runScan(env(), "https://acme.com/", "free", { useCache: false, throwOnInsertFail: false });
    expect(r.dimensions.find((d) => d.dimension_id === 3)!.na).toBe(true);
  });
});

// ── Dim 2: DNS TXT ───────────────────────────────────────────────────────

const DOH = "https://cloudflare-dns.com/dns-query?name=_mcp.acme.com&type=TXT";
const dnsCheck = async (answer: unknown[]) => {
  routes({ [DOH]: json({ Status: 0, Answer: answer }, "application/dns-json") });
  return (await runDim2("https://acme.com/", env())).sub_checks.find((s) => s.id === "dns_txt")!;
};
// 1.4.0: dns_txt is informational (always N/A, never scored); these tests
// check the detection itself through the note.
const found = (s: { notes: string; na?: boolean }) => (s.na === true && s.notes.startsWith("1 TXT record(s) at _mcp.acme.com") ? 100 : 0);

describe("E12 Dim 2: dns_txt counts only real _mcp TXT records", () => {
  it("a wildcard CNAME (the only Answer is type 5) scores 0", async () => {
    const s = await dnsCheck([{ name: "_mcp.acme.com", type: 5, TTL: 300, data: "cname.vercel-dns.com." }]);
    expect(s).toMatchObject({ score: 0, passed: false, na: true, notes: `No TXT record at _mcp.acme.com. ${DNS_TXT_INFO_NOTE}` });
  });

  it("a TXT record on the CNAME target, not _mcp.<host>, scores 0", async () => {
    const s = await dnsCheck([
      { name: "_mcp.acme.com", type: 5, data: "target.example.net." },
      { name: "target.example.net", type: 16, data: '"mcp=https://x.example.net/mcp"' },
    ]);
    expect(found(s)).toBe(0);
  });

  it("a TXT at _mcp.<host> that is not about MCP (wildcard SPF) scores 0", async () => {
    expect(found(await dnsCheck([{ name: "_mcp.acme.com", type: 16, data: '"v=spf1 -all"' }]))).toBe(0);
  });

  it("a real _mcp TXT record scores 100 (trailing dot and case tolerated)", async () => {
    const s = await dnsCheck([{ name: "_MCP.acme.com.", type: 16, TTL: 300, data: '"v=1; mcp=https://mcp.acme.com/mcp"' }]);
    expect(s).toMatchObject({ score: 0, passed: false, na: true, notes: `1 TXT record(s) at _mcp.acme.com. ${DNS_TXT_INFO_NOTE}` });
  });
});

// ── Dim 2: live invocation ───────────────────────────────────────────────

const CARD = "https://acme.com/.well-known/mcp.json";
const MCP = "https://mcp.acme.com/mcp";
const sse = (...msgs: unknown[]) => (extraHeaders: Record<string, string> = {}) =>
  new Response(msgs.map((m) => `event: message\r\ndata: ${JSON.stringify(m)}\r\n\r\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream", ...extraHeaders },
  });
const TOOLS = { tools: [{ name: "a" }, { name: "b" }, { name: "c" }] };

/** A Streamable HTTP server that enforces the lifecycle: initialize, initialized, then session-bound requests. */
function strictServer(opts: { protocolVersion?: string } = {}) {
  let initialized = false;
  return routes({
    [CARD]: json({ name: "acme", transports: [{ url: MCP, type: "streamable-http" }] }),
    [MCP]: (init) => {
      const msg = JSON.parse(String(init.body));
      if (msg.method === "initialize")
        return sse({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: opts.protocolVersion ?? "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "acme" } } })({
          "Mcp-Session-Id": "sess-123",
        });
      if (init.headers.get("mcp-session-id") !== "sess-123") return new Response("missing session", { status: 400 });
      if (msg.method === "notifications/initialized") {
        initialized = true;
        return new Response(null, { status: 202 });
      }
      if (msg.method === "tools/list" && initialized)
        // A log notification first, then the response: the old greedy regex
        // spanned both events and failed to parse.
        return sse({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info", data: "{x}" } }, { jsonrpc: "2.0", id: msg.id, result: TOOLS })();
      return new Response("bad request", { status: 400 });
    },
  });
}

const live = async () => (await runDim2("https://acme.com/", env())).sub_checks.find((s) => s.id === "live_invocation")!;

describe("E12 Dim 2: live check follows the MCP lifecycle", () => {
  it("initialize -> notifications/initialized -> tools/list with session + protocol headers => 100", async () => {
    const calls = strictServer();
    expect(await live()).toMatchObject({ score: 100, notes: "tools/list returned 3 tools" });
    const posts = calls.filter((c) => c.url === MCP);
    expect(posts.map((c) => JSON.parse(c.body).method)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    const init = JSON.parse(posts[0].body);
    expect(init).toMatchObject({ jsonrpc: "2.0", params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {} } });
    expect(JSON.parse(posts[1].body).id).toBeUndefined(); // a notification has no id
    for (const p of posts.slice(1)) {
      expect(p.headers.get("mcp-session-id")).toBe("sess-123");
      expect(p.headers.get("mcp-protocol-version")).toBe("2025-03-26"); // the negotiated version
    }
  });

  it("initialize rejected => 0, tools/list never sent", async () => {
    const calls = routes({
      [CARD]: json({ name: "acme", transports: [{ url: MCP }] }),
      [MCP]: () => new Response("no", { status: 405 }),
    });
    expect(await live()).toMatchObject({ score: 0, notes: "initialize returned status 405" });
    expect(calls.filter((c) => c.url === MCP).length).toBe(1);
  });

  it("initialize 200 without a result => 0", async () => {
    routes({
      [CARD]: json({ name: "acme", transports: [{ url: MCP }] }),
      [MCP]: json({ jsonrpc: "2.0", id: "scanner-init", error: { code: -32600, message: "nope" } }),
    });
    expect(await live()).toMatchObject({ score: 0, notes: "initialize returned 200 but no result in body" });
  });

  it("a hostile protocolVersion / session id is not echoed into headers (and doesn't throw)", async () => {
    const calls = routes({
      [CARD]: json({ name: "acme", transports: [{ url: MCP }] }),
      [MCP]: (init) => {
        const msg = JSON.parse(String(init.body));
        if (msg.method === "initialize")
          return json({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "x\r\nInjected: 1" } })();
        if (msg.method === "tools/list") return json({ jsonrpc: "2.0", id: msg.id, result: TOOLS })();
        return new Response(null, { status: 202 });
      },
    });
    expect((await live()).score).toBe(100);
    const list = calls.find((c) => c.url === MCP && c.body.includes("tools/list"))!;
    expect(list.headers.get("mcp-protocol-version")).toBe(MCP_PROTOCOL_VERSION);
    expect(list.headers.get("mcp-session-id")).toBeNull();
  });

  it("a plain JSON tools/list reply without tools[] => 0 with the no-tools note", async () => {
    routes({
      [CARD]: json({ name: "acme", transports: [{ url: MCP }] }),
      [MCP]: (init) => {
        const msg = JSON.parse(String(init.body));
        if (msg.method === "initialize") return json({ jsonrpc: "2.0", id: msg.id, result: {} })();
        if (msg.method === "tools/list") return json({ jsonrpc: "2.0", id: msg.id, result: {} })();
        return new Response(null, { status: 202 });
      },
    });
    expect(await live()).toMatchObject({ score: 0, notes: "tools/list returned 200 but no tools[] in body" });
  });
});

describe("findJsonRpcResponse", () => {
  it("matches by id in a JSON body, a batch, and SSE events (LF / CRLF, multi-line data)", () => {
    expect(findJsonRpcResponse('{"jsonrpc":"2.0","id":"a","result":1}', "a").msg).toMatchObject({ result: 1 });
    expect(findJsonRpcResponse('[{"id":"b","result":0},{"id":"a","result":2}]', "a").msg).toMatchObject({ result: 2 });
    expect(findJsonRpcResponse('data: {"id":"z"}\n\ndata: {"id":"a",\ndata: "result":3}\n\n', "a").msg).toMatchObject({ result: 3 });
    expect(findJsonRpcResponse('data:{"id":"a","result":4}\r\n\r\n', "a").msg).toMatchObject({ result: 4 });
  });

  it("reports whether any JSON was seen", () => {
    expect(findJsonRpcResponse("<html>", "a")).toMatchObject({ msg: null, sawJson: false });
    expect(findJsonRpcResponse('{"id":"other"}', "a")).toMatchObject({ msg: null, sawJson: true });
  });
});

// ── Codex r1 follow-ups ──────────────────────────────────────────────────

// Codex r2: no tight wall-clock asserts. One warm-up run, then a generous
// 1 s ceiling: the old code took seconds to minutes on these inputs, the new
// code a few ms, so the ceiling separates them without CI flakiness.
async function underOneSecond<T>(run: () => Promise<T>): Promise<T> {
  await run();
  const t = performance.now();
  const r = await run();
  expect(performance.now() - t).toBeLessThan(1000);
  return r;
}

describe("E12 r1: hostile bodies are scanned in linear time", () => {
  it("1 MB of newlines at /openapi.yaml is rejected quickly (old YAML regex was quadratic)", async () => {
    routes({ "https://acme.com/openapi.yaml": () => new Response("\n".repeat(1024 * 1024), { status: 200, headers: { "content-type": "text/plain" } }) });
    expect((await underOneSecond(() => runDim3("https://acme.com/", env()))).na).toBe(true);
  });

  it("1 MB of mixed whitespace before an openapi key past the scan window is not a spec", async () => {
    routes({ "https://acme.com/openapi.yaml": () => new Response(" \t\r\n".repeat(256 * 1024) + "openapi: 3.0.0\n", { status: 200, headers: { "content-type": "text/plain" } }) });
    expect((await underOneSecond(() => runDim3("https://acme.com/", env()))).na).toBe(true);
  });

  for (const [name, html] of [
    ["many <link> tags with long attributes", ("<link rel=x " + "a".repeat(1000)).repeat(2000)],
    ["a spec anchor followed by 1 MB of whitespace", '<a href="x.json">' + " ".repeat(1024 * 1024)],
    ["many spec anchors with tag soup", ('<a href="x.json">' + "<".repeat(500)).repeat(4000)],
    ["2 MB of attribute soup", ("<a b=c d='e' f=\"g\" " + "x ".repeat(100)).repeat(8000)],
    ["an unterminated quoted value", '<link rel="service-desc" href="' + "a".repeat(2 * 1024 * 1024)],
  ] as const) {
    it(`homepage link scan on ${name} is quick`, async () => {
      routes({});
      const d = await underOneSecond(() => runDim3("https://acme.com/", env(), Promise.resolve({ html, url: "https://acme.com/" })));
      expect(d.na).toBe(true);
    });
  }

  it("the tag scan still finds anchors by text and link tags in either attribute order", async () => {
    routes({ "https://acme.com/v1/api.yaml": () => new Response("openapi: 3.1.0\n", { status: 200, headers: { "content-type": "text/plain" } }) });
    const anchor = '<html><a class="x" href="/v1/api.yaml"><span>Download the</span> OpenAPI spec</a></html>';
    const d = await runDim3("https://acme.com/", env(), Promise.resolve({ html: anchor, url: "https://acme.com/" }));
    expect(d.sub_checks[0].notes).toContain("homepage link https://acme.com/v1/api.yaml");
    routes({ "https://acme.com/s.json": json(SPEC) });
    const link = "<LINK HREF='/s.json' REL='api-catalog'>";
    const d2 = await runDim3("https://acme.com/", env(), Promise.resolve({ html: link, url: "https://acme.com/" }));
    expect(d2.sub_checks[0].notes).toContain("homepage link https://acme.com/s.json");
  });
});

describe("E12 r1: a JSON soft-404 is not a discovery", () => {
  it('{"error":"Not Found"} at the well-known paths => discovery continues to /openapi.json', async () => {
    routes({
      "https://acme.com/.well-known/api-catalog": json({ error: "Not Found" }),
      "https://acme.com/.well-known/openapi": json({ error: "Not Found" }),
      "https://acme.com/openapi.json": json(SPEC),
    });
    const d = await runDim3("https://acme.com/", env());
    expect(d.sub_checks[0]).toMatchObject({ score: 75 });
    expect(d.sub_checks[0].notes).toContain("canonical /openapi.json");
  });

  it("JSON objects with neither a version key nor a linkset => N/A", async () => {
    routes({ "https://acme.com/openapi.json": json({ message: "ok", status: 200 }), "https://acme.com/swagger.json": json({ ok: true }) });
    expect((await runDim3("https://acme.com/", env())).na).toBe(true);
  });
});

describe("E12 r1: homepage links resolve against the homepage's final URL", () => {
  it('href="spec.json" on /docs/ resolves to /docs/spec.json', async () => {
    routes({ "https://acme.com/docs/spec.json": json(SPEC) });
    const page = '<link rel="describedby" href="spec.json">';
    const d = await runDim3("https://acme.com/docs/", env(), Promise.resolve({ html: page, url: "https://acme.com/docs/" }));
    expect(d.sub_checks[0].notes).toContain("homepage link https://acme.com/docs/spec.json");
  });

  it("runScan: the base is the post-redirect URL from Dim 4's read", async () => {
    routes({
      "https://acme.com/": () => new Response(null, { status: 301, headers: { location: "/docs/" } }),
      "https://acme.com/docs/": html('<link rel="service-desc" href="spec.json">'),
      "https://acme.com/docs/spec.json": json(SPEC),
    });
    const r = await runScan(env(), "https://acme.com/", "free", { useCache: false, throwOnInsertFail: false });
    expect(r.dimensions.find((d) => d.dimension_id === 3)!.sub_checks[0].notes).toContain("homepage link https://acme.com/docs/spec.json");
  });
});

describe("E12 r1: TXT data is decoded from presentation syntax before matching", () => {
  it("decodes split character-strings and escapes", () => {
    expect(decodeTxtData('"v=1; m" "cp=https://mcp.acme.com/mcp"')).toBe("v=1; mcp=https://mcp.acme.com/mcp");
    expect(decodeTxtData('"say \\"hi\\" \\\\ \\109cp"')).toBe('say "hi" \\ mcp');
    expect(decodeTxtData("unquoted mcp")).toBe("unquoted mcp");
  });

  it('a record split as "m" "cp=..." scores 100', async () => {
    expect(found(await dnsCheck([{ name: "_mcp.acme.com", type: 16, data: '"v=1; m" "cp=https://mcp.acme.com/mcp"' }]))).toBe(100);
  });

  it("an escaped \\109cp (m) scores 100", async () => {
    expect(found(await dnsCheck([{ name: "_mcp.acme.com", type: 16, data: '"\\109cp=https://mcp.acme.com/mcp"' }]))).toBe(100);
  });
});

// ── Codex r2 follow-ups ──────────────────────────────────────────────────

describe("E12 r2/r3: JSON-RPC scan is bounded and only takes responses", () => {
  const MB2 = 2 * 1024 * 1024;

  it('"data:x\n\n" x 200k (1.6 MB): every block skipped without a JSON.parse', () => {
    const r = findJsonRpcResponse("data:x\n\n".repeat(200000), "a");
    expect(r).toMatchObject({ msg: null, sawJson: false, exhausted: false, parses: 0, blocks: 200000 });
  });

  for (const [name, unit] of [
    ["comment lines", ":\n"],
    ["undispatched data lines", "data:x\n"],
    ["blank lines", "\n"],
    ["bare CRs", "\r"],
  ] as const) {
    it(`2 MB of ${name}: one pass, no JSON.parse`, () => {
      const text = unit.repeat(Math.ceil(MB2 / unit.length));
      const r = findJsonRpcResponse(text, "a");
      expect(r).toMatchObject({ msg: null, parses: 0, exhausted: false });
      expect(r.lines).toBeLessThanOrEqual(text.length + 1); // each line visited once
    });
  }

  it(`more than MAX_JSON_PARSES JSON blocks: stops at the cap and reports exhausted`, () => {
    const r = findJsonRpcResponse('data: {"id":"z"}\n\n'.repeat(MAX_JSON_PARSES + 50) + 'data: {"id":"a","result":1}\n\n', "a");
    expect(r).toMatchObject({ msg: null, exhausted: true, parses: MAX_JSON_PARSES });
  });

  it("more than MAX_SSE_PARSE_CHARS of JSON data: stops at the byte budget and reports exhausted", () => {
    const big = 'data: {"id":"z","pad":"' + "x".repeat(512 * 1024) + '"}\n\n';
    const r = findJsonRpcResponse(big.repeat(5), "a");
    expect(r.exhausted).toBe(true);
    expect(r.parsedChars).toBeLessThanOrEqual(MAX_SSE_PARSE_CHARS);
  });

  it("a valid reply after 200 small notifications is found (the r2 64-block cap rejected it)", () => {
    const body = 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n'.repeat(200) + 'data: {"id":"a","result":2}\n\n';
    expect(findJsonRpcResponse(body, "a")).toMatchObject({ msg: { result: 2 }, exhausted: false });
  });

  it("stops at the first response", () => {
    const body = 'data: {"id":"a","result":1}\n\n' + 'data: {"id":"z"}\n\n'.repeat(50);
    expect(findJsonRpcResponse(body, "a")).toMatchObject({ msg: { result: 1 }, blocks: 1, parses: 1 });
  });

  it("a server request reusing the id is not the response", () => {
    const body = 'data: {"jsonrpc":"2.0","id":"a","method":"ping"}\n\ndata: {"jsonrpc":"2.0","id":"a","result":3}\n\n';
    expect(findJsonRpcResponse(body, "a").msg).toMatchObject({ result: 3 });
    expect(findJsonRpcResponse('[{"id":"a","method":"ping"},{"id":"a","result":4}]', "a").msg).toMatchObject({ result: 4 });
    expect(findJsonRpcResponse('{"id":"a"}', "a").msg).toBeNull(); // neither result nor error
  });

  it("an error response wins and ends the scan", () => {
    const body = 'data: {"id":"a","error":{"code":-1,"message":"x"}}\n\ndata: {"id":"a","result":5}\n\n';
    expect(findJsonRpcResponse(body, "a")).toMatchObject({ msg: { error: { code: -1 } }, parses: 1 });
  });

  it("live check: a request reusing scanner-list before the tools reply still scores 100", async () => {
    routes({
      [CARD]: json({ name: "acme", transports: [{ url: MCP }] }),
      [MCP]: (init) => {
        const msg = JSON.parse(String(init.body));
        if (msg.method === "initialize") return json({ jsonrpc: "2.0", id: msg.id, result: {} })();
        if (msg.method === "tools/list") return sse({ jsonrpc: "2.0", id: msg.id, method: "ping" }, { jsonrpc: "2.0", id: msg.id, result: TOOLS })();
        return new Response(null, { status: 202 });
      },
    });
    expect(await live()).toMatchObject({ score: 100, notes: "tools/list returned 3 tools" });
  });

  it("live check: an exhausted scan is reported distinctly", async () => {
    const notes = Array.from({ length: MAX_JSON_PARSES + 1 }, () => ({ jsonrpc: "2.0", method: "notifications/progress" }));
    routes({
      [CARD]: json({ name: "acme", transports: [{ url: MCP }] }),
      [MCP]: (init) => {
        const msg = JSON.parse(String(init.body));
        if (msg.method === "initialize") return json({ jsonrpc: "2.0", id: msg.id, result: {} })();
        if (msg.method === "tools/list") return sse(...notes, { jsonrpc: "2.0", id: msg.id, result: TOOLS })();
        return new Response(null, { status: 202 });
      },
    });
    expect(await live()).toMatchObject({ score: 0, notes: "tools/list returned 200 but the reply exceeded the scan limit" });
  });

  it("live check: a long (4096-char) visible-ASCII session id is kept; control chars are not", async () => {
    for (const [sid, kept] of [["s".repeat(4096), true], ["s".repeat(4097), false]] as const) {
      const calls = routes({
        [CARD]: json({ name: "acme", transports: [{ url: MCP }] }),
        [MCP]: (init) => {
          const msg = JSON.parse(String(init.body));
          if (msg.method === "initialize") return new Response(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": sid } });
          if (msg.method === "tools/list") return json({ jsonrpc: "2.0", id: msg.id, result: TOOLS })();
          return new Response(null, { status: 202 });
        },
      });
      await live();
      const list = calls.find((c) => c.url === MCP && c.body.includes("tools/list"))!;
      expect(list.headers.get("mcp-session-id")).toBe(kept ? sid : null);
    }
  });
});

describe("E12 r2: quote-aware tag tokenizer", () => {
  it('<link data-rel="service-desc" data-href="/fake.json"> is not a spec link', async () => {
    const calls = routes({ "https://acme.com/fake.json": json(SPEC) });
    const page = '<link data-rel="service-desc" data-href="/fake.json"><a data-href="/fake.json">OpenAPI</a>';
    const d = await runDim3("https://acme.com/", env(), Promise.resolve({ html: page, url: "https://acme.com/" }));
    expect(d.na).toBe(true);
    expect(calls.some((c) => c.url === "https://acme.com/fake.json")).toBe(false);
  });

  it('href="spec>v1.json" (">" inside a quoted value) is discovered', async () => {
    routes({ "https://acme.com/spec%3Ev1.json": json(SPEC) });
    const page = '<link rel="service-desc" href="spec>v1.json">';
    const d = await runDim3("https://acme.com/", env(), Promise.resolve({ html: page, url: "https://acme.com/" }));
    expect(d.sub_checks[0].notes).toContain("homepage link https://acme.com/spec%3Ev1.json");
  });

  it("unquoted values, upper-case names and rel token lists work", async () => {
    routes({ "https://acme.com/api.json": json(SPEC) });
    const page = "<LINK REL=\"alternate service-desc\" HREF=/api.json>";
    const d = await runDim3("https://acme.com/", env(), Promise.resolve({ html: page, url: "https://acme.com/" }));
    expect(d.sub_checks[0].notes).toContain("homepage link https://acme.com/api.json");
  });
});

describe("E12 r2: strict TXT decoding", () => {
  it("returns null for malformed presentation data", () => {
    expect(decodeTxtData('"\\256cp"')).toBeNull(); // \DDD > 255
    expect(decodeTxtData('"mcp=https://x')).toBeNull(); // unterminated
    expect(decodeTxtData('"m" x "cp"')).toBeNull(); // junk between strings
    expect(decodeTxtData('"m"\t"cp"')).toBe("mcp");
  });

  it("a malformed record does not count", async () => {
    expect(found(await dnsCheck([{ name: "_mcp.acme.com", type: 16, data: '"v=1; mcp=https://x' }]))).toBe(0);
  });
});

describe("E12 r2: a linkset must carry an API relation", () => {
  it("an empty or unrelated linkset is not discovered", async () => {
    routes({ "https://acme.com/.well-known/api-catalog": json({ linkset: [] }, "application/linkset+json") });
    expect((await runDim3("https://acme.com/", env())).na).toBe(true);
    routes({
      "https://acme.com/.well-known/api-catalog": json({ linkset: [{ anchor: "https://acme.com", status: [{ href: "https://status.acme.com" }] }] }, "application/linkset+json"),
    });
    expect((await runDim3("https://acme.com/", env())).na).toBe(true);
    routes({ "https://acme.com/.well-known/api-catalog": json({ linkset: [{ "service-desc": [{ type: "x" }] }] }, "application/linkset+json") });
    expect((await runDim3("https://acme.com/", env())).na).toBe(true);
  });

  it("an item relation with an href counts", async () => {
    routes({ "https://acme.com/.well-known/api-catalog": json({ linkset: [{ anchor: "https://acme.com", item: [{ href: "https://acme.com/api/" }] }] }, "application/linkset+json") });
    expect((await runDim3("https://acme.com/", env())).sub_checks[0].score).toBe(100);
  });
});

describe("E12 r3: HTML character references in rel / href", () => {
  it("&amp; in an href is decoded before resolving", async () => {
    routes({ "https://acme.com/spec?v=1&fmt=json": json(SPEC) });
    const page = '<link rel="service-desc" href="/spec?v=1&amp;fmt=json">';
    const d = await runDim3("https://acme.com/", env(), Promise.resolve({ html: page, url: "https://acme.com/" }));
    expect(d.sub_checks[0].notes).toContain("homepage link https://acme.com/spec?v=1&fmt=json");
  });

  it("numeric references in rel and href are decoded (&#115;ervice-desc, &#x2F;)", async () => {
    routes({ "https://acme.com/api/spec.json": json(SPEC) });
    const page = '<link rel="&#115;ervice-desc" href="&#x2F;api&#47;spec.json">';
    const d = await runDim3("https://acme.com/", env(), Promise.resolve({ html: page, url: "https://acme.com/" }));
    expect(d.sub_checks[0].notes).toContain("homepage link https://acme.com/api/spec.json");
  });

  it("&quot; / &lt; / &gt; / &apos; decode, and an invalid code point becomes U+FFFD", async () => {
    const calls = routes({});
    const page = '<link rel="service-desc" href="/a&lt;b&gt;&quot;&apos;&#0;&#x110000;.json">';
    await runDim3("https://acme.com/", env(), Promise.resolve({ html: page, url: "https://acme.com/" }));
    const expected = new URL("/a<b>\"'" + "\ufffd\ufffd" + ".json", "https://acme.com/").toString();
    expect(calls.some((c) => c.url === expected)).toBe(true);
  });
});
