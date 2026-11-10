// Report truthfulness r3 (1.4.0): the report must not state false things
// about what a site has. Fixtures only (every fetch is stubbed, no network).
// Files under fixtures/r3 are real responses fetched with plain GETs on
// 2026-11-07 (ugmonk.com, linear.app, resend.com, metalab.com, drveit.com.br,
// rachelqueiroz.com; contact details in the Rachel Queiroz JSON-LD replaced).
// MCP POST replies are constructed from the observed behaviour in
// _tmp/audit-eval/findings-before.md (no POST was sent to build fixtures).
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { runDim1, extractLinks, NO_MARKDOWN_LINKS_NOTE } from "./checks/dim1-llmstxt";
import { runDim2, normalizeCard, mcpAuthRequiredNote, DIM2_CONTENT_ONLY_NA_NOTE, DNS_TXT_INFO_NOTE } from "./checks/dim2-mcp";
import { runDim3, DIM3_NO_API_NA_NOTE } from "./checks/dim3-openapi";
import { runDim4, notFullyInspectedNote, FAQ_NO_ANSWERS_NOTE } from "./checks/dim4-structured";
import { runDim5, caseStudyRank, countPeriodOrOneTimePrices, isExcludedContentPath, CASE_STUDY_NA_NOTE, pageWeightNote } from "./checks/dim5-parsable";
import { gatherSiteSignals, linkSignals } from "./checks/site-signals";
import { runScan } from "./run-scan";
import type { DimensionResult, SubCheck } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const fx = (name: string) => readFileSync(new URL(`./fixtures/r3/${name}`, import.meta.url), "utf8");
const fxJson = <T = unknown>(name: string) => JSON.parse(fx(name)) as T;

const env = (ai: () => unknown = () => ({ response: "50" })) =>
  ({
    CACHE: { get: async () => null, put: async () => {} },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) },
    AI: { run: async () => ai() },
  }) as never;

