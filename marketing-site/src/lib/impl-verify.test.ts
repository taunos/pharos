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
  specTextEqual,
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
// which the verifier does not read). No API operations are detected, so the
// OpenAPI generator skips its artifact (null) and the patch carries none.
async function deliveredFiles(): Promise<Record<string, string>> {
  const env = { SESSIONS: kv };
  const [llms, mcpConfig, openapi, jsonld] = await Promise.all([
    generateLlmsTxt(env, GEN_INPUT),
    generateMcpServerConfig(env, GEN_INPUT),
    generateOpenApi(env, GEN_INPUT),
    generateJsonLd(env, GEN_INPUT),
  ]);
  if (openapi !== null) throw new Error("expected the OpenAPI artifact to be skipped without operations");
  return {
    "public/llms.txt": llms,
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

// An OpenAPI spec as the generator emits it when operations are known.
const OPENAPI_SPEC = (await generateOpenApi({ SESSIONS: kv }, GEN_INPUT, [
  { method: "get", path: "/pets", summary: "list" },
  { method: "post", path: "/pets", summary: "add" },
  { method: "delete", path: "/pets/{id}" },
]))!;
const EXPECTED_OPENAPI: ExpectedArtifacts = {
  engine: EXPECTED.engine,
  openapi: expectedFromDelivery({ files: { "public/openapi.yaml": OPENAPI_SPEC } }).openapi,
};

// The real rendered Worker (mcp-server/index.ts), loaded as a module so the
// MCP check runs JSON-RPC end to end against delivered behaviour, not a mock.
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
    [`${SITE}/openapi.yaml`]: OPENAPI_SPEC,
    [`${SITE}/`]: new Response(homepage(), { headers: { "content-type": "text/html; charset=utf-8" } }),
    [`${SITE}/robots.txt`]: "User-agent: *\nAllow: /\n",
    [`${MCP}/`]: (url, init) => deliveredWorker.fetch(new Request(url, init), {}),
    [`${MCP}/.well-known/mcp.json`]: (url, init) => deliveredWorker.fetch(new Request(url, init), {}),
    [`${MCP}/mcp`]: (url, init) => deliveredWorker.fetch(new Request(url, init), {}),
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
    expect(FILES).not.toHaveProperty(["public/openapi.yaml"]);
    expect(EXPECTED.openapi).toBeUndefined();
    expect(EXPECTED_OPENAPI.openapi).toMatchObject({
      path: "/openapi.yaml",
      version: "3.1.0",
      title: "Acme API",
      servers: ["https://acme.com"],
      paths: { "/pets": ["get", "post"], "/pets/{id}": ["delete"] },
      operationCount: 3,
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
    expect(Object.keys(r)).toEqual(["llms_txt", "json_ld", "mcp_server"]);
    for (const c of Object.values(r)) {
      expect(c.state, `${c.artifact}: ${JSON.stringify(c.evidence)}`).toBe("working");
      expect(c.checkedAt).toBe("2026-11-05T12:00:00.000Z");
    }
    expect(r.llms_txt.evidence.note).toBe("byte-identical to the delivered file");
    expect(r.llms_txt.url).toBe("https://acme.com/llms.txt");
    expect(r.json_ld.evidence.matched).toContain("marker:astrant-jsonld");
    // The customer reported the bare workers.dev origin: initialize there 404s,
    // the Worker's card names /mcp, and the JSON-RPC check passes there.
    expect(r.mcp_server.url).toBe(`${MCP}/mcp`);
    expect(r.mcp_server.evidence.note).toBe(
      "MCP JSON-RPC: initialize + tools/list returned 4 tool(s); tools/call get_capabilities returned content",
    );
    expect(r.mcp_server.evidence.matched).toEqual([
      "tool:get_capabilities",
      "tool:get_pricing",
      "tool:get_case_studies",
      "tool:get_contact_tools",
      "call:get_capabilities",
      "name:Acme",
    ]);
    expect(r.mcp_server.evidence.missing).toBeUndefined();
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
  const ex = EXPECTED_OPENAPI;
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
  it("working: the delivered spec served unmodified", async () => {
    const r = await run(goodSite().fetchImpl, { expected: ex });
    expect(r.openapi.state).toBe("working");
    expect(r.openapi.evidence.matched).toEqual([
      "openapi:3.1.0",
      "title:Acme API",
      "server:https://acme.com",
      "op:GET /pets",
      "op:POST /pets",
      "op:DELETE /pets/{id}",
    ]);
    expect(r.openapi.evidence.note).toBe("byte-identical to the delivered file; 3 operations served, 3 delivered");
  });
  it("mismatch: the customer extended paths[] and converted it to JSON (working needs the delivered bytes)", async () => {
    const json = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Acme API", version: "1" },
      servers: [{ url: "https://acme.com/" }],
      paths: { "/pets": { get: {}, post: {}, parameters: [] }, "/pets/{id}": { delete: {}, put: {} } },
    });
    const r = await run(goodSite({ [path]: json }).fetchImpl, { expected: ex });
    expect(r.openapi.state).toBe("mismatch");
    expect(r.openapi.evidence.note).toMatch(/^live file differs from the delivered spec; 4 operations served, 3 delivered/);
  });
  it("mismatch: mixed mapping/sequence under a delivered operation (the parser never awards working)", async () => {
    const served = OPENAPI_SPEC.replace('      summary: "list"\n', '      summary: "list"\n      - broken\n');
    expect(served).not.toBe(OPENAPI_SPEC);
    const r = await run(goodSite({ [path]: served }).fetchImpl, { expected: ex });
    expect(r.openapi.state).toBe("mismatch");
  });
  it("mismatch: any edit, even one the parser reads as the same operations", async () => {
    const served = OPENAPI_SPEC.replace('summary: "list"', 'summary: "list all"');
    expect(served).not.toBe(OPENAPI_SPEC);
    const r = await run(goodSite({ [path]: served }).fetchImpl, { expected: ex });
    expect(r.openapi.state).toBe("mismatch");
    expect(r.openapi.evidence.missing ?? []).toEqual([]); // the parser sees every delivered operation
    expect(r.openapi.evidence.note).toMatch(/^live file differs from the delivered spec/);
  });
  it("mismatch: a body that differs only in its last byte", async () => {
    const served = OPENAPI_SPEC.replace(/.\n*$/, (m) => "#" + m.slice(1));
    expect(served).not.toBe(OPENAPI_SPEC);
    expect(served.length).toBe(OPENAPI_SPEC.length);
    expect((await run(goodSite({ [path]: served }).fetchImpl, { expected: ex })).openapi.state).toBe("mismatch");
  });
  it("hostile body: 10M newlines + 'a' is mismatch, fast, and never split into a huge array", async () => {
    const huge = "\n".repeat(10_000_000) + "a";
    const split = String.prototype.split;
    let biggestSplit = 0;
    const spy = vi.spyOn(String.prototype, "split").mockImplementation(function (this: string, ...args: unknown[]) {
      biggestSplit = Math.max(biggestSplit, this.length);
      return (split as (...a: unknown[]) => string[]).apply(this, args);
    });
    try {
      const t0 = Date.now();
      const r = await run(goodSite({ [path]: huge }).fetchImpl, { expected: ex });
      expect(Date.now() - t0).toBeLessThan(2000);
      expect(r.openapi.state).toBe("mismatch");
      expect(r.openapi.evidence.note).toMatch(/^live file differs from the delivered spec/);
      // Pathological inputs inside the length guard: the scan itself allocates nothing per line.
      const a = "\n".repeat(5_000_000) + "a";
      const b = "\n".repeat(5_000_000) + "b";
      expect(specTextEqual(a, b)).toBe(false);
      expect(specTextEqual(a + "\n\n  \r\n", a)).toBe(true);
      expect(specTextEqual(" ".repeat(5_000_000) + "x", " ".repeat(5_000_000) + "y")).toBe(false);
      expect(Date.now() - t0).toBeLessThan(4000);
      expect(biggestSplit).toBeLessThan(1_000_000);
    } finally {
      spy.mockRestore();
    }
  });
  it("specTextEqual: the normalization rules", () => {
    expect(specTextEqual("a\r\nb\r\n", "a\nb")).toBe(true);
    expect(specTextEqual("a \t\nb\t", "a\nb")).toBe(true);
    expect(specTextEqual("a\n\n\n", "a")).toBe(true);
    expect(specTextEqual("a\n  \nb", "a\n\nb")).toBe(true); // blank line with spaces = blank line
    expect(specTextEqual("a\nb", "a\n\nb")).toBe(false); // a missing middle line is a difference
    expect(specTextEqual("a b", "a  b")).toBe(false); // inner whitespace counts
    expect(specTextEqual(" a", "a")).toBe(false); // leading whitespace counts
    expect(specTextEqual("ab", "a")).toBe(false);
    expect(specTextEqual("", "\n \n")).toBe(true);
  });
  it("working: CRLF line endings, trailing spaces/tabs and a missing or extra final newline", async () => {
    const variants = [
      OPENAPI_SPEC.split("\n").join("\r\n"),
      OPENAPI_SPEC.split("\n").map((l) => (l ? l + " \t " : l)).join("\n"),
      OPENAPI_SPEC.replace(/\n+$/, ""),
      OPENAPI_SPEC + "\n\n",
    ];
    for (const served of variants) {
      expect(served).not.toBe(OPENAPI_SPEC);
      const r = await run(goodSite({ [path]: served }).fetchImpl, { expected: ex });
      expect(r.openapi.state, JSON.stringify(served.slice(0, 40))).toBe("working");
      expect(r.openapi.evidence.note).toMatch(/^(byte-identical to|matches) the delivered file/);
    }
  });
  it("mismatch: a delivered operation is missing", async () => {
    const served = OPENAPI_SPEC.replace('    post:\n      summary: "add"\n', "");
    expect(served).not.toBe(OPENAPI_SPEC);
    const r = await run(goodSite({ [path]: served }).fetchImpl, { expected: ex });
    expect(r.openapi.state).toBe("mismatch");
    expect(r.openapi.evidence.missing).toEqual(["op:POST /pets"]);
    expect(r.openapi.evidence.matched).toContain("op:GET /pets");
  });
  it("a block scalar cannot spoof info.title", () => {
    const p = parseOpenApi("openapi: 3.1.0\ninfo:\n  description: |\n    title: Acme API\n  title: Real\npaths: {}\n");
    expect(p?.title).toBe("Real");
  });
  it.each([
    ["unterminated flow sequence as a method value", "    get: [unterminated"],
    ["flow mapping as a method value", "    get: {summary: x}"],
    ["unterminated quoted value", '    get:\n      summary: "open'],
    ["anchor", "    get: &a x"],
    ["nested key under a scalar", "    get: x\n      summary: y"],
    ["second key on one line", "    get: summary: x"],
    ["line that is not key: value", "    get:\n      just words"],
    ["dedent to a column that never opened a mapping", "    get:\n      summary: list\n     bad: y"],
    ["dedent between two open levels", "    get:\n      summary: list\n   post:"],
  ])("invalid YAML under a path is not a delivered operation: %s", async (_name, op) => {
    const spec = `openapi: 3.1.0\ninfo:\n  title: "Acme API"\nservers:\n  - url: "https://acme.com"\npaths:\n  "/pets":\n${op}\n`;
    expect(parseOpenApi(spec)).toBeNull();
    const exp = expectedFromDelivery({
      files: { "public/openapi.yaml": `openapi: 3.1.0\ninfo:\n  title: "Acme API"\nservers:\n  - url: "https://acme.com"\npaths:\n  "/pets":\n    get:\n      summary: "list"\n` },
    });
    const r = await run(goodSite({ [path]: spec }).fetchImpl, { expected: { engine: exp.engine, openapi: exp.openapi } });
    expect(r.openapi.state).toBe("mismatch");
  });
  it("dedents back to open levels and items at the parent's indent still parse", () => {
    const p = parseOpenApi(
      "openapi: 3.1.0\ninfo:\n  title: Acme API\nservers:\n- url: https://acme.com\n  description: Prod\n" +
        "paths:\n  /pets:\n    get:\n      summary: list\n    post:\n      summary: add\n  /x:\n    get: {}\ncomponents: {}\n",
    );
    expect(p?.paths).toEqual({ "/pets": ["get", "post"], "/x": ["get"] });
  });
  it("the generator's own output still parses under the syntax gate", () => {
    const p = parseOpenApi(OPENAPI_SPEC);
    expect(p?.paths).toEqual({ "/pets": ["get", "post"], "/pets/{id}": ["delete"] });
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

/** A third-party JSON-RPC MCP server (Streamable HTTP, sessionful; replies optionally as SSE). */
function jsonRpcServer(tools: string[], opts: { sse?: boolean; name?: string } = {}): Handler {
  return async (_url, init) => {
    const msg = JSON.parse(String(init.body)) as { id?: string; method: string };
    if (msg.method === "initialize") {
      return Response.json(
        { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: opts.name ?? "Acme" } } },
        { headers: { "mcp-session-id": "sess-1" } },
      );
    }
    if (msg.method === "notifications/initialized") return new Response(null, { status: 202 });
    const result =
      msg.method === "tools/call" ? { content: [{ type: "text", text: "{}" }] } : { tools: tools.map((name) => ({ name })) };
    const payload = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result });
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
      expect(r.mcp_server.evidence.note).toBe(
        "MCP JSON-RPC: initialize + tools/list returned 4 tool(s); tools/call get_capabilities returned content",
      );
      expect(seen.map((s) => s.method)).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/call"]);
      expect(seen[2].headers.get("mcp-session-id")).toBe("sess-1");
      expect(seen[3].headers.get("mcp-protocol-version")).toBe("2025-06-18");
    }
  });
  it("working: the delivered Worker at its /mcp endpoint, end to end in-process", async () => {
    const methods: string[] = [];
    const { fetchImpl } = goodSite({
      [`${MCP}/mcp`]: (url, init) => {
        methods.push(JSON.parse(String(init.body)).method);
        return deliveredWorker.fetch(new Request(url, init), {});
      },
    });
    const r = await run(fetchImpl, { expected: ex, mcpUrl: `${MCP}/mcp` });
    expect(r.mcp_server).toMatchObject({ state: "working", url: `${MCP}/mcp` });
    expect(methods).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/call"]);
  });
  it("mismatch: tools/call does not return content", async () => {
    const worker: Handler = async (url, init) => {
      if (JSON.parse(String(init.body)).method === "tools/call") {
        return Response.json({ jsonrpc: "2.0", id: "verify-call", error: { code: -32602, message: "Unknown tool" } });
      }
      return deliveredWorker.fetch(new Request(url, init), {});
    };
    const r = await run(goodSite({ [`${MCP}/mcp`]: worker }).fetchImpl, { expected: ex });
    expect(r.mcp_server.state).toBe("mismatch");
    expect(r.mcp_server.evidence.missing).toEqual(["call:get_capabilities"]);
    expect(r.mcp_server.evidence.note).toMatch(/tools\/call get_capabilities: JSON-RPC error$/);
  });
  it("mismatch: serverInfo names another brand", async () => {
    const r = await run(router({ [`${MCP}/`]: jsonRpcServer(names, { name: "Other" }) }).fetchImpl, { expected: ex });
    expect(r.mcp_server.state).toBe("mismatch");
    expect(r.mcp_server.evidence.missing).toEqual(["name:Acme"]);
  });
  it("mismatch: tools/list lacks a delivered tool", async () => {
    const { fetchImpl } = router({ [`${MCP}/`]: jsonRpcServer(["get_capabilities", "something_else"]) });
    const r = await run(fetchImpl, { expected: ex });
    expect(r.mcp_server.state).toBe("mismatch");
    expect(r.mcp_server.evidence.missing).toEqual(["tool:get_pricing", "tool:get_case_studies", "tool:get_contact_tools"]);
  });
  it("mismatch: the legacy non-MCP template protocol (card + POST /mcp/call), even with every tool listed", async () => {
    // The pre-JSON-RPC delivered Worker: a card with no transports, tools via /mcp/call.
    const legacy = router({
      [`${MCP}/.well-known/mcp.json`]: Response.json({ name: "Acme", domain: "acme.com", tools: names.map((name) => ({ name })) }),
      [`${MCP}/mcp/call`]: Response.json({ brand: "Acme" }),
    });
    const r = await run(legacy.fetchImpl, { expected: ex });
    expect(r.mcp_server.state).toBe("mismatch");
    expect(r.mcp_server.url).toBe(`${MCP}/.well-known/mcp.json`);
    expect(r.mcp_server.evidence.note).toMatch(/^legacy non-MCP protocol: no MCP JSON-RPC endpoint answers \(initialize at /);
    expect(r.mcp_server.evidence.matched).toEqual(names.map((n) => `tool:${n}`));
    expect(legacy.calls).not.toContain(`${MCP}/mcp/call`);
  });
  it("mismatch: the card names an endpoint that does not speak JSON-RPC either", async () => {
    const card = Response.json({ name: "Acme", transports: [{ type: "streamable-http", url: "/mcp" }], tools: [] });
    const r = await run(router({ [`${MCP}/.well-known/mcp.json`]: card }).fetchImpl, { expected: ex });
    expect(r.mcp_server.state).toBe("mismatch");
    expect(r.mcp_server.evidence.note).toMatch(/card endpoint https:\/\/astrant-mcp-acme\.acct\.workers\.dev\/mcp got no JSON-RPC result either \(HTTP 404\)/);
    expect(r.mcp_server.evidence.missing).toEqual(names.map((n) => `tool:${n}`));
  });
  it("a card endpoint on another origin is never fetched", async () => {
    const card = Response.json({ name: "Acme", transports: [{ type: "streamable-http", url: "https://evil.example/mcp" }], tools: [] });
    const { calls, fetchImpl } = router({ [`${MCP}/.well-known/mcp.json`]: card });
    const r = await run(fetchImpl, { expected: ex });
    expect(r.mcp_server.state).toBe("mismatch");
    expect(calls.some((c) => c.startsWith("https://evil.example"))).toBe(false);
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
  it.each(["initialize", "tools/list", "tools/call"])(
    "a valid %s reply padded past the cap is mismatch, never working (prefix not parsed)",
    async (method) => {
      const server = jsonRpcServer(names);
      const pad = " ".repeat(3 * 1024 * 1024);
      const { fetchImpl } = router({
        [`${MCP}/`]: async (url, init) => {
          const res = await server(url, init);
          if (JSON.parse(String(init.body)).method !== method) return res;
          return new Response((await res.text()) + pad, { headers: res.headers });
        },
      });
      const r = await run(fetchImpl, { expected: ex });
      expect(r.mcp_server.state).toBe("mismatch");
      expect(r.mcp_server.evidence.note).toMatch(/reply exceeds \d+ bytes/);
    },
  );
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
