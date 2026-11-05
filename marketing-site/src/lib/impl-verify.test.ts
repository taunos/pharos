import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  collectLdNodes,
  expectedFromDelivery,
  filesFromPatch,
  parseLlmsTxt,
  parseOpenApi,
  parseRobots,
  robotsAllows,
  verifyArtifacts,
  type ArtifactCheck,
  type ExpectedArtifacts,
} from "./impl-verify";
import { generateLlmsTxt } from "./f2-generators/llms-txt";
import { generateOpenApi } from "./f2-generators/openapi";
import { generateJsonLd } from "./f2-generators/jsonld";
import { generateMcpServerConfig } from "./f2-generators/mcp-server-config";
import { renderMcpServerWorker } from "./f2-mcp-server-template";
import { assembleGitAmPatch } from "./f2-patch-assembler";

// Fixtures only: every fetch goes to an in-memory router; no network.

const kv = { get: async () => null, put: async () => undefined } as unknown as KVNamespace;
const GEN_INPUT = {
  brand_name: "Acme",
  domain: "acme.com",
  category: "Developer Tools",
  competitors: ["Globex"],
  baseline_scan_summary: "composite=40 grade=D",
};

// Exactly what impl-fulfill-run.ts Step 4-6 builds (minus README/monitoring,
// which the verifier does not read).
async function deliveredFiles(): Promise<Record<string, string>> {
  const env = { SESSIONS: kv };
  const [llms, mcpConfig, openapi, jsonld] = await Promise.all([
    generateLlmsTxt(env, GEN_INPUT),
    generateMcpServerConfig(env, GEN_INPUT),
    generateOpenApi(env, GEN_INPUT),
    generateJsonLd(env, GEN_INPUT),
  ]);
  return {
    "public/llms.txt": llms,
    "public/openapi.yaml": openapi,
    "ASTRANT_IMPLEMENTATION.md": "# Acme\n",
    "monitoring/check-llms-txt.sh": "#!/usr/bin/env bash\necho ok\n",
    "app/layout-jsonld.html": jsonld,
    ...renderMcpServerWorker(mcpConfig),
  };
}

const FILES = await deliveredFiles();
const PATCH = assembleGitAmPatch({
  customer_domain: GEN_INPUT.domain,
  customer_email: "dev@acme.com",
  session_id: "impl-verify-test",
  fulfillment_time: new Date("2026-11-05T00:00:00Z"),
  files: FILES,
});
const EXPECTED = expectedFromDelivery({ patch: PATCH });

// The real rendered Worker (mcp-server/index.ts), loaded as a module so the
// template-protocol path is checked against delivered behaviour, not a mock.
const workerDir = mkdtempSync(join(tmpdir(), "impl-verify-"));
writeFileSync(join(workerDir, "index.ts"), FILES["mcp-server/index.ts"]);
const deliveredWorker = (await import(/* @vite-ignore */ pathToFileURL(join(workerDir, "index.ts")).href)).default as {
  fetch(r: Request, env: unknown): Promise<Response>;
};

const SITE = "https://acme.com";
const MCP = "https://astrant-mcp-acme.acct.workers.dev";

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function homepage(extraHead = FILES["app/layout-jsonld.html"]): string {
  return `<!doctype html><html><head><title>Acme</title>${extraHead}</head><body>hi</body></html>`;
}

