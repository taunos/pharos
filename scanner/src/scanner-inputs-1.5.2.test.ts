// Scanner 1.5.2 (2026-11-10 release check, RD-0117..0120): inputs the scanner
// mismeasured or missed. Every fetch is stubbed.
//  - RD-0117 page weight: the decompressed HTML, never Content-Length.
//  - RD-0118 MCP: the advertised endpoint is tested before the guessed /api/mcp.
//  - RD-0120 product pages: recognized in other languages (/produtos/).
//  - sibling: Dim 5 pricing links named in other languages.
import { describe, it, expect, vi, afterEach } from "vitest";
import { runDim2 } from "./checks/dim2-mcp";
import { runDim4, findProductLink, SERVICE_OFFER_NOT_SELLING_NA_NOTE } from "./checks/dim4-structured";
import {
  runDim5,
  runPageWeightLcp,
  pageWeightNote,
  PAGE_WEIGHT_NOT_MEASURED_NOTE,
  priceSampleLinks,
  PRICING_LINK_TEXT,
} from "./checks/dim5-parsable";
import { gatherSiteSignals, productPathKind } from "./checks/site-signals";
import { SCORING_VERSION } from "./version";
import type { DimensionResult, SubCheck } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const env = () =>
  ({
    CACHE: { get: async () => null, put: async () => {} },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) },
  }) as never;

