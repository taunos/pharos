// Report truthfulness r4 (1.4.1): linear HTML scanning, same-site fetch
// scope on every redirect hop, FAQ / rating validation, applicability of
// service_offer_schema and ambiguous case-study paths, JavaScript-built
// case-study pages, plain-language notes. Every fetch is stubbed.
import { describe, it, expect, vi, afterEach } from "vitest";
import { runDim2, LIVE_OFF_SITE_NA_NOTE, LIVE_BAD_TRANSPORT_NOTE } from "./checks/dim2-mcp";
import { runDim3, DIM3_NO_API_NA_NOTE } from "./checks/dim3-openapi";
import { runDim4, FAQ_NO_ANSWERS_NOTE, SERVICE_OFFER_NOT_SELLING_NA_NOTE, REVIEW_SCHEMA_NA_NOTE } from "./checks/dim4-structured";
import {
  runDim5,
  anchorHrefs,
  caseStudyChildren,
  looksLikeCaseStudy,
  noMarkdownNote,
  MARKDOWN_INFO_NOTE,
  renderOverlapNote,
  stripTags,
  CASE_STUDY_JS_NOTE,
  CASE_STUDY_NA_NOTE,
} from "./checks/dim5-parsable";
import { safeFetch } from "./safe-fetch";
import { runScan } from "./run-scan";
import { SCORING_VERSION } from "./version";
import type { DimensionResult, SubCheck } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const env = (ai: () => unknown = () => ({ response: "50" })) =>
  ({
    CACHE: { get: async () => null, put: async () => {} },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) },
    AI: { run: async () => ai() },
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
const html = (s: string) => () => new Response(s, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
const json = (v: unknown) => () => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
const redirect = (location: string, status = 302) => () => new Response(null, { status, headers: { location } });
const page = (opts: { ld?: unknown[]; hrefs?: string[]; body?: string; title?: string }) =>
  `<!doctype html><html><head><title>${opts.title ?? "t"}</title>${(opts.ld ?? [])
    .map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`)
    .join("")}</head><body>${(opts.hrefs ?? []).map((h) => `<a href="${h}">link</a>`).join(" ")}${opts.body ?? ""}</body></html>`;
const sub = (d: DimensionResult, id: string) => d.sub_checks.find((s) => s.id === id) as SubCheck;
const PROSE = "<p>" + "We worked with the client on this project from start to finish. ".repeat(10) + "</p>";

// ── 1. Linear HTML scanning ───────────────────────────────────────────────

/** The pre-1.4.1 regex chain, as the reference result. */
const oldStripTags = (h: string) =>
  h
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const timed = (f: () => unknown) => {
  const t = performance.now();
  f();
  return performance.now() - t;
};

describe("1.4.1 linear HTML scanning (ReDoS)", () => {
  const hostile = (s: string) => s.repeat(Math.ceil(120 * 1024 / s.length));

  it.each(["<a ", "<a href=", "<a href='x'", "<script ", "<script>", "<style>", "<h2 ", "<b ", "<strong>"])(
    "120 KB of %j: every scanner completes in < 50 ms",
    (s) => {
      const doc = hostile(s);
      expect(timed(() => caseStudyChildren(doc, "https://acme.com/work"))).toBeLessThan(50);
      expect(timed(() => anchorHrefs(doc, (t) => /pricing/i.test(t)))).toBeLessThan(50);
      expect(timed(() => stripTags(doc))).toBeLessThan(50);
      expect(timed(() => looksLikeCaseStudy(doc))).toBeLessThan(50);
    }
  );

  it("2 MB of unclosed <script> stays linear", () => {
    expect(timed(() => stripTags("<script>".repeat(256 * 1024)))).toBeLessThan(500);
  });

  it.each([
    "<html><body><p>Hello <b>world</b></p><script>var a = '<p>x</p>';</script> after</body></html>",
    "a <b <c> d",
    "x <> y < z",
    "<style>.a{}</style>text<STYLE type=x>b</style>c",
    "<script>one</script>mid<script>two</script>end",
    "<script>never closed <p>text</p>",
    "<scripts>kept</scripts> <scriptx>also</scriptx>",
    "<script>a</SCRIPT>b<style>c</style >d",
    "plain text only",
    "<p>unterminated <a href='x'",
  ])("stripTags matches the old regex chain on %j", (h) => {
    expect(stripTags(h)).toBe(oldStripTags(h));
  });

  it("anchorHrefs reads quoted and unquoted hrefs; the text test sees the anchor text", () => {
    const doc = `<a href="/pricing">Our <span>Pricing</span></a><a href=/plans>Plans</a><a data-href="/x" href='/about'>About</a>`;
    expect(anchorHrefs(doc)).toEqual(["/pricing", "/plans", "/about"]);
    expect(anchorHrefs(doc, (t) => /pricing|plans/i.test(t))).toEqual(["/pricing", "/plans"]);
  });
});

// ── 2. Same-site fetch scope ──────────────────────────────────────────────

describe("1.4.1 fetch scope: every hop stays on the audited site", () => {
  it("safeFetch with sameSite: an off-site first hop is refused without a request", async () => {
    const calls = routes({});
    expect(await safeFetch("https://evil.example.net/x", {}, { timeoutMs: 1000, sameSite: "acme.com" })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("safeFetch with sameSite: a redirect off-site is refused; a subdomain is allowed", async () => {
    let calls = routes({ "https://acme.com/a": redirect("https://evil.example.net/b") });
    expect(await safeFetch("https://acme.com/a", {}, { timeoutMs: 1000, sameSite: "acme.com" })).toBeNull();
    expect(calls.map((c) => c.url)).toEqual(["https://acme.com/a"]);
    calls = routes({ "https://acme.com/a": redirect("https://docs.acme.com/b"), "https://docs.acme.com/b": html("ok") });
    const r = await safeFetch("https://acme.com/a", {}, { timeoutMs: 1000, sameSite: "acme.com" });
    expect(r?.status).toBe(200);
    r?.discard();
    // "notacme.com" is not a subdomain of acme.com.
    routes({ "https://acme.com/a": redirect("https://notacme.com/b") });
    expect(await safeFetch("https://acme.com/a", {}, { timeoutMs: 1000, sameSite: "acme.com" })).toBeNull();
  });

  it.each([307, 308])("safeFetch never replays a POST body off-site on %i (even without sameSite)", async (status) => {
    const calls = routes({ "https://acme.com/mcp": redirect("https://evil.example.net/mcp", status) });
    expect(await safeFetch("https://acme.com/mcp", { method: "POST", body: "{}" }, { timeoutMs: 1000 })).toBeNull();
    expect(calls.map((c) => c.url)).toEqual(["https://acme.com/mcp"]);
  });

  it("Dim 2: a card endpoint on another site is not called; live_invocation is N/A", async () => {
    const calls = routes({
      "https://acme.com/.well-known/mcp.json": json({ name: "acme", transports: [{ type: "streamable-http", url: "https://mcp.vendor.example.net/acme" }] }),
    });
    const d2 = await runDim2("https://acme.com/", env());
    expect(sub(d2, "live_invocation")).toMatchObject({ na: true, score: 0, notes: LIVE_OFF_SITE_NA_NOTE });
    expect(sub(d2, "well_known").score).toBe(100);
    expect(calls.some((c) => c.url.includes("vendor.example.net"))).toBe(false);
    // well_known 100 (30%) and tool_coverage 0 (20%); live_invocation is not counted.
    expect(d2.score).toBe(60);
  });

  it("Dim 2: a malformed card transport URL does not throw", async () => {
    routes({ "https://acme.com/.well-known/mcp.json": json({ name: "acme", transports: [{ url: "http://[bad" }] }) });
    const d2 = await runDim2("https://acme.com/", env());
    expect(sub(d2, "live_invocation").score).toBe(0);
    expect(sub(d2, "live_invocation").notes.startsWith(LIVE_BAD_TRANSPORT_NOTE)).toBe(true);
  });

  it("Dim 2: a same-site card endpoint that 307-redirects off-site gets no POST there", async () => {
    const calls = routes({
      "https://acme.com/.well-known/mcp.json": json({ name: "acme", transports: [{ url: "https://acme.com/mcp" }] }),
      "https://acme.com/mcp": redirect("https://evil.example.net/mcp", 307),
    });
    const d2 = await runDim2("https://acme.com/", env());
    expect(calls.some((c) => c.url.includes("evil.example.net"))).toBe(false);
    expect(sub(d2, "live_invocation").score).toBe(0);
  });

  it("Dim 2: /api/mcp and a declared endpoint redirecting off-site are not followed", async () => {
    const calls = routes({
      "https://acme.com/api/mcp": redirect("https://evil.example.net/a", 308),
      "https://acme.com/mcp": redirect("https://evil.example.net/b", 302),
    });
    await runDim2("https://acme.com/", env(), false, { mcpUrls: ["https://acme.com/mcp"], apiSignals: [] });
    expect(calls.some((c) => c.url.includes("evil.example.net"))).toBe(false);
  });

  it("Dim 3: a same-site service-desc that redirects off-site is not followed", async () => {
    const calls = routes({
      "https://acme.com/.well-known/api-catalog": json({ linkset: [{ anchor: "https://acme.com", "service-desc": [{ href: "https://acme.com/openapi.json" }] }] }),
      "https://acme.com/openapi.json": redirect("https://evil.example.net/spec.json"),
    });
    await runDim3("https://acme.com/", env());
    expect(calls.some((c) => c.url.includes("evil.example.net"))).toBe(false);
  });

  it("Dim 4: a product page that redirects off-site is not followed", async () => {
    const calls = routes({
      "https://shop.acme.com/": html(page({ hrefs: ["/products/tote"] })),
      "https://shop.acme.com/products/tote": redirect("https://evil.example.net/p"),
    });
    await runDim4("https://shop.acme.com/", env());
    expect(calls.some((c) => c.url.includes("evil.example.net"))).toBe(false);
  });

  it("Dim 5: case-study pages that redirect off-site are not followed", async () => {
    const calls = routes({
      "https://acme.com/": html(page({ hrefs: ["/case-studies/one"] })),
      "https://acme.com/case-studies/one": redirect("https://evil.example.net/cs"),
      "https://acme.com/customers": redirect("https://evil.example.net/customers"),
    });
    await runDim5("https://acme.com/", env(), "free");
    expect(calls.some((c) => c.url.includes("evil.example.net"))).toBe(false);
  });
});

// ── 3. FAQ and rating validation ──────────────────────────────────────────

describe("1.4.1 Dim 4: FAQ needs typed Questions; ratings need values in range", () => {
  const ACME = "https://acme.com/";
  const d4 = async (...ld: unknown[]) => {
    routes({ [ACME]: html(page({ ld })) });
    return runDim4(ACME, env());
  };

  it.each([
    ["no @type on the entry", { name: "Open Sundays?", acceptedAnswer: { text: "Yes." } }],
    ["@type Thing", { "@type": "Thing", name: "Open Sundays?", acceptedAnswer: { text: "Yes." } }],
    ["answer typed as something else", { "@type": "Question", name: "Open Sundays?", acceptedAnswer: { "@type": "Comment", text: "Yes." } }],
  ])("%s earns no Q&A credit", async (_n, entry) => {
    expect(sub(await d4({ "@type": "FAQPage", mainEntity: [entry] }), "faq_schema")).toMatchObject({ score: 0, notes: FAQ_NO_ANSWERS_NOTE });
  });

  it("typed Question with an untyped or Answer-typed answer counts", async () => {
    const f = sub(
      await d4({
        "@type": "FAQPage",
        mainEntity: [
          { "@type": "Question", name: "Open Sundays?", acceptedAnswer: { text: "Yes." } },
          { "@type": "Question", name: "Parking?", acceptedAnswer: { "@type": "Answer", text: "Street parking." } },
        ],
      }),
      "faq_schema"
    );
    expect(f.notes).toContain("2 Q&A pair(s)");
  });

  it.each([
    [{ "@type": "AggregateRating", ratingValue: 4.8, ratingCount: 31 }, 100],
    [{ "@type": "AggregateRating", ratingValue: "4,8", reviewCount: "12" }, 100],
    [{ "@type": "AggregateRating", ratingValue: 87, ratingCount: 10 }, 50], // 1.4.2: no assumed 0-100 scale
    [{ "@type": "AggregateRating", ratingValue: 9, bestRating: 10, ratingCount: 10 }, 100],
    [{ "@type": "AggregateRating", ratingValue: 6, bestRating: 5, ratingCount: 10 }, 50],
    [{ "@type": "AggregateRating", ratingValue: 0, ratingCount: 10 }, 50], // below the default worst (1)
    [{ "@type": "AggregateRating", ratingValue: 150, ratingCount: 10 }, 50],
    [{ "@type": "AggregateRating", ratingValue: -2, ratingCount: 10 }, 50],
    [{ "@type": "AggregateRating", ratingValue: 4, ratingCount: -3 }, 50],
    [{ "@type": "AggregateRating", ratingValue: 4, ratingCount: 2.5 }, 50],
    [{ "@type": "AggregateRating", ratingValue: 4, ratingCount: 0 }, 50],
    [{ "@type": "AggregateRating", ratingValue: 4, ratingCount: 10, reviewCount: -1 }, 50],
    [{ "@type": "AggregateRating", ratingValue: 4, bestRating: "five", ratingCount: 10 }, 50],
    [{ "@type": "Review", author: { name: "Ana" }, reviewRating: { ratingValue: 5 } }, 100],
    [{ "@type": "Review", author: { name: "Ana" }, reviewRating: { ratingValue: 7, bestRating: 5 } }, 50],
  ])("rating %j => %i", async (block, score) => {
    expect(sub(await d4(block), "review_schema").score).toBe(score);
  });

  it("no ratings markup is still N/A", async () => {
    expect(sub(await d4({ "@type": "Organization", name: "Acme" }), "review_schema")).toMatchObject({ na: true, notes: REVIEW_SCHEMA_NA_NOTE });
  });
});

// ── 4. service_offer_schema applicability ─────────────────────────────────

describe("1.4.1 Dim 4: service_offer_schema is N/A when nothing shows the site sells", () => {
  const ACME = "https://acme.org/";
  const d4 = async (body: string, pricing: boolean | undefined, ld: unknown[] = [], hrefs: string[] = []) => {
    routes({ [ACME]: html(page({ ld, hrefs, body })) });
    return sub(await runDim4(ACME, env(), undefined, pricing === undefined ? undefined : Promise.resolve(pricing)), "service_offer_schema");
  };

  it("no markup, no price, no product link, no pricing page: N/A", async () => {
    expect(await d4("<p>We defend civil liberties online.</p>", false)).toMatchObject({ na: true, notes: SERVICE_OFFER_NOT_SELLING_NA_NOTE });
  });

  it.each([
    ["a pricing page", "<p>About us.</p>", true, []],
    ["a price on the homepage", "<p>Workshops from $29 per seat.</p>", false, []],
    ["a product page link", "<p>Shop.</p>", false, ["/products/tote"]],
    ["unknown pricing (no Dim 5 signal)", "<p>About us.</p>", undefined, []],
  ])("%s keeps it scored", async (_n, body, pricing, hrefs) => {
    const s = await d4(body as string, pricing as boolean | undefined, [], hrefs as string[]);
    expect(s.na).toBeUndefined();
  });

  it("markup with zero required fields is scored, not N/A", async () => {
    const s = await d4("<p>x</p>", false, [{ "@type": "Service" }]);
    expect(s.na).toBeUndefined();
    expect(s.notes).toContain("best match has 0/3 required fields");
  });

  it("run-scan wires Dim 5's pricing page into Dim 4", async () => {
    routes({ [ACME]: html(page({ body: "<p>We defend civil liberties online.</p>" })) });
    const r = await runScan(env(), ACME, "free", { useCache: false, throwOnInsertFail: false });
    const d4r = r.dimensions.find((d) => d.dimension_id === 4)!;
    expect(sub(d4r, "service_offer_schema")).toMatchObject({ na: true, notes: SERVICE_OFFER_NOT_SELLING_NA_NOTE });
  });
});

// ── 5. Case-study applicability and JavaScript-built pages ───────────────

describe("1.4.1 Dim 5: ambiguous case-study paths and JavaScript-built pages", () => {
  // eff.org/work as fetched 2026-11-07: title "Issues | Electronic Frontier
  // Foundation", h1 "Issues", issue headings, no client / case wording.
  const EFF_WORK = page({
    title: "Issues | Electronic Frontier Foundation",
    body: `<h1>Issues</h1><h2>Privacy</h2><h3 class="node__title">Surveillance</h3><h3>Encryption</h3><h3>Free speech</h3><ul><li>a</li></ul>${"<p>" + "Defending your rights in the digital world. ".repeat(20) + "</p>"}`,
  });

  it("EFF: /work that is not a case study is not graded (N/A)", async () => {
    routes({ "https://www.eff.org/": html(page({ hrefs: ["/work"] })), "https://www.eff.org/work": html(EFF_WORK) });
    expect(sub(await runDim5("https://www.eff.org/", env(), "free"), "case_study_scannability")).toMatchObject({ na: true, notes: CASE_STUDY_NA_NOTE });
  });

  it("an ambiguous page that is not a case study falls through to the next candidate", async () => {
    routes({
      "https://acme.com/": html(page({ hrefs: ["/work"] })),
      "https://acme.com/work": html(EFF_WORK),
      "https://acme.com/customers": html(page({ title: "Customer story", body: `<h2>a</h2><h2>b</h2><h2>c</h2><ul><li>x</li></ul><b>y</b>${PROSE}` })),
    });
    const c = sub(await runDim5("https://acme.com/", env(), "free"), "case_study_scannability");
    expect(c).toMatchObject({ score: 100 });
    expect(c.notes).toContain("https://acme.com/customers");
  });

  // metalab.com/work/uber as fetched 2026-11-07: title "Uber | Product design
  // case study", h1 "Uber", 253 characters of server-side text.
  const UBER_SHELL = page({
    title: "Uber | Product design case study",
    body: `<h1>Uber</h1><dl><dt>Project Type</dt><dd>Product</dd><dt>Deliverables</dt><dd>Strategy &amp; Research, Product Design, Frontend Engineering</dd></dl><script>${"x".repeat(5000)}</script>`,
  });
  const METALAB_WORK = page({ title: "Our work | Metalab", hrefs: ["/work/uber", "/work/slack", "/work/coinbase", "/work/google"], body: "<h1>A sample of our work</h1>" + PROSE });

  it("metalab: /work is still a case-study index; the JavaScript-built study is 'not measured', not 0", async () => {
    routes({
      "https://www.metalab.com/": html(page({ hrefs: ["/work"] })),
      "https://www.metalab.com/work": html(METALAB_WORK),
      "https://www.metalab.com/work/uber": html(UBER_SHELL),
    });
    const c = sub(await runDim5("https://www.metalab.com/", env(), "paid"), "case_study_scannability");
    expect(c).toMatchObject({ na: true, score: 0, notes: CASE_STUDY_JS_NOTE });
  });

  it("metalab with a server-rendered study is graded", async () => {
    routes({
      "https://www.metalab.com/": html(page({ hrefs: ["/work"] })),
      "https://www.metalab.com/work": html(METALAB_WORK),
      "https://www.metalab.com/work/uber": html(page({ title: "Uber | Product design case study", body: `<h2>a</h2><h2>b</h2><h2>c</h2>${PROSE}` })),
    });
    const c = sub(await runDim5("https://www.metalab.com/", env(), "free"), "case_study_scannability");
    expect(c.na).toBeUndefined();
    expect(c.notes).toContain("https://www.metalab.com/work/uber");
  });

  it("looksLikeCaseStudy: title / h1 words or challenge / solution / result sections", () => {
    expect(looksLikeCaseStudy("<title>Uber | Product design case study</title>")).toBe(true);
    expect(looksLikeCaseStudy("<h1>Projetos recentes</h1>")).toBe(true);
    expect(looksLikeCaseStudy("<h2>The challenge</h2>")).toBe(true);
    expect(looksLikeCaseStudy(EFF_WORK)).toBe(false);
  });
});

// ── 6. Notes and version ──────────────────────────────────────────────────

describe("1.4.1 notes", () => {
  it("render overlap note describes distinct-word overlap", () => {
    expect(renderOverlapNote(48)).toBe(
      "About 48% of the distinct words on your homepage appear in both the HTML your server sends and the page after JavaScript runs."
    );
  });

  it("markdown note names the addresses checked (root and non-root)", async () => {
    routes({ "https://acme.com/": html(page({})) });
    // 1.5.0: informational suffix.
    expect(sub(await runDim5("https://acme.com/", env(), "free"), "markdown_negotiation").notes).toBe(`${noMarkdownNote(["https://acme.com/index.md"])} ${MARKDOWN_INFO_NOTE}`);
    expect(noMarkdownNote(["https://acme.com/index.md"])).toBe(
      "We found no Markdown version at the addresses we checked (https://acme.com/index.md and an Accept: text/markdown request to the homepage). Agents read the HTML instead."
    );
    routes({ "https://acme.com/about": html(page({})) });
    expect(sub(await runDim5("https://acme.com/about", env(), "free"), "markdown_negotiation").notes).toBe(
      `${noMarkdownNote(["https://acme.com/index.md", "https://acme.com/about.md"], "https://acme.com/about")} ${MARKDOWN_INFO_NOTE}`
    );
  });

  it("Dim 3 N/A note has no internal jargon", () => {
    expect(DIM3_NO_API_NA_NOTE).toContain("This dimension is not counted in your score.");
    expect(DIM3_NO_API_NA_NOTE).not.toMatch(/composite|penalty|marked N\/A/);
  });

  it("SCORING_VERSION is 1.5.1 (bumped after r6)", () => expect(SCORING_VERSION).toBe("1.5.1"));
});