/** Routes by exact URL; unknown URLs 404. Records every URL fetched. */
function router(routes: Record<string, Handler | Response | string>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push(url);
    const r = routes[url];
    if (r === undefined) return new Response("not found", { status: 404 });
    if (typeof r === "string") return new Response(r, { status: 200, headers: { "content-type": "text/plain" } });
    if (r instanceof Response) return r.clone();
    return r(url, init);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function goodSite(over: Record<string, Handler | Response | string> = {}) {
  return router({
    [`${SITE}/llms.txt`]: FILES["public/llms.txt"],
    [`${SITE}/openapi.yaml`]: FILES["public/openapi.yaml"],
    [`${SITE}/`]: new Response(homepage(), { headers: { "content-type": "text/html; charset=utf-8" } }),
    [`${SITE}/robots.txt`]: "User-agent: *\nAllow: /\n",
    [`${MCP}/`]: (url, init) => deliveredWorker.fetch(new Request(url, init), {}),
    [`${MCP}/.well-known/mcp.json`]: (url, init) => deliveredWorker.fetch(new Request(url, init), {}),
    [`${MCP}/mcp/call`]: (url, init) => deliveredWorker.fetch(new Request(url, init), {}),
    ...over,
  });
}

const NOW = () => new Date("2026-11-05T12:00:00Z");

async function run(fetchImpl: typeof fetch, opts: { expected?: ExpectedArtifacts; mcpUrl?: string | null; siteUrl?: string } = {}) {
  const checks = await verifyArtifacts({
    siteUrl: opts.siteUrl ?? SITE,
    expected: opts.expected ?? EXPECTED,
    mcpUrl: opts.mcpUrl === null ? undefined : (opts.mcpUrl ?? MCP),
    fetchImpl,
    now: NOW,
  });
  return Object.fromEntries(checks.map((c) => [c.artifact, c])) as Record<string, ArtifactCheck>;
}

function only(artifact: keyof ExpectedArtifacts): ExpectedArtifacts {
  return { engine: EXPECTED.engine, [artifact]: EXPECTED[artifact] } as ExpectedArtifacts;
}

/** A body stream that never ends (hostile huge body). */
function endless(contentType = "text/plain"): Response {
  const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
  let sent = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(c) {
        sent++;
        c.enqueue(chunk);
      },
    }),
    { status: 200, headers: { "content-type": contentType } },
  );
}

afterEach(() => {
  vi.useRealTimers();
});

// ── expectedFromDelivery ─────────────────────────────────────────────────

describe("expectedFromDelivery (real generator output)", () => {
  it("round-trips: the patch and the files map give the same expectation", () => {
    expect(filesFromPatch(PATCH)).toEqual(FILES);
    expect(filesFromPatch(new TextEncoder().encode(PATCH))).toEqual(FILES);
    expect(expectedFromDelivery({ files: FILES })).toEqual(EXPECTED);
    // JSON-safe: the CLI's expected.json is this object serialized.
    expect(JSON.parse(JSON.stringify(EXPECTED))).toEqual(EXPECTED);
  });

  it("captures what each delivered artifact is and where it is served", () => {
    expect(EXPECTED.llms_txt).toMatchObject({
      path: "/llms.txt",
      title: "Acme",
      headings: ["Documentation", "API", "Capabilities", "Alternatives", "Maintenance"],
      links: ["https://acme.com/"],
      content: FILES["public/llms.txt"],
    });
    expect(EXPECTED.openapi).toMatchObject({
      path: "/openapi.yaml",
      version: "3.1.0",
      title: "Acme API",
      servers: ["https://acme.com"],
      paths: {},
      operationCount: 0,
    });
    expect(EXPECTED.json_ld).toEqual({
      path: "/",
      nodes: [
        { type: "Organization", fields: { name: "Acme", url: "https://acme.com/" } },
        { type: "Service", fields: { name: "Acme", serviceType: "Developer Tools", url: "https://acme.com/" } },
      ],
    });
    expect(EXPECTED.mcp_server).toEqual({
      brandName: "Acme",
      domain: "acme.com",
      toolNames: ["get_capabilities", "get_pricing", "get_case_studies", "get_contact_tools"],
    });
  });

  it("undoes the template's string escapes for the MCP brand name", async () => {
    const env = { SESSIONS: kv };
    const cfg = await generateMcpServerConfig(env, { ...GEN_INPUT, brand_name: 'Ac"me \\ `${x}` </b>' });
    const exp = expectedFromDelivery({ files: { ...renderMcpServerWorker(cfg) } });
    expect(exp.mcp_server?.brandName).toBe('Ac"me \\ `${x}` </b>');
  });

  it("rejects a malformed patch", () => {
    expect(() => filesFromPatch("hello")).toThrow(/no files/);
    const short = PATCH.replace(/@@ -0,0 \+1,(\d+) @@/, (_, n) => `@@ -0,0 +1,${Number(n) + 50} @@`);
    expect(() => filesFromPatch(short)).toThrow();
  });
});

// ── All working ──────────────────────────────────────────────────────────