type Call = { url: string; method: string };
type Route = (init: RequestInit) => Response | Promise<Response>;
function routes(map: Record<string, Route>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string, init: RequestInit = {}) => {
      calls.push({ url: String(u), method: String(init.method ?? "GET") });
      return (map[String(u)] ?? (() => new Response("", { status: 404 })))(init);
    })
  );
  return calls;
}
const html = (s: string, headers: Record<string, string> = {}) => () =>
  new Response(s, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
const text = (s: string, type = "text/plain; charset=utf-8") => () => new Response(s, { status: 200, headers: { "content-type": type } });
const json = (v: unknown) => () => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
const page = (opts: { ld?: unknown[]; hrefs?: string[]; body?: string }) =>
  `<!doctype html><html><head><title>t</title>${(opts.ld ?? [])
    .map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`)
    .join("")}</head><body>${(opts.hrefs ?? []).map((h) => `<a href="${h}">link</a>`).join(" ")}${opts.body ?? ""}</body></html>`;
const sub = (d: DimensionResult, id: string) => d.sub_checks.find((s) => s.id === id) as SubCheck;
const MB = 1024 * 1024;

it("SCORING_VERSION is 1.5.2", () => expect(SCORING_VERSION).toBe("1.5.2"));

// ── RD-0117: page weight ───────────────────────────────────────────────────

describe("RD-0117 page weight is the uncompressed HTML", () => {
  const SITE = "https://ugmonk.com/";
  const big = page({ body: `<p>${"x".repeat(1_262_000)}</p>` });

  it("ignores Content-Length (the compressed transfer size) and counts the body", async () => {
    // ugmonk.com: Content-Length 83656 (gzip) for about 1.2 MB of HTML.
    routes({ [SITE]: html(big, { "content-length": "83656", "content-encoding": "gzip" }) });
    const s = sub(await runDim5(SITE, env(), "free"), "page_weight_lcp");
    const bytes = new TextEncoder().encode(big).length;
    expect(s.notes).toBe(pageWeightNote(bytes / MB, bytes));
    expect(s.notes).toContain("measured uncompressed");
    expect(s.notes).not.toContain("83656");
    expect(s).toMatchObject({ score: 50, passed: false });
  });

  it("a small page with no Content-Length passes", async () => {
    routes({ [SITE]: html(page({ body: "<p>hello</p>" })) });
    expect(sub(await runDim5(SITE, env(), "free"), "page_weight_lcp")).toMatchObject({ score: 100, passed: true });
  });

  it("thresholds: under 1 MB 100, 1 to 3 MB 50, over 3 MB 0", () => {
    expect(runPageWeightLcp({ bytes: MB - 1, complete: true, truncated: false }).score).toBe(100);
    expect(runPageWeightLcp({ bytes: MB, complete: true, truncated: false }).score).toBe(50);
    expect(runPageWeightLcp({ bytes: 3 * MB, complete: false, truncated: true }).score).toBe(50);
  });

  it("past the counting cap the note says more than 3 MB, not an exact size", () => {
    const s = runPageWeightLcp({ bytes: 3 * MB + 1, complete: false, truncated: true });
    expect(s.score).toBe(0);
    expect(s.notes).toBe(
      `Homepage HTML size: more than 3 MB uncompressed (we stopped counting at ${3 * MB} bytes). This check looks at page size only; it does not measure loading speed.`
    );
  });

  it("a homepage that could not be read is not measured (it scored 100 as 0 bytes)", async () => {
    expect(runPageWeightLcp(null)).toMatchObject({ na: true, notes: PAGE_WEIGHT_NOT_MEASURED_NOTE });
    expect(runPageWeightLcp({ bytes: 0, complete: false, truncated: false })).toMatchObject({ na: true });
    routes({ [SITE]: () => new Response("err", { status: 503 }) });
    expect(sub(await runDim5(SITE, env(), "free"), "page_weight_lcp")).toMatchObject({ na: true, notes: PAGE_WEIGHT_NOT_MEASURED_NOTE });
  });

  it("the note keeps the 'Homepage HTML size: <n.nn> MB' prefix the Audit templates read", () => {
    expect(pageWeightNote(1.2, 1_262_256)).toMatch(/^Homepage HTML size: \d{1,4}\.\d{2} MB/);
  });
});

// ── RD-0118: advertised MCP endpoint first ────────────────────────────────

describe("RD-0118 Dim 2 tests the MCP endpoint the site advertises", () => {
  const SITE = "https://shopacme.com/";
  const mcpServer = (n: number): Route => (init) => {
    if (String(init.method).toUpperCase() !== "POST") return new Response("", { status: 405 });
    const msg = JSON.parse(String(init.body)) as { id?: string; method: string };
    if (msg.method === "initialize")
      return json({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: {} } })();
    if (msg.method === "tools/list")
      return json({ jsonrpc: "2.0", id: msg.id, result: { tools: Array.from({ length: n }, (_, i) => ({ name: `t${i}` })) } })();
    return new Response(null, { status: 202 });
  };
  const llms = "# Shop\n\nConnect to the MCP endpoint (`https://shopacme.com/api/ucp/mcp`).\n";

  it("both answer: the advertised endpoint is the one reported", async () => {
    const calls = routes({
      "https://shopacme.com/api/mcp": mcpServer(1),
      "https://shopacme.com/api/ucp/mcp": mcpServer(14),
    });
    const d2 = await runDim2(SITE, env(), true, gatherSiteSignals(SITE, llms, null));
    expect(sub(d2, "live_invocation").notes).toBe("tools/list returned 14 tools (endpoint tested: https://shopacme.com/api/ucp/mcp)");
    expect(sub(d2, "well_known").notes).toContain("an MCP endpoint answered at https://shopacme.com/api/ucp/mcp");
    expect(sub(d2, "well_known").evidence?.mcp_endpoint).toBe("https://shopacme.com/api/ucp/mcp");
    // Not Shopify-hosted: no UCP profile on myshopify.com.
    expect(sub(d2, "well_known").evidence?.mcp_hosted_by).toBeUndefined();
    // The guessed /api/mcp is still probed in parallel (time budget); its answer is not used.
    expect(calls.some((c) => c.method === "POST" && c.url === "https://shopacme.com/api/ucp/mcp")).toBe(true);
  });

  it("the advertised endpoint is down: the guessed /api/mcp still counts, and the note names it", async () => {
    routes({ "https://shopacme.com/api/mcp": mcpServer(1) });
    const d2 = await runDim2(SITE, env(), true, gatherSiteSignals(SITE, llms, null));
    expect(sub(d2, "live_invocation")).toMatchObject({ score: 100, notes: "tools/list returned 1 tools (endpoint tested: https://shopacme.com/api/mcp)" });
  });

  it("an advertised endpoint that asks for OAuth beats a guessed /api/mcp", async () => {
    routes({
      "https://shopacme.com/api/mcp": mcpServer(1),
      "https://shopacme.com/api/ucp/mcp": () => new Response("", { status: 401, headers: { "www-authenticate": 'Bearer realm="x"' } }),
    });
    const d2 = await runDim2(SITE, env(), true, gatherSiteSignals(SITE, llms, null));
    expect(sub(d2, "live_invocation").notes).toContain("https://shopacme.com/api/ucp/mcp");
    expect(sub(d2, "live_invocation").score).toBe(75);
  });

  it("nothing answers: the note lists the advertised endpoint first", async () => {
    routes({});
    const d2 = await runDim2(SITE, env(), true, gatherSiteSignals(SITE, llms, null));
    expect(sub(d2, "live_invocation").notes).toBe(
      "no MCP endpoint answered: no server card with a transport URL, and https://shopacme.com/api/ucp/mcp, https://shopacme.com/api/mcp did not answer an MCP initialize request"
    );
  });

  it("/api/mcp advertised itself is probed once", async () => {
    const calls = routes({ "https://shopacme.com/api/mcp": mcpServer(2) });
    const d2 = await runDim2(SITE, env(), true, gatherSiteSignals(SITE, "MCP: https://shopacme.com/api/mcp", null));
    expect(sub(d2, "live_invocation").score).toBe(100);
    expect(calls.filter((c) => c.method === "POST").length).toBe(3);
  });
});