type Call = { url: string; method: string; body: string };
type Route = (init: RequestInit) => Response | Promise<Response>;
function routes(map: Record<string, Route>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string, init: RequestInit = {}) => {
      calls.push({ url: String(u), method: String(init.method ?? "GET"), body: String(init.body ?? "") });
      return (map[String(u)] ?? (() => new Response("", { status: 404 })))(init);
    })
  );
  return calls;
}
const html = (s: string) => () => new Response(s, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
const text = (s: string, type = "text/plain; charset=utf-8") => () => new Response(s, { status: 200, headers: { "content-type": type } });
const json = (v: unknown, type = "application/json") => () => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": type } });
const page = (opts: { ld?: unknown[]; hrefs?: string[]; body?: string }) =>
  `<!doctype html><html><head><title>t</title>${(opts.ld ?? [])
    .map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`)
    .join("")}</head><body>${(opts.hrefs ?? []).map((h) => `<a href="${h}">link</a>`).join(" ")}${opts.body ?? ""}</body></html>`;
const sub = (d: DimensionResult, id: string) => d.sub_checks.find((s) => s.id === id) as SubCheck;
const dim = (r: { dimensions: DimensionResult[] }, id: number) => r.dimensions.find((d) => d.dimension_id === id)!;
const scan = (url: string) => runScan(env(), url, "free", { useCache: false, throwOnInsertFail: false });

/** A Streamable HTTP MCP server (JSON replies) answering initialize and tools/list. */
const mcpServer = (tools: unknown[]): Route => (init) => {
  if (String(init.method).toUpperCase() !== "POST") return new Response("Not Found", { status: 404, headers: { "content-type": "text/html" } });
  const msg = JSON.parse(String(init.body)) as { id?: string; method: string };
  if (msg.method === "initialize")
    return json({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "storefront" } } })();
  if (msg.method === "tools/list") return json({ jsonrpc: "2.0", id: msg.id, result: { tools } })();
  return new Response(null, { status: 202 });
};
const SHOPIFY_TOOLS = [
  { name: "search_shop_catalog", description: "Search the store's product catalog.", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
  { name: "get_cart", description: "Get the current cart.", inputSchema: { type: "object", properties: {} } },
  { name: "update_cart", description: "Add or remove cart lines.", inputSchema: { type: "object", properties: {} } },
];
/** mcp.linear.app/mcp's real anonymous answer (GET, 2026-11-07): 401 with a Bearer challenge. */
const oauthChallenge: Route = () =>
  new Response("", {
    status: 401,
    headers: { "www-authenticate": 'Bearer realm="OAuth", resource_metadata="https://mcp.linear.app/.well-known/oauth-protected-resource/mcp", scope="read write"' },
  });

// ── 1. N1: Dim 2 N/A only on positive absence ─────────────────────────────

describe("1.4.0 N1 ugmonk (Shopify): the live MCP server is found, Dim 2 is scored", () => {
  const UG = "https://ugmonk.com/";
  const home = fxJson<{ ld: unknown[]; hrefs: string[] }>("ugmonk-home.json");
  const product = fxJson<unknown[]>("ugmonk-product-ld.json");
  const site = () =>
    routes({
      [UG]: html(page({ ld: home.ld, hrefs: home.hrefs })),
      "https://ugmonk.com/llms.txt": text(fx("ugmonk-llms.txt"), "text/markdown; charset=utf-8"),
      "https://ugmonk.com/.well-known/ucp": text(fx("ugmonk-ucp.json"), "application/json; charset=utf-8"),
      "https://ugmonk.com/api/mcp": mcpServer(SHOPIFY_TOOLS),
      "https://ugmonk.com/products/ugmonk-utility-tote-field-tan": html(page({ ld: product })),
      // The real /index.md answers 200 with the HTML homepage.
      "https://ugmonk.com/index.md": html(page({ hrefs: home.hrefs })),
    });

  it("full scan: Dim 2 scored, /api/mcp credited, the UCP profile named, no false N/A", async () => {
    const calls = site();
    const r = await scan(UG);
    const d2 = dim(r, 2);
    expect(d2.na).toBeUndefined();
    expect(sub(d2, "live_invocation")).toMatchObject({ score: 100, passed: true, notes: "tools/list returned 3 tools" });
    expect(sub(d2, "well_known").notes).toContain("an MCP server was found (an MCP endpoint answered at https://ugmonk.com/api/mcp) but it is not advertised with a server card");
    expect(sub(d2, "dns_txt")).toMatchObject({ na: true });
    expect(d2.score).toBe(Math.round((0 * 30 + 0 * 20 + 100 * 25) / 75));
    // The UCP endpoint is on another host (ugmonk-2.myshopify.com): never probed.
    expect(calls.some((c) => c.url.includes("myshopify.com"))).toBe(false);
    // /api/mcp answered with tools, so the declared https://ugmonk.com/api/ucp/mcp
    // (llms.txt) needs no probe: 3 POSTs in all (initialize, initialized, tools/list).
    expect(calls.filter((c) => c.method === "POST").map((c) => c.url)).toEqual(Array(3).fill("https://ugmonk.com/api/mcp"));
  });

  it("with /api/mcp down, the UCP profile alone still keeps Dim 2 scored and is named", async () => {
    routes({
      [UG]: html(page({ ld: home.ld })),
      "https://ugmonk.com/.well-known/ucp": text(fx("ugmonk-ucp.json"), "application/json; charset=utf-8"),
    });
    const d2 = await runDim2(UG, env(), true);
    expect(d2.na).toBeUndefined();
    expect(sub(d2, "well_known").notes).toContain(
      "the /.well-known/ucp profile declares an MCP endpoint (https://ugmonk-2.myshopify.com/api/ucp/mcp)"
    );
    expect(sub(d2, "live_invocation").notes).toBe(
      "no MCP endpoint answered: no server card with a transport URL, and https://ugmonk.com/api/mcp did not answer an MCP initialize request"
    );
  });

  it("F26: the 5 KB prose llms.txt is not an 'empty file'", async () => {
    site();
    const d1 = await runDim1(UG, env());
    expect(sub(d1, "curation_quality").notes).not.toContain("empty file");
    expect(sub(d1, "curation_quality").score).toBeGreaterThan(0);
    expect(extractLinks(fx("ugmonk-llms.txt")).length).toBe(8);
  });

  it("F17: no Product on the homepage, so one product page is sampled and its Product + Offer count", async () => {
    site();
    const s = sub(await runDim4(UG, env()), "service_offer_schema");
    expect(s).toMatchObject({ score: 100, passed: true });
    expect(s.notes).toContain("on the sampled product page https://ugmonk.com/products/ugmonk-utility-tote-field-tan; none on the homepage");
    expect(s.evidence?.requested_url).toBe("https://ugmonk.com/products/ugmonk-utility-tote-field-tan");
  });

  it("F30 / F33: /index.md served as HTML is no markdown variant; /account/login is no case study", async () => {
    const calls = site();
    const d5 = await runDim5(UG, env(), "free");
    // 1.5.0: informational (N/A); the note says what was found.
    expect(sub(d5, "markdown_negotiation")).toMatchObject({ na: true, score: 0 });
    expect(sub(d5, "markdown_negotiation").notes).toMatch(/^We found no Markdown version at the addresses we checked /);
    const cs = sub(d5, "case_study_scannability");
    expect(cs.notes).not.toContain("account");
    expect(cs).toMatchObject({ na: true, notes: CASE_STUDY_NA_NOTE });
    expect(calls.some((c) => c.url.includes("/account/login"))).toBe(false);
  });
});

describe("1.4.0 N1 linear: the official remote MCP and the GraphQL API are evidence", () => {
  const LIN = "https://linear.app/";
  const site = () =>
    routes({
      [LIN]: html(page({ hrefs: fxJson<string[]>("linear-home-hrefs.json") })),
      "https://linear.app/llms.txt": text(fx("linear-llms.txt")),
      "https://mcp.linear.app/mcp": oauthChallenge,
    });

  it("Dim 2 scored; the OAuth-protected endpoint is credited (75), not 'can't discover'", async () => {
    site();
    const r = await scan(LIN);
    const d2 = dim(r, 2);
    expect(d2.na).toBeUndefined();
    expect(sub(d2, "live_invocation")).toMatchObject({ score: 75, passed: true, notes: mcpAuthRequiredNote("https://mcp.linear.app/mcp") });
    expect(d2.sub_checks.map((s) => s.notes).join(" ")).not.toMatch(/content-only|no MCP endpoint found/i);
  });

  it("F13: Dim 3 is N/A without OpenAPI, and its note says the site has an API (not 'content-only')", async () => {
    site();
    const d3 = dim(await scan(LIN), 3);
    expect(d3.na).toBe(true);
    const note = d3.sub_checks[0].notes;
    expect(note).not.toMatch(/content-only from an API-catalog/);
    expect(note).toContain("The site does show API evidence (a link to https://linear.app/developers");
    expect(note).toContain("not because there is no API");
  });

  it("signals: the bare MCP URL in the llms.txt blockquote and the /developers links are found", () => {
    const s = linkSignals(LIN, [{ text: fx("linear-llms.txt"), base: "https://linear.app/llms.txt" }]);
    expect(s.mcpUrls).toContain("https://mcp.linear.app/mcp");
    expect(s.apiSignals.some((x) => x.includes("https://linear.app/developers/"))).toBe(true);
    // A docs page about MCP (/docs/mcp.md) is not an endpoint.
    expect(s.mcpUrls.some((u) => u.endsWith("/docs/mcp.md"))).toBe(false);
  });
});

describe("1.4.0 N1 positive absence and the GraphQL probe", () => {
  const ACME = "https://acme.com/";
  const PLAIN = page({ hrefs: ["/about", "/contact", "https://instagram.com/acme"], body: "<h1>Acme Bakery</h1><p>Bread.</p>" });

  it("no evidence anywhere => Dim 2 N/A with the precise note, Dim 3 N/A with the no-API note", async () => {
    const calls = routes({ [ACME]: html(PLAIN) });
    const r = await scan(ACME);
    expect(dim(r, 2)).toMatchObject({ na: true });
    expect(dim(r, 2).sub_checks[0].notes).toBe(DIM2_CONTENT_ONLY_NA_NOTE);
    expect(DIM2_CONTENT_ONLY_NA_NOTE).toMatch(/^No supported MCP discovery signal was found/);
    expect(DIM2_CONTENT_ONLY_NA_NOTE).not.toMatch(/content-only site|no MCP endpoint found/i);
    expect(dim(r, 3).sub_checks[0].notes).toBe(DIM3_NO_API_NA_NOTE);
    // Extra requests for a content site: /.well-known/ucp, POST /api/mcp and
    // the two GraphQL GETs (no link evidence) - 4 in all.
    const extra = calls.filter(
      (c) =>
        c.url === "https://acme.com/.well-known/ucp" ||
        c.url === "https://acme.com/api/mcp" ||
        c.url === "https://acme.com/graphql" ||
        c.url === "https://api.acme.com/graphql"
    );
    expect(extra.length).toBe(4);
  });

  it("a GraphQL endpoint answering JSON errors (api.linear.app's real reply shape) is API evidence", async () => {
    routes({
      [ACME]: html(PLAIN),
      "https://api.acme.com/graphql": () =>
        new Response(JSON.stringify({ errors: [{ message: "This operation has been blocked as a potential Cross-Site Request Forgery (CSRF)." }] }), {
          status: 400,
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
    });
    const r = await scan(ACME);
    expect(dim(r, 2).na).toBeUndefined();
    expect(dim(r, 3).sub_checks[0].notes).toContain("a GraphQL endpoint answering at https://api.acme.com/graphql");
  });

  it("an HTML 200 at /graphql (linear.app's SPA fallback) is not GraphQL", async () => {
    routes({ [ACME]: html(PLAIN), "https://acme.com/graphql": html(fx("linear-case-studies-shell.html")) });
    const s = await gatherSiteSignals(ACME, null, { html: PLAIN, url: ACME });
    expect(s.apiSignals).toEqual([]);
  });

  it("links to other sites' API docs or MCP pages are not evidence for this site; /api/og images are not an API", () => {
    const s = linkSignals(ACME, [
      {
        text: '<a href="https://shopify.dev/docs/api/web-mcp">x</a><meta content="https://acme.com/api/og?t=1"><a href="/api/auth/login">x</a>',
        base: ACME,
      },
    ]);
    expect(s).toEqual({ mcpUrls: [], apiSignals: [] });
  });

  it("a guessed /api/mcp that only answers 401 is not MCP evidence", async () => {
    routes({ [ACME]: html(PLAIN), "https://acme.com/api/mcp": oauthChallenge });
    expect((await runDim2(ACME, env(), true)).na).toBe(true);
  });
});

// ── 2. F6 / F8: server-card shapes ───────────────────────────────────────

describe("1.4.0 F6 / F8 resend: the real server card is read correctly", () => {
  const RS = "https://resend.com/";
  it("name, remote.url (streamable-http), oauth2 and 12 described tools; OAuth metadata from the declared server", async () => {
    const calls = routes({
      "https://resend.com/.well-known/mcp.json": text(fx("resend-mcp.json"), "application/json"),
      "https://api.resend.com/.well-known/oauth-authorization-server": text(fx("resend-oauth-as.json"), "application/json; charset=utf-8"),
      "https://mcp.resend.com/mcp": oauthChallenge,
    });
    const d2 = await runDim2(RS, env());
    expect(sub(d2, "well_known")).toMatchObject({ score: 100, notes: 'valid card at /.well-known/mcp.json with name="Resend", transports=1' });
    expect(sub(d2, "tool_coverage").notes).toBe("12 tool(s) declared: 12 with a description, 0 with an input schema (inputSchema); 0 have both");
    expect(sub(d2, "oauth_metadata")).toMatchObject({ score: 100, notes: "auth=oauth2; OAuth metadata valid" });
    expect(d2.sub_checks.map((s) => s.notes).join(" ")).not.toMatch(/no auth declared|no transport URL|missing name/);
    expect(sub(d2, "live_invocation").notes).toBe(mcpAuthRequiredNote("https://mcp.resend.com/mcp"));
    expect(calls[2].url).toBe("https://api.resend.com/.well-known/oauth-authorization-server");
  });

  it("normalizeCard reads the resend server-card.json, registry server.json and SEP-1649 shapes", () => {
    expect(normalizeCard(fxJson("resend-server-card.json"))).toMatchObject({
      name: "resend",
      transports: [{ url: "https://mcp.resend.com/mcp", type: "streamable-http" }],
      authType: "oauth2",
      authServer: "https://api.resend.com",
    });
    expect(
      normalizeCard({ name: "io.github.acme/acme", remotes: [{ type: "streamable-http", url: "https://mcp.acme.com/mcp" }] })
    ).toMatchObject({ name: "io.github.acme/acme", transports: [{ url: "https://mcp.acme.com/mcp", type: "streamable-http" }], authType: null });
    expect(
      normalizeCard({
        serverInfo: { name: "acme", version: "1" },
        transport: { type: "streamable-http", endpoint: "/mcp" },
        authentication: { required: true, schemes: ["oauth2"] },
      })
    ).toMatchObject({ name: "acme", transports: [{ url: "/mcp", type: "streamable-http" }], authType: "oauth2" });
  });

  it("tools with input_schema count as having a schema", async () => {
    routes({
      "https://acme.com/.well-known/mcp.json": json({
        name: "acme",
        tools: ["a", "b", "c"].map((n) => ({ name: n, description: `does ${n}`, input_schema: { type: "object" } })),
      }),
    });
    expect(sub(await runDim2("https://acme.com/", env()), "tool_coverage")).toMatchObject({ score: 100 });
  });

  it("12 described tools without inputSchema score tool_coverage 70 and pass", async () => {
    routes({
      "https://acme.com/.well-known/mcp.json": json({
        name: "acme",
        tools: Array.from({ length: 12 }, (_, i) => ({ name: `tool_${i}`, description: `does thing ${i}` })),
      }),
    });
    expect(sub(await runDim2("https://acme.com/", env()), "tool_coverage")).toMatchObject({
      score: 70,
      passed: true,
      notes: "12 tool(s) declared: 12 with a description, 0 with an input schema (inputSchema); 0 have both",
    });
  });
});

// ── 3. F11 / F12: API catalog linkset ────────────────────────────────────

describe("1.4.0 F11 / F12 resend: the API catalog's service-desc spec is scored, not the linkset", () => {
  it("follows the linkset to /openapi.yaml (same site); 1.5.0: the YAML spec is scored in full", async () => {
    // resend-openapi-trimmed.yaml: the real file cut to info, security, tags,
    // the first 4 paths (6 operations) and components.securitySchemes.
    routes({
      "https://resend.com/.well-known/api-catalog": text(fx("resend-api-catalog.json"), "application/linkset+json"),
      "https://resend.com/openapi.yaml": text(fx("resend-openapi-trimmed.yaml"), "text/yaml; charset=utf-8"),
    });
    const d3 = await runDim3("https://resend.com/", env());
    expect(d3.na).toBeUndefined();
    expect(d3.sub_checks.every((s) => !s.na)).toBe(true);
    expect(sub(d3, "discovery").notes).toContain("Read through the API catalog at https://resend.com/.well-known/api-catalog (its service-desc link).");
    expect(sub(d3, "spec_validity")).toMatchObject({ score: 100, notes: "Valid YAML spec, openapi 3.0.3." });
    expect(sub(d3, "info_completeness")).toMatchObject({ score: 100, notes: "info: title=yes, version=yes, description=yes (3/3)" });
    expect(sub(d3, "security_schemes")).toMatchObject({ score: 100, notes: "components.securitySchemes declared: bearerAuth." });
    expect(sub(d3, "operation_coverage")).toMatchObject({ score: 100 });
    expect(sub(d3, "operation_coverage").notes).toContain("6 operation(s); 6/6 have a summary or description.");
    expect(d3.sub_checks.map((s) => s.notes).join(" ")).not.toMatch(/missing the "info"|no "openapi"|missing "paths"|Not measured|partial credit/);
    expect(d3.score).toBe(100);
  });

  it("a service-desc on another site is not fetched; the spec checks are 'not measured'", async () => {
    const calls = routes({
      "https://acme.com/.well-known/api-catalog": json({ linkset: [{ anchor: "https://acme.com", "service-desc": [{ href: "https://specs.example.org/acme.yaml" }] }] }, "application/linkset+json"),
    });
    const d3 = await runDim3("https://acme.com/", env());
    expect(calls.some((c) => c.url.includes("example.org"))).toBe(false);
    expect(sub(d3, "spec_validity")).toMatchObject({ na: true });
    expect(sub(d3, "spec_validity").notes).toContain("on another site, which the scanner does not fetch");
    expect(d3.score).toBe(100);
  });
});

// ── 4. F26: llms.txt links ────────────────────────────────────────────────

describe("1.4.0 F26: llms.txt link counting", () => {
  it("counts inline links, skips images, keeps the first token of a titled link", () => {
    expect(extractLinks('See [docs](https://a.com/d) and [b](/b "Title"). ![img](/i.png)\n- [c](https://a.com/c)')).toEqual([
      "https://a.com/d",
      "/b",
      "https://a.com/c",
    ]);
  });

  it("'empty file' only for an empty file; a file without links says so", async () => {
    routes({ "https://acme.com/llms.txt": text("   ") });
    expect(sub(await runDim1("https://acme.com/", env()), "curation_quality").notes).toBe("empty file — no links to evaluate");
    routes({ "https://acme.com/llms.txt": text("# Acme\n\nWe bake bread.") });
    expect(sub(await runDim1("https://acme.com/", env()), "curation_quality").notes).toBe(NO_MARKDOWN_LINKS_NOTE);
  });

  it("hostile text stays fast", () => {
    const t0 = Date.now();
    extractLinks("[".repeat(200000) + "](" + "a".repeat(200000));
    extractLinks("](".repeat(200000));
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

// ── 5. F30: markdown needs a markdown body ───────────────────────────────

// 1.5.0: markdown_negotiation is informational (N/A, score 0); what the
// check found is read from its note.
describe("1.4.0 F30: markdown variant / negotiation need a markdown body", () => {
  const ACME = "https://acme.com/";
  it("Accept: text/markdown answered with text/markdown but an HTML body => not negotiation", async () => {
    routes({ [ACME]: (init) => (new Headers(init.headers).get("accept") === "text/markdown" ? text("<!doctype html><html><body>x</body></html>", "text/markdown")() : html("<html><body>x</body></html>")()) });
    expect(sub(await runDim5(ACME, env(), "free"), "markdown_negotiation").notes).toMatch(/^We found no Markdown version at the addresses we checked /);
  });

  it("a real text/plain markdown body at /index.md => .md variant found", async () => {
    routes({ [ACME]: html("<html><body>x</body></html>"), "https://acme.com/index.md": text("# Acme\n\n> We bake bread.") });
    expect(sub(await runDim5(ACME, env(), "free"), "markdown_negotiation").notes).toMatch(/^\.md variant exists at https:\/\/acme\.com\/index\.md /);
  });

  it("linear-style negotiation (text/markdown with a markdown body) => negotiation found", async () => {
    routes({ [ACME]: (init) => (new Headers(init.headers).get("accept") === "text/markdown" ? text("# Linear\n\n> Plan.", "text/markdown; charset=utf-8")() : html("<html><body>x</body></html>")()) });
    const m = sub(await runDim5(ACME, env(), "free"), "markdown_negotiation");
    expect(m.notes).toMatch(/^Accept: text\/markdown returns text\/markdown/);
    expect(m).toMatchObject({ na: true, score: 0, passed: false });
  });
});

// ── 6. F31: billing periods ──────────────────────────────────────────────

describe("1.4.0 F31: price period suffix", () => {
  it.each([
    ["Engineering teams $30 / per user per month Unlimited pairing", 1], // tuple.app/pricing, real text
    ["$30 per month", 1],
    ["$12/mo", 1],
    ["$99/yr", 1],
    ["$10 a month", 1],
    ["$10 monthly", 1],
    ["$8 per seat / month", 1],
    ["R$ 49,90/mês", 1],
    ["R$ 49,90 por mês", 1],
    ["R$ 49,90 mensal", 1],
    ["US$ 20 /mes", 1],
    ["29 € / mois", 1],
    ["29 € par mois", 1],
    ["29 EUR /Monat", 1],
    ["29 EUR pro Monat", 1],
    ["$499 one-time", 1],
    ["R$ 297 pagamento único", 1],
    ["$30 promo code", 0],
    ["$30 for the bundle", 0],
  ])("%j => %i", (s, n) => {
    expect(countPeriodOrOneTimePrices(s)).toBe(n);
  });

  it("tuple.app: the single '$30 / per user per month' price scores 100 (was 50, 'none with /period suffix')", async () => {
    routes({
      "https://tuple.app/": html("<html><body><a href='/pricing'>Pricing</a></body></html>"),
      "https://tuple.app/pricing": html("<html><body><h2>Engineering teams</h2><p>$30 / per user per month</p><p>Unlimited pairing sessions</p></body></html>"),
    });
    const p = sub(await runDim5("https://tuple.app/", env(), "free"), "pricing_text_visibility");
    expect(p).toMatchObject({ score: 100 });
    expect(p.notes).toContain("1 with a billing period or marked one-time");
  });
});

// ── 7 / 8. F32 / F33: case studies ───────────────────────────────────────

describe("1.4.0 F32 / F33: content paths and case studies", () => {
  it.each(["/account/login", "/login", "/signin", "/cart", "/checkout", "/admin", "/wp-login.php", "/auth/callback", "/customers/account"])(
    "%s is excluded",
    (p) => expect(isExcludedContentPath(p)).toBe(true)
  );

  it("a 'pricing' link into an account area is not the pricing page", async () => {
    const calls = routes({
      "https://acme.com/": html("<html><body><a href='/account/pricing'>Pricing</a></body></html>"),
      "https://acme.com/account/pricing": html("<p>$9/mo</p>"),
    });
    expect(sub(await runDim5("https://acme.com/", env(), "free"), "pricing_text_visibility").na).toBe(true);
    expect(calls.some((c) => c.url.includes("/account/"))).toBe(false);
  });

  it("multilingual words rank; unrelated paths do not match", () => {
    expect(caseStudyRank("/casos-clinicos/")).toBeGreaterThanOrEqual(0);
    expect(caseStudyRank("/r%C3%A9alisations")).toBeGreaterThanOrEqual(0);
    expect(caseStudyRank("/kunden")).toBeGreaterThanOrEqual(0);
    expect(caseStudyRank("/case-studies")).toBeLessThan(caseStudyRank("/projetos-sociais/"));
    expect(caseStudyRank("/workshop")).toBe(-1);
    expect(caseStudyRank("/account/login")).toBe(-1);
  });

  // 1.4.1: a sampled page needs 500+ characters of server-side text to be measured.
  const STUDY_PROSE = "<p>" + "We worked with the client on this project from start to finish. ".repeat(10) + "</p>";
  const STUDY = `<html><body><h2>Challenge</h2><h2>Solution</h2><h3>Results</h3><ul><li>a</li></ul><strong>Quote</strong>${STUDY_PROSE}</body></html>`;

  it("resend /customers is an index: one linked study is scored instead of the index", async () => {
    const hrefs = fxJson<string[]>("resend-customers-hrefs.json");
    const calls = routes({
      "https://resend.com/": html(page({ hrefs: ["/customers", "/pricing"] })),
      "https://resend.com/customers": html(page({ hrefs, body: "<p>" + "Customer stories. ".repeat(20) + "</p>" })),
      "https://resend.com/customers/gumroad": html(STUDY),
    });
    const c = sub(await runDim5("https://resend.com/", env(), "free"), "case_study_scannability");
    expect(c).toMatchObject({ score: 100 });
    expect(c.notes).toContain("https://resend.com/customers/gumroad → 100");
    expect(c.notes).toContain("(A case study linked from the index page https://resend.com/customers.)");
    // Static logo assets under /static/customers/ are not studies.
    expect(calls.some((c) => c.url.includes("/static/customers/"))).toBe(false);
  });

  it("linear /case-studies is an app shell (soft-404): skipped, /customers index used", async () => {
    routes({
      "https://linear.app/": html(page({})),
      "https://linear.app/case-studies": html(fx("linear-case-studies-shell.html")),
      "https://linear.app/customers": html(page({ hrefs: fxJson<string[]>("linear-customers-hrefs.json"), body: "<h1>Customers</h1>" })),
      "https://linear.app/customers/saas": html(STUDY),
    });
    const c = sub(await runDim5("https://linear.app/", env(), "free"), "case_study_scannability");
    expect(c.notes).not.toContain("https://linear.app/case-studies →");
    expect(c.notes).toContain("https://linear.app/customers/saas");
    expect(c.score).toBe(100);
  });

  it("metalab (agency): /work is found and one project page is sampled", async () => {
    routes({
      "https://metalab.com/": html(page({})),
      "https://metalab.com/work": html(page({ hrefs: fxJson<string[]>("metalab-work-hrefs.json"), body: "<h1>Work</h1>" })),
      "https://metalab.com/work/uber": html(STUDY),
    });
    const c = sub(await runDim5("https://metalab.com/", env(), "free"), "case_study_scannability");
    expect(c.na).toBeUndefined();
    expect(c.notes).toContain("https://metalab.com/work/uber");
  });

  it("drveit (pt-BR): the homepage's /casos-clinicos/ link is found and one clinical case sampled", async () => {
    const casos = fxJson<string[]>("drveit-casos-hrefs.json");
    const first = casos.find((h) => /casos-clinicos\/[^/]+\/$/.test(h))!;
    routes({
      "https://drveit.com.br/": html(page({ hrefs: fxJson<string[]>("drveit-home-hrefs.json") })),
      "https://drveit.com.br/casos-clinicos/": html(page({ hrefs: casos, body: "<h1>Casos Clínicos</h1>" })),
      [first.replace(/\/$/, "")]: html(STUDY),
      [first]: html(STUDY),
    });
    const c = sub(await runDim5("https://drveit.com.br/", env(), "free"), "case_study_scannability");
    expect(c.na).toBeUndefined();
    expect(c.notes).toContain("casos-clinicos/");
    expect(c.score).toBe(100);
  });
});

// ── 9. F34: page weight ───────────────────────────────────────────────────

describe("1.4.0 F34: page weight only, no internal tool names", () => {
  it("name and note (free and paid)", async () => {
    for (const tier of ["free", "paid"] as const) {
      routes({ "https://acme.com/": html("<html><body>x</body></html>") });
      const s = sub(await runDim5("https://acme.com/", env(), tier), "page_weight_lcp");
      expect(s.name).toBe("Page weight");
      expect(s.notes).not.toMatch(/Browser Rendering|LCP|paid-tier|endpoint/);
      expect(s.notes).toBe(pageWeightNote(27 / (1024 * 1024), 27));
    }
  });
});

// ── 10. 1.5.0: FAQ fixed rules on real data ──────────────────────────────

describe("1.5.0 faq_schema: Rachel Queiroz's 4 real FAQ pairs are scored by fixed rules", () => {
  it("each question is phrased as a question and each answer has 1-300 words: 4 of 4, score 100", async () => {
    const ld = fxJson<unknown[]>("rachelqueiroz-ld.json");
    routes({ "https://rachelqueiroz.com/": html(page({ ld })) });
    const f = sub(await runDim4("https://rachelqueiroz.com/", env(() => { throw new Error("AI must not be called"); })), "faq_schema");
    expect(f.na).toBeUndefined();
    expect(f).toMatchObject({ score: 100, passed: true, notes: "4 Q&A pair(s); 4 are phrased as questions and have an answer of reasonable length." });
  });
});

// ── 11. Codex MED: Dim 4 ─────────────────────────────────────────────────

describe("1.4.0 Dim 4: deep traversal, complete Organization, FAQ answers, rating values", () => {
  const ACME = "https://acme.com/";
  const d4 = async (...ld: unknown[]) => {
    routes({ [ACME]: html(page({ ld })) });
    return runDim4(ACME, env());
  };

  it("Rachel Queiroz: her own MedicalBusiness is picked over nested Organizations (CRP council, university)", async () => {
    const d = await d4(...fxJson<unknown[]>("rachelqueiroz-ld.json"));
    expect(sub(d, "organization_schema").notes).toBe(
      "Organization found: name=true, url=true, description=false, sameAs=0; entry=MedicalBusiness #clinica; description and sameAs present on Person #pessoa"
    );
    expect(sub(d, "organization_schema").score).toBe(60);
  });

  // Note-only: the note names the entry it read and an identity entry that has what it lacks.
  it("MedicalBusiness + Person @graph: the note names both entries; score unchanged", async () => {
    const d = await d4({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Person", "@id": "https://acme.com/#pessoa", name: "Ana", url: "https://acme.com/", description: "Psicologa.", sameAs: ["https://instagram.com/ana"] },
        { "@type": ["MedicalBusiness", "LocalBusiness"], "@id": "https://acme.com/#clinica", name: "Clinica", url: "https://acme.com/" },
      ],
    });
    expect(sub(d, "organization_schema")).toMatchObject({
      score: 60,
      notes: "Organization found: name=true, url=true, description=false, sameAs=0; entry=MedicalBusiness #clinica; description and sameAs present on Person #pessoa",
    });
  });

  it.each([
    ["no @id, complete entry", { "@type": "Organization", name: "Acme", url: "https://acme.com", description: "d" }, "Organization found: name=true, url=true, description=true, sameAs=0; entry=Organization"],
    ["@id without a fragment", { "@type": "Dentist", "@id": "https://acme.com/org", name: "Acme", url: "https://acme.com", description: "d" }, "Organization found: name=true, url=true, description=true, sameAs=0; entry=Dentist https://acme.com/org"],
    ["@id with spaces or semicolons is left out", { "@type": "Organization", "@id": "x; description and sameAs present on Person #p", name: "Acme" }, "Organization found: name=true, url=false, description=false, sameAs=0; entry=Organization"],
  ])("entry label: %s", async (_n, block, notes) => {
    expect(sub(await d4(block), "organization_schema").notes).toBe(notes);
  });

  it("another Organization entry with a description is named; sameAs is not mentioned when the read entry has some", async () => {
    const d = await d4([
      { "@type": "Organization", "@id": "#a", name: "Acme", url: "https://acme.com", sameAs: "https://x.com/acme" },
      { "@type": "Corporation", "@id": "#b", name: "Acme Inc", description: "Bakery.", sameAs: ["https://y.com/acme"] },
    ]);
    expect(sub(d, "organization_schema")).toMatchObject({
      score: 60,
      notes: "Organization found: name=true, url=true, description=false, sameAs=1; entry=Organization #a; description present on Corporation #b",
    });
  });

  it("a nested Person (not a top-level entry) or one without a description is not named", async () => {
    const d = await d4(
      { "@type": "Organization", name: "Acme", url: "https://acme.com", founder: { "@type": "Person", name: "Ana", description: "Founder." } },
      { "@type": "Person", name: "Bo", sameAs: ["https://x.com/bo"] }
    );
    expect(sub(d, "organization_schema").notes).toBe("Organization found: name=true, url=true, description=false, sameAs=0; entry=Organization");
  });

  it("Organization with name + url + description = 100 without sameAs", async () => {
    expect(sub(await d4({ "@type": "Organization", name: "Acme", url: "https://acme.com", description: "Bakery." }), "organization_schema").score).toBe(100);
  });

  it.each([
    ["WebSite.publisher -> Organization", { "@type": "WebSite", publisher: { "@type": "Organization", name: "Acme", url: "https://acme.com", description: "d" } }, "organization_schema", 100],
    ["Offer.itemOffered -> Product", { "@type": "Offer", itemOffered: { "@type": "Product", name: "Tote", description: "Bag", brand: { "@type": "Brand", name: "Acme" } } }, "service_offer_schema", 100],
  ])("%s is found", async (_n, block, id, score) => {
    expect(sub(await d4(block), id as string).score).toBe(score);
  });

  it("WebPage.mainEntity -> FAQPage is found", async () => {
    const f = sub(
      await d4({ "@type": "WebPage", mainEntity: { "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Open on Sundays?", acceptedAnswer: { "@type": "Answer", text: "Yes." } }] } }),
      "faq_schema"
    );
    expect(f.na).toBeUndefined();
    expect(f.notes).toContain("1 Q&A pair(s)");
  });

  it("FAQ questions without answer text are not Q&A pairs", async () => {
    const f = sub(await d4({ "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Q?" }, { "@type": "Question", name: "R?", acceptedAnswer: { text: " " } }] }), "faq_schema");
    expect(f).toMatchObject({ score: 0, notes: FAQ_NO_ANSWERS_NOTE });
  });

  it.each([
    [{ "@type": "AggregateRating", ratingValue: null }, 50],
    [{ "@type": "AggregateRating", ratingValue: "4.8" }, 50],
    [{ "@type": "AggregateRating", ratingValue: "4,8", ratingCount: 31 }, 100],
    [{ "@type": "Review", author: { name: "Ana" }, reviewRating: { ratingValue: 5 } }, 100],
    [{ "@type": "Review", author: { name: "Ana" } }, 50],
  ])("rating %j => %i", async (block, score) => {
    expect(sub(await d4(block), "review_schema").score).toBe(score);
  });

  it("past the traversal bound: 'not fully inspected', never an absence claim", async () => {
    let deep: Record<string, unknown> = { "@type": "Organization", name: "Acme", url: "https://acme.com", description: "d" };
    for (let i = 0; i < 40; i++) deep = { "@type": "Thing", child: deep };
    const d = await d4(deep);
    expect(sub(d, "organization_schema")).toMatchObject({ na: true, notes: notFullyInspectedNote("Organization") });
    expect(sub(d, "faq_schema").notes).toBe(notFullyInspectedNote("FAQPage"));
  });
});

// ── 12. dns_txt informational ────────────────────────────────────────────

describe("1.4.0 dns_txt is informational", () => {
  it("never weighs in the Dim 2 score", async () => {
    routes({
      "https://acme.com/.well-known/mcp.json": json({ name: "acme", transports: [{ url: "https://mcp.acme.com/mcp" }] }),
      "https://cloudflare-dns.com/dns-query?name=_mcp.acme.com&type=TXT": json({ Status: 0 }, "application/dns-json"),
    });
    const d2 = await runDim2("https://acme.com/", env());
    const s = sub(d2, "dns_txt");
    expect(s).toMatchObject({ na: true, score: 0, notes: `No TXT record at _mcp.acme.com. ${DNS_TXT_INFO_NOTE}` });
    const scored = d2.sub_checks.filter((x) => !x.na);
    expect(scored.map((x) => x.id)).not.toContain("dns_txt");
  });
});