describe("verifyArtifacts: the delivered artifacts, applied unmodified", () => {
  it("reports every artifact working, with evidence", async () => {
    const { fetchImpl } = goodSite();
    const r = await run(fetchImpl);
    expect(Object.keys(r)).toEqual(["llms_txt", "openapi", "json_ld", "mcp_server"]);
    for (const c of Object.values(r)) {
      expect(c.state, `${c.artifact}: ${JSON.stringify(c.evidence)}`).toBe("working");
      expect(c.checkedAt).toBe("2026-11-05T12:00:00.000Z");
    }
    expect(r.llms_txt.evidence.note).toBe("byte-identical to the delivered file");
    expect(r.llms_txt.url).toBe("https://acme.com/llms.txt");
    expect(r.openapi.evidence.matched).toEqual(["openapi:3.1.0", "title:Acme API", "server:https://acme.com"]);
    expect(r.json_ld.evidence.matched).toContain("marker:astrant-jsonld");
    // The delivered Worker is not a JSON-RPC MCP server: the evidence says so.
    expect(r.mcp_server.url).toBe(`${MCP}/.well-known/mcp.json`);
    expect(r.mcp_server.evidence.note).toMatch(/^Astrant template protocol, not MCP JSON-RPC \(initialize got no JSON-RPC result \(HTTP 404\)\)/);
    expect(r.mcp_server.evidence.matched).toEqual([
      "tool:get_capabilities",
      "tool:get_pricing",
      "tool:get_case_studies",
      "tool:get_contact_tools",
      "name:Acme",
      "domain:acme.com",
      "call:get_capabilities",
    ]);
  });

  it("accepts CRLF-served copies and customer edits that keep the delivered structure", async () => {
    const edited = FILES["public/llms.txt"].replace("- Customer-maintained. Edit this section to describe", "- We build things. Describe");
    const { fetchImpl } = goodSite({ [`${SITE}/llms.txt`]: edited });
    const r = await run(fetchImpl, { expected: only("llms_txt") });
    expect(r.llms_txt.state).toBe("working");
    expect(r.llms_txt.evidence.note).toMatch(/differs from the delivered bytes/);
    const crlf = goodSite({ [`${SITE}/llms.txt`]: FILES["public/llms.txt"].split("\n").join("\r\n") });
    expect((await run(crlf.fetchImpl, { expected: only("llms_txt") })).llms_txt.evidence.note).toBe(
      "byte-identical to the delivered file",
    );
  });

  it("accepts a bare domain as siteUrl and uses only its origin", async () => {
    const { fetchImpl } = goodSite();
    const r = await run(fetchImpl, { siteUrl: "acme.com/some/page?x=1", expected: only("llms_txt") });
    expect(r.llms_txt.state).toBe("working");
  });
});

// ── llms.txt states ──────────────────────────────────────────────────────