// ── RD-0120: product pages in other languages ─────────────────────────────

describe("RD-0120 product pages are recognized in other languages", () => {
  it.each([
    ["/products/tote", "detail"],
    ["/produtos/escova-biodegradavel", "detail"],
    ["/produto/irrigador-oral/", "detail"],
    ["/productos/cepillo", "detail"],
    ["/produits/brosse", "detail"],
    ["/produkte/zahnbuerste", "detail"],
    ["/p/123", "detail"],
    ["/en-br/products/tote", "detail"],
    ["/produtos/", "listing"],
    ["/produtos", "listing"],
    ["/products", "listing"],
    ["/shop", "listing"],
    ["/loja/", "listing"],
    ["/tienda", "listing"],
    ["/pt/produtos", "listing"],
    ["/", null],
    ["/sobre", null],
    ["/store", null],
    ["/lojas", null],
    ["/nossas-lojas", null],
    ["/diferenciais/produtos-personalizados/", null],
    ["/products/a/b", null],
    ["/blog/products", null],
  ])("%s => %s", (path, kind) => {
    expect(productPathKind(path)).toBe(kind);
  });

  it("findProductLink prefers a product page over a product index", () => {
    const h = page({ hrefs: ["/produtos/", "https://drveit.com.br/produtos/escova", "/sobre"] });
    expect(findProductLink(h, "https://drveit.com.br/")).toBe("https://drveit.com.br/produtos/escova");
    expect(findProductLink(page({ hrefs: ["/sobre", "https://drveit.com.br/produtos/"] }), "https://drveit.com.br/")).toBe(
      "https://drveit.com.br/produtos/"
    );
    // Another site's product pages say nothing about this one.
    expect(findProductLink(page({ hrefs: ["https://other.com/produtos/x"] }), "https://drveit.com.br/")).toBeNull();
  });

  const DR = "https://drveit.com.br/";
  const d4 = async (hrefs: string[], extra: Record<string, Route> = {}) => {
    const calls = routes({ [DR]: html(page({ hrefs, body: "<p>Clínica odontológica.</p>" })), ...extra });
    return { s: sub(await runDim4(DR, env(), undefined, Promise.resolve(false)), "service_offer_schema"), calls };
  };

  it("drveit.com.br: a Produtos page keeps service_offer_schema scored, and that page is sampled", async () => {
    const { s, calls } = await d4(["https://drveit.com.br/produtos/", "/sobre"], {
      "https://drveit.com.br/produtos/": html(page({ body: "<p>Escova biodegradável.</p>" })),
    });
    expect(s.na).toBeUndefined();
    expect(s.notes).not.toBe(SERVICE_OFFER_NOT_SELLING_NA_NOTE);
    expect(s.notes).toBe("no Service / Product / Offer schema on the homepage or on the sampled product listing page (https://drveit.com.br/produtos/)");
    expect(calls.some((c) => c.url === "https://drveit.com.br/produtos/")).toBe(true);
  });

  it("Product markup on a sampled /produtos/x page counts", async () => {
    const { s } = await d4(["/produtos/escova"], {
      "https://drveit.com.br/produtos/escova": html(
        page({ ld: [{ "@type": "Product", name: "Escova", description: "Escova biodegradável", brand: { name: "Dr. Veit" } }] })
      ),
    });
    expect(s).toMatchObject({ score: 100, passed: true });
  });

  it("a site with no product, shop, price or pricing page is still N/A (nothing invented)", async () => {
    const { s } = await d4(["/sobre", "/contato", "/diferenciais/produtos-personalizados/", "/lojas"]);
    expect(s).toMatchObject({ na: true, notes: SERVICE_OFFER_NOT_SELLING_NA_NOTE });
  });

  it("Dim 5 price sampling takes /produtos/x pages first", () => {
    const h = page({ hrefs: ["/sobre", "/produtos/escova", "/blog"] });
    expect(priceSampleLinks(h, DR)[0]).toBe("https://drveit.com.br/produtos/escova");
  });
});