describe("llms_txt states", () => {
  const ex = only("llms_txt");
  it("absent: 404 and 410", async () => {
    for (const status of [404, 410]) {
      const { fetchImpl } = goodSite({ [`${SITE}/llms.txt`]: new Response("", { status }) });
      const r = await run(fetchImpl, { expected: ex });
      expect(r.llms_txt).toMatchObject({ state: "absent", evidence: { status, note: `HTTP ${status}` } });
    }
  });
  it("absent: HTML soft 404 with status 200", async () => {
    const soft = new Response("<!doctype html><title>Not found</title>", { headers: { "content-type": "text/html" } });
    const r = await run(goodSite({ [`${SITE}/llms.txt`]: soft }).fetchImpl, { expected: ex });
    expect(r.llms_txt).toMatchObject({ state: "absent", evidence: { status: 200, note: expect.stringMatching(/soft 404/) } });
    // Mislabelled HTML (text/plain) is still a soft 404.
    const r2 = await run(goodSite({ [`${SITE}/llms.txt`]: "  <html><body>404</body></html>" }).fetchImpl, { expected: ex });
    expect(r2.llms_txt.state).toBe("absent");
  });
  it("blocked: 401/403/451 and a Cloudflare challenge", async () => {
    for (const status of [401, 403, 451]) {
      const r = await run(goodSite({ [`${SITE}/llms.txt`]: new Response("no", { status }) }).fetchImpl, { expected: ex });
      expect(r.llms_txt.state).toBe("blocked");
    }
    const challenge = new Response("<html>Just a moment</html>", { status: 403, headers: { "cf-mitigated": "challenge" } });
    const r = await run(goodSite({ [`${SITE}/llms.txt`]: challenge }).fetchImpl, { expected: ex });
    expect(r.llms_txt.evidence.note).toMatch(/WAF challenge/);
  });
  it("blocked: robots.txt disallows the path for * or an AI crawler", async () => {
    const all = goodSite({ [`${SITE}/robots.txt`]: "User-agent: *\nDisallow: /llms\n" });
    const r = await run(all.fetchImpl, { expected: ex });
    expect(r.llms_txt.state).toBe("blocked");
    expect(r.llms_txt.evidence.note).toMatch(/robots\.txt disallows \/llms\.txt for \*, GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot/);
    expect(r.llms_txt.evidence.matched?.length).toBeGreaterThan(0); // content was verified
    const gpt = goodSite({ [`${SITE}/robots.txt`]: "User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n" });
    const r2 = await run(gpt.fetchImpl, { expected: ex });
    expect(r2.llms_txt.state).toBe("blocked");
    expect(r2.llms_txt.evidence.note).toMatch(/for GPTBot$/);
  });
  it("robots.txt that is missing, HTML or unreachable does not block", async () => {
    for (const robots of [new Response("", { status: 404 }), new Response("<html>x</html>", { headers: { "content-type": "text/html" } })]) {
      const r = await run(goodSite({ [`${SITE}/robots.txt`]: robots }).fetchImpl, { expected: ex });
      expect(r.llms_txt.state).toBe("working");
    }
  });
  it("mismatch: a different llms.txt is served", async () => {
    const r = await run(goodSite({ [`${SITE}/llms.txt`]: "# Someone Else\n\n## Docs\n- [x](https://else.com)\n" }).fetchImpl, { expected: ex });
    expect(r.llms_txt).toMatchObject({ state: "mismatch", evidence: { note: "an llms.txt is served but it is not the delivered file" } });
    expect(r.llms_txt.evidence.missing).toContain("title:Acme");
  });
  it("mismatch: the delivered file was altered (a section removed)", async () => {
    const altered = FILES["public/llms.txt"].replace("## Capabilities", "## Stuff");
    const r = await run(goodSite({ [`${SITE}/llms.txt`]: altered }).fetchImpl, { expected: ex });
    expect(r.llms_txt.state).toBe("mismatch");
    expect(r.llms_txt.evidence.missing).toEqual(["section:Capabilities"]);
    expect(r.llms_txt.evidence.note).toMatch(/altered/);
  });
  it("mismatch: a hostile endless body is cut at the cap", async () => {
    const r = await run(goodSite({ [`${SITE}/llms.txt`]: () => endless() }).fetchImpl, { expected: ex });
    expect(r.llms_txt).toMatchObject({ state: "mismatch", evidence: { note: expect.stringMatching(/exceeds 524288 bytes/) } });
  });
  it("unobservable: 5xx, 429 and network errors", async () => {
    for (const status of [500, 503, 429]) {
      const r = await run(goodSite({ [`${SITE}/llms.txt`]: new Response("", { status }) }).fetchImpl, { expected: ex });
      expect(r.llms_txt.state).toBe("unobservable");
    }
    const r = await run(goodSite({ [`${SITE}/llms.txt`]: () => Promise.reject(new TypeError("ECONNRESET")) }).fetchImpl, { expected: ex });
    expect(r.llms_txt).toMatchObject({ state: "unobservable", evidence: { note: "network error" } });
  });
  it("unobservable: timeout (never-answering server)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { fetchImpl } = goodSite({ [`${SITE}/llms.txt`]: () => new Promise<Response>(() => {}) });
    const p = run(fetchImpl, { expected: ex });
    await vi.advanceTimersByTimeAsync(9000);
    const r = await p;
    expect(r.llms_txt).toMatchObject({ state: "unobservable", evidence: { note: "timed out" } });
  });
  it("unobservable: redirects to private addresses are refused and never fetched", async () => {
    for (const loc of ["http://127.0.0.1/llms.txt", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.1/", "http://localhost/x", "http://[::1]/"]) {
      const { calls, fetchImpl } = goodSite({ [`${SITE}/llms.txt`]: new Response(null, { status: 302, headers: { location: loc } }) });
      const r = await run(fetchImpl, { expected: ex });
      expect(r.llms_txt.state, loc).toBe("unobservable");
      expect(r.llms_txt.evidence.note).toMatch(/not a public http\(s\) address/);
      expect(calls, loc).toEqual([`${SITE}/llms.txt`]);
    }
  });
  it("follows a safe same-site redirect", async () => {
    const { fetchImpl } = goodSite({
      [`${SITE}/llms.txt`]: new Response(null, { status: 301, headers: { location: "https://www.acme.com/llms.txt" } }),
      "https://www.acme.com/llms.txt": FILES["public/llms.txt"],
    });
    expect((await run(fetchImpl, { expected: ex })).llms_txt.state).toBe("working");
  });
  it("a private or malformed siteUrl is never fetched", async () => {
    for (const siteUrl of ["http://127.0.0.1", "http://192.168.0.1", "file:///etc/passwd", "https://intranet.corp"]) {
      const { calls, fetchImpl } = goodSite();
      const r = await run(fetchImpl, { siteUrl, mcpUrl: null });
      expect(calls, siteUrl).toEqual([]);
      for (const c of Object.values(r)) expect(c.state).toBe("unobservable");
    }
  });
});

// ── OpenAPI states ───────────────────────────────────────────────────────

describe("openapi states", () => {
  const ex = only("openapi");
  const path = `${SITE}/openapi.yaml`;
  it("absent and blocked", async () => {
    expect((await run(goodSite({ [path]: new Response("", { status: 404 }) }).fetchImpl, { expected: ex })).openapi.state).toBe("absent");
    expect((await run(goodSite({ [path]: new Response("", { status: 403 }) }).fetchImpl, { expected: ex })).openapi.state).toBe("blocked");
  });
  it("mismatch: unparseable or not OpenAPI 3", async () => {
    for (const body of ["just text", "swagger: '2.0'\ninfo:\n  title: Acme API\n", "{not json", "openapi: 3.1.0\n\tinfo: x\n"]) {
      const r = await run(goodSite({ [path]: body }).fetchImpl, { expected: ex });
      expect(r.openapi.state, body).toBe("mismatch");
      expect(r.openapi.evidence.note).toMatch(/does not parse/);
    }
  });
  it("mismatch: a valid spec that is not ours", async () => {
    const r = await run(goodSite({ [path]: "openapi: 3.0.3\ninfo:\n  title: Other API\nservers:\n  - url: https://api.other.com\npaths: {}\n" }).fetchImpl, { expected: ex });
    expect(r.openapi.state).toBe("mismatch");
    expect(r.openapi.evidence.note).toMatch(/not the delivered spec/);
  });
  it("working: the customer extended paths[] and converted it to JSON", async () => {
    const json = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Acme API", version: "1" },
      servers: [{ url: "https://acme.com/" }],
      paths: { "/pets": { get: {}, post: {}, parameters: [] } },
    });
    const r = await run(goodSite({ [path]: json }).fetchImpl, { expected: ex });
    expect(r.openapi.state).toBe("working");
    expect(r.openapi.evidence.note).toMatch(/2 operations served, 0 delivered/);
  });
  it("mismatch: a delivered operation is missing", async () => {
    const withOps = FILES["public/openapi.yaml"].replace(
      "paths: {}",
      "paths:\n  /pets:\n    get:\n      summary: list\n    post:\n      summary: add\n  /pets/{id}:\n    delete: {}\n",
    );
    const exp = expectedFromDelivery({ files: { "public/openapi.yaml": withOps } });
    expect(exp.openapi?.paths).toEqual({ "/pets": ["get", "post"], "/pets/{id}": ["delete"] });
    expect(exp.openapi?.operationCount).toBe(3);
    const served = withOps.replace("    post:\n      summary: add\n", "");
    const r = await run(goodSite({ [path]: served }).fetchImpl, { expected: exp });
    expect(r.openapi.state).toBe("mismatch");
    expect(r.openapi.evidence.missing).toEqual(["op:POST /pets"]);
    expect(r.openapi.evidence.matched).toContain("op:GET /pets");
  });
  it("a block scalar cannot spoof info.title", () => {
    const p = parseOpenApi("openapi: 3.1.0\ninfo:\n  description: |\n    title: Acme API\n  title: Real\npaths: {}\n");
    expect(p?.title).toBe("Real");
  });
  it("items at the parent's indent are read (servers:\\n- url: x)", () => {
    const p = parseOpenApi("openapi: 3.1.0\ninfo:\n  title: Acme API\nservers:\n- url: https://acme.com\npaths: {}\n");
    expect(p?.servers).toEqual(["https://acme.com"]);
  });
});