// ── sibling: pricing links in other languages ─────────────────────────────

describe("Dim 5 follows pricing links named in other languages", () => {
  it.each(["Pricing", "Preços", "Precos", "Planos", "Precios", "Planes", "Tarifs", "Tarifas", "Prix", "Preise", "Prezzi", "Prijzen"])(
    "%s",
    (t) => expect(PRICING_LINK_TEXT.test(t)).toBe(true)
  );
  it.each(["Sobre", "Contato", "Produtos", "Precisão", "Planejamento", "Tarifa zero? Leia"])("%s is not a pricing link", (t) => {
    // "Tarifa zero" is singular and stays out; "Precisão" / "Planejamento" are not prices.
    expect(PRICING_LINK_TEXT.test(t)).toBe(false);
  });

  it("a 'Preços' homepage link is found as the pricing page", async () => {
    const SITE = "https://acme.com.br/";
    routes({
      [SITE]: html(`<html><body><a href="/valores">Preços</a></body></html>`),
      "https://acme.com.br/valores": html(page({ body: "<p>Plano básico R$ 49 por mês.</p>" })),
    });
    const s = sub(await runDim5(SITE, env(), "free"), "pricing_text_visibility");
    expect(s.notes).toContain("Detected https://acme.com.br/valores");
    expect(s.na).toBeUndefined();
  });
});

// ── sibling: free-tier render check signals in other languages / currencies ──

describe("free-tier js_vs_no_js signals are not English / dollar only", () => {
  const SITE = "https://shopacme.de/";
  const filler = "<p>" + "Wir rösten frischen Kaffee in kleinen Mengen für unsere Kundschaft. ".repeat(40) + "</p>";
  it.each([
    ["German words", "<p>Unsere Produkte und Leistungen.</p>"],
    ["a euro price", "<p>Espresso 12,90 € pro Packung.</p>"],
    ["Portuguese words", "<p>Nossos serviços e preços.</p>"],
  ])("%s scores 100", async (_n, extra) => {
    routes({ [SITE]: html(page({ body: filler + extra })) });
    const s = sub(await runDim5(SITE, env(), "free"), "js_vs_no_js_render_diff");
    expect(s.score).toBe(100);
    expect(s.notes).toContain("including pricing/capabilities signals");
  });
  it("no commercial signal in any language still scores 50", async () => {
    routes({ [SITE]: html(page({ body: filler })) });
    expect(sub(await runDim5(SITE, env(), "free"), "js_vs_no_js_render_diff").score).toBe(50);
  });
});

// ── Codex review follow-ups ───────────────────────────────────────────────

describe("Codex review follow-ups", () => {
  it("a read that failed while counting past the HTML cap is not measured (bytes are a lower bound)", async () => {
    const SITE = "https://shopacme.com/";
    const chunk = new Uint8Array(512 * 1024).fill(120);
    let sent = 0;
    routes({
      [SITE]: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(c) {
              if (sent >= 5) return c.error(new Error("reset"));
              sent++;
              c.enqueue(chunk);
            },
          }),
          { status: 200, headers: { "content-type": "text/html" } }
        ),
    });
    // 2.5 MB read, then the connection drops: not "2.50 MB".
    expect(sub(await runDim5(SITE, env(), "free"), "page_weight_lcp")).toMatchObject({ na: true, notes: PAGE_WEIGHT_NOT_MEASURED_NOTE });
    expect(runPageWeightLcp({ bytes: 2.5 * MB, complete: false, truncated: true, countFailed: true }).na).toBe(true);
    // A body that really ends between 2 and 3 MB is measured.
    expect(runPageWeightLcp({ bytes: 2.5 * MB, complete: false, truncated: true })).toMatchObject({ score: 50 });
  });

  it("new words need a word start: no match inside other words", () => {
    for (const t of ["desprecios", "autoplanes", "esplanos"]) expect(PRICING_LINK_TEXT.test(t)).toBe(false);
  });

  it("a sampled product listing page is named as a listing page", async () => {
    routes({
      "https://drveit.com.br/": html(page({ hrefs: ["/produtos/"] })),
      "https://drveit.com.br/produtos/": html(page({ ld: [{ "@type": "Product", name: "Escova", description: "d", brand: { name: "b" } }] })),
    });
    const s = sub(await runDim4("https://drveit.com.br/", env(), undefined, Promise.resolve(false)), "service_offer_schema");
    expect(s.notes).toContain("(on the sampled product listing page https://drveit.com.br/produtos/; none on the homepage)");
  });
});