// ── JSON-LD states ───────────────────────────────────────────────────────

describe("json_ld states", () => {
  const ex = only("json_ld");
  const html = (s: string, status = 200) => new Response(s, { status, headers: { "content-type": "text/html" } });
  it("absent: the homepage has no JSON-LD, or only unrelated types", async () => {
    let r = await run(goodSite({ [`${SITE}/`]: html(homepage("")) }).fetchImpl, { expected: ex });
    expect(r.json_ld).toMatchObject({ state: "absent", evidence: { missing: ["Organization", "Service"] } });
    r = await run(goodSite({ [`${SITE}/`]: html(homepage('<script type="application/ld+json">{"@type":"Product","name":"X"}</script>')) }).fetchImpl, { expected: ex });
    expect(r.json_ld.state).toBe("absent");
  });
  it("absent / blocked / unobservable from the homepage status", async () => {
    expect((await run(goodSite({ [`${SITE}/`]: html("", 404) }).fetchImpl, { expected: ex })).json_ld.state).toBe("absent");
    expect((await run(goodSite({ [`${SITE}/`]: html("", 403) }).fetchImpl, { expected: ex })).json_ld.state).toBe("blocked");
    expect((await run(goodSite({ [`${SITE}/`]: html("", 502) }).fetchImpl, { expected: ex })).json_ld.state).toBe("unobservable");
  });
  it("working: framework-rendered (no marker comments, @graph, attribute spelling, schema.org IRI types)", async () => {
    const ld = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "https://schema.org/Organization", name: "Acme", url: "https://acme.com" },
        { "@type": ["Service"], name: "Acme", serviceType: "Developer Tools", url: "https://acme.com/" },
      ],
    });
    const r = await run(goodSite({ [`${SITE}/`]: html(homepage(`<script type = application/ld+json>${ld}</script>`)) }).fetchImpl, { expected: ex });
    expect(r.json_ld.state).toBe("working");
    expect(r.json_ld.evidence.matched).not.toContain("marker:astrant-jsonld");
  });
  it("mismatch: our types present with altered fields", async () => {
    const altered = FILES["app/layout-jsonld.html"].replace('"serviceType": "Developer Tools"', '"serviceType": "Plumbing"');
    const r = await run(goodSite({ [`${SITE}/`]: html(homepage(altered)) }).fetchImpl, { expected: ex });
    expect(r.json_ld.state).toBe("mismatch");
    expect(r.json_ld.evidence.missing).toEqual(["Service.serviceType"]);
  });
  it("invalid ld+json blocks are counted, not fatal", async () => {
    const r = await run(goodSite({ [`${SITE}/`]: html(homepage(`<script type="application/ld+json">{oops</script>${FILES["app/layout-jsonld.html"]}`)) }).fetchImpl, { expected: ex });
    expect(r.json_ld.state).toBe("working");
    expect(r.json_ld.evidence.note).toMatch(/1 ld\+json block\(s\) are not valid JSON/);
  });
  it("hostile huge page: JSON-LD in the first 2 MB still counts; beyond it is unobservable", async () => {
    const head = new TextEncoder().encode(homepage().replace("</html>", ""));
    const big = (prefix: Uint8Array) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(prefix);
          },
          pull(c) {
            c.enqueue(new TextEncoder().encode("<p>".repeat(20000)));
          },
        }),
        { headers: { "content-type": "text/html" } },
      );
    let r = await run(goodSite({ [`${SITE}/`]: () => big(head) }).fetchImpl, { expected: ex });
    expect(r.json_ld.state).toBe("working");
    expect(r.json_ld.evidence.note).toMatch(/page exceeds/);
    r = await run(goodSite({ [`${SITE}/`]: () => big(new TextEncoder().encode("<html>")) }).fetchImpl, { expected: ex });
    expect(r.json_ld.state).toBe("unobservable");
  });
  it("robots.txt disallowing / blocks it", async () => {
    const r = await run(goodSite({ [`${SITE}/robots.txt`]: "User-agent: *\nDisallow: /\n" }).fetchImpl, { expected: ex });
    expect(r.json_ld.state).toBe("blocked");
  });
});

// ── MCP server states ────────────────────────────────────────────────────

/** A JSON-RPC MCP server (Streamable HTTP; tools/list answered as SSE). */
function jsonRpcServer(tools: string[], opts: { sse?: boolean } = {}): Handler {
  return async (_url, init) => {
    const msg = JSON.parse(String(init.body)) as { id?: string; method: string };
    if (msg.method === "initialize") {
      return Response.json(
        { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "x" } } },
        { headers: { "mcp-session-id": "sess-1" } },
      );
    }
    if (msg.method === "notifications/initialized") return new Response(null, { status: 202 });
    const payload = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: tools.map((name) => ({ name })) } });
    if (opts.sse) return new Response(`event: message\ndata: ${payload}\n\n`, { headers: { "content-type": "text/event-stream" } });
    return new Response(payload, { headers: { "content-type": "application/json" } });
  };
}

describe("mcp_server states", () => {
  const ex = only("mcp_server");
  const names = EXPECTED.mcp_server!.toolNames;
  it("working over MCP JSON-RPC (initialize -> initialized -> tools/list), JSON and SSE replies", async () => {
    for (const sse of [false, true]) {
      const seen: Array<{ method: string; headers: Headers }> = [];
      const server = jsonRpcServer(names, { sse });
      const { fetchImpl } = router({
        [`${MCP}/mcp`]: (url, init) => {
          seen.push({ method: JSON.parse(String(init.body)).method, headers: new Headers(init.headers) });
          return server(url, init);
        },
      });
      const r = await run(fetchImpl, { expected: ex, mcpUrl: `${MCP}/mcp` });
      expect(r.mcp_server.state).toBe("working");
      expect(r.mcp_server.evidence.note).toBe("MCP JSON-RPC: initialize + tools/list returned 4 tool(s)");
      expect(seen.map((s) => s.method)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
      expect(seen[2].headers.get("mcp-session-id")).toBe("sess-1");
    }
  });
  it("mismatch: tools/list lacks a delivered tool", async () => {
    const { fetchImpl } = router({ [`${MCP}/`]: jsonRpcServer(["get_capabilities", "something_else"]) });
    const r = await run(fetchImpl, { expected: ex });
    expect(r.mcp_server.state).toBe("mismatch");
    expect(r.mcp_server.evidence.missing).toEqual(["tool:get_pricing", "tool:get_case_studies", "tool:get_contact_tools"]);
  });
  it("mismatch: the template card belongs to someone else", async () => {
    const card = Response.json({ name: "Other", domain: "other.com", tools: names.map((name) => ({ name })) });
    const r = await run(goodSite({ [`${MCP}/.well-known/mcp.json`]: card }).fetchImpl, { expected: ex });
    expect(r.mcp_server.state).toBe("mismatch");
    expect(r.mcp_server.evidence.missing).toEqual(["name:Acme", "domain:acme.com"]);
  });
  it("mismatch: card lists the tools but /mcp/call does not answer", async () => {
    const r = await run(goodSite({ [`${MCP}/mcp/call`]: new Response("nope", { status: 500 }) }).fetchImpl, { expected: ex });
    expect(r.mcp_server.state).toBe("mismatch");
    expect(r.mcp_server.evidence.missing).toEqual(["call:get_capabilities"]);
  });
  it("absent: neither JSON-RPC nor the template card answers", async () => {
    const r = await run(router({}).fetchImpl, { expected: ex });
    expect(r.mcp_server).toMatchObject({ state: "absent", url: `${MCP}/.well-known/mcp.json` });
    const soft = await run(router({ [`${MCP}/.well-known/mcp.json`]: new Response("<html>hi</html>", { headers: { "content-type": "text/html" } }) }).fetchImpl, { expected: ex });
    expect(soft.mcp_server.state).toBe("absent");
  });
  it("blocked: 401/403 on initialize", async () => {
    for (const status of [401, 403]) {
      const r = await run(router({ [`${MCP}/`]: new Response("auth", { status }) }).fetchImpl, { expected: ex });
      expect(r.mcp_server.state).toBe("blocked");
    }
  });
  it("unobservable: no URL reported, private URL, network failure", async () => {
    expect((await run(router({}).fetchImpl, { expected: ex, mcpUrl: null })).mcp_server).toMatchObject({
      state: "unobservable",
      url: "",
      evidence: { note: expect.stringMatching(/no deployed MCP URL reported/) },
    });
    const { calls, fetchImpl } = router({});
    expect((await run(fetchImpl, { expected: ex, mcpUrl: "http://127.0.0.1:8787" })).mcp_server.state).toBe("unobservable");
    expect(calls).toEqual([]);
    const down = router({ [`${MCP}/`]: () => Promise.reject(new TypeError("fail")) });
    expect((await run(down.fetchImpl, { expected: ex })).mcp_server.evidence.note).toBe("initialize: network error");
  });
  it("hostile tools/list: oversized SSE reply stays bounded", async () => {
    const big = `data: ${"[".repeat(10)}\n\n`.repeat(300000);
    const server = jsonRpcServer(names);
    const { fetchImpl } = router({
      [`${MCP}/`]: async (url, init) => {
        const m = JSON.parse(String(init.body)).method;
        if (m === "tools/list") return new Response(big, { headers: { "content-type": "text/event-stream" } });
        return server(url, init);
      },
    });
    const t0 = Date.now();
    const r = await run(fetchImpl, { expected: ex });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(["mismatch", "unobservable"]).toContain(r.mcp_server.state);
  });
});

// ── Bounded parsers ──────────────────────────────────────────────────────

describe("bounded parsing of hostile content", () => {
  it("llms.txt link scan is linear on a pathological line", () => {
    const t0 = Date.now();
    const p = parseLlmsTxt("# T\n" + "](x)".repeat(100000) + "\n" + "[a](b)".repeat(1000));
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(p.links.length).toBeLessThanOrEqual(200);
  });
  it("JSON-LD node collection is capped in depth and count", () => {
    const deep = '{"@type":"Thing","child":'.repeat(5000) + "{}" + "}".repeat(5000);
    expect(collectLdNodes(`<script type="application/ld+json">${deep}</script>`).nodes.length).toBe(7); // depth cap 6
    const many = JSON.stringify(Array.from({ length: 5000 }, () => ({ "@type": "Thing" })));
    const { nodes } = collectLdNodes(`<script type="application/ld+json">${many}</script>`);
    expect(nodes.length).toBe(1000);
  });
  it("many unterminated <script tags do not go quadratic", () => {
    const t0 = Date.now();
    collectLdNodes("<script ".repeat(200000));
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it("YAML parser is linear on a large spec and gives up on paths past 20000", () => {
    const spec = (n: number) => {
      const lines = ["openapi: 3.1.0", "info:", "  title: Acme API", "paths:"];
      for (let i = 0; i < n; i++) lines.push(`  /p${i}:`, "    get:", "      summary: x");
      return lines.join("\n");
    };
    const t0 = Date.now();
    expect(Object.keys(parseOpenApi(spec(15000))?.paths ?? {}).length).toBe(15000);
    const huge = parseOpenApi(spec(100000));
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(huge?.title).toBe("Acme API");
    expect(huge?.paths).toBeNull();
  });
});

describe("robots.txt", () => {
  const g = parseRobots(
    "User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /private\nAllow: /private/llms.txt$\n\nUser-agent: *\nDisallow: /*.yaml$\n# comment\n",
  );
  it("groups consecutive user-agent lines; longest match wins; Allow wins ties", () => {
    expect(robotsAllows(g, "GPTBot", "/private/x")).toBe(false);
    expect(robotsAllows(g, "ClaudeBot", "/private/llms.txt")).toBe(true);
    expect(robotsAllows(g, "GPTBot", "/openapi.yaml")).toBe(true); // GPTBot has its own group
    expect(robotsAllows(g, "*", "/openapi.yaml")).toBe(false);
    expect(robotsAllows(g, "*", "/openapi.yaml.bak")).toBe(true);
    expect(robotsAllows(parseRobots("User-agent: *\nDisallow: /a\nAllow: /a\n"), "*", "/a")).toBe(true);
    expect(robotsAllows([], "*", "/")).toBe(true);
  });
  it("wildcard matching stays fast on hostile patterns", () => {
    const t0 = Date.now();
    const rules = parseRobots("User-agent: *\n" + `Disallow: /${"*a".repeat(200)}b\n`.repeat(50));
    expect(robotsAllows(rules, "*", "/" + "a".repeat(2000))).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
