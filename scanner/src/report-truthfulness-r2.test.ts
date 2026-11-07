// Report truthfulness r2 (1.3.3): no score for invented or inapplicable data,
// and no default score for an unmeasured AI rating. Fixtures only: every
// fetch is stubbed, no network.
import { describe, it, expect, vi, afterEach } from "vitest";
import { runDim1, extractBlockquote } from "./checks/dim1-llmstxt";
import { runDim2, OAUTH_NO_AUTH_NA_NOTE, OAUTH_NO_CARD_NA_NOTE } from "./checks/dim2-mcp";
import { runDim3 } from "./checks/dim3-openapi";
import { runDim4, FAQ_SCHEMA_NA_NOTE } from "./checks/dim4-structured";
import { runDim5, PRICE_BARE_RE, PRICE_TEXT_RE, MARKDOWN_INFO_NOTE } from "./checks/dim5-parsable";
import { SCORING_VERSION } from "./version";

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

type Route = () => Response | Promise<Response>;
function routes(map: Record<string, Route>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string) => {
      calls.push(String(u));
      return (map[String(u)] ?? (() => new Response("", { status: 404 })))();
    })
  );
  return calls;
}
const html = (s: string) => () => new Response(s, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
const text = (s: string, type = "text/plain") => () => new Response(s, { status: 200, headers: { "content-type": type } });
const ldPage = (...ld: unknown[]) =>
  `<html><head>${ld.map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`).join("")}</head><body>x</body></html>`;

const HOME = "https://acme.com/";
const sub = (d: { sub_checks: { id: string }[] }, id: string) =>
  d.sub_checks.find((s) => s.id === id) as import("./types").SubCheck;

it("SCORING_VERSION is 1.5.0 (supersedes 1.3.3)", () => {
  expect(SCORING_VERSION).toBe("1.5.1");
});

describe("1.3.3 Dim 4: schema.org subtypes, optional sameAs / price, FAQ N/A, nested ratings", () => {
  const DENTIST = {
    "@context": "https://schema.org",
    "@type": "Dentist",
    name: "Sorriso Clinic",
    url: "https://acme.com",
    description: "Family dental clinic in Curitiba.",
  };

  it("a Dentist (LocalBusiness subtype) with name + url + description scores 100 without sameAs (1.4.0)", async () => {
    routes({ [HOME]: html(ldPage(DENTIST)) });
    const org = sub(await runDim4(HOME, env()), "organization_schema");
    expect(org).toMatchObject({ score: 100, passed: true });
  });

  it("sameAs on a complete block changes nothing (100), never required", async () => {
    routes({ [HOME]: html(ldPage({ ...DENTIST, sameAs: ["https://instagram.com/sorriso"] })) });
    expect(sub(await runDim4(HOME, env()), "organization_schema").score).toBe(100);
  });

  it("an incomplete block does not pass on sameAs alone", async () => {
    routes({ [HOME]: html(ldPage({ "@type": "Organization", name: "Acme", sameAs: ["a", "b", "c"] })) });
    expect(sub(await runDim4(HOME, env()), "organization_schema")).toMatchObject({ score: 30, passed: false });
  });

  it.each([
    ["@type array", { ...DENTIST, "@type": ["LocalBusiness", "ProfessionalService"] }],
    ["schema.org IRI", { ...DENTIST, "@type": "https://schema.org/Bakery" }],
    ["Corporation", { ...DENTIST, "@type": "Corporation" }],
    ["inside @graph", { "@context": "https://schema.org", "@graph": [{ ...DENTIST, "@type": "LegalService" }] }],
  ])("Organization subtype via %s is recognized", async (_n, block) => {
    routes({ [HOME]: html(ldPage(block)) });
    expect(sub(await runDim4(HOME, env()), "organization_schema").score).toBe(100);
  });

  it("a Service with name + description + provider and no price scores 100", async () => {
    routes({ [HOME]: html(ldPage(DENTIST, { "@type": "Service", name: "Cleaning", description: "Dental cleaning.", provider: { "@type": "Dentist", name: "Sorriso" } })) });
    expect(sub(await runDim4(HOME, env()), "service_offer_schema")).toMatchObject({ score: 100, passed: true });
  });

  it("a SoftwareApplication (publisher as provider) counts as Service / Product", async () => {
    routes({ [HOME]: html(ldPage({ "@type": "SoftwareApplication", name: "Acme App", description: "Invoicing.", publisher: { "@type": "Organization", name: "Acme" } })) });
    const s = sub(await runDim4(HOME, env()), "service_offer_schema");
    expect(s).toMatchObject({ score: 100 });
    expect(s.notes).toContain("3/3 required fields");
  });

  it("no FAQPage markup => faq_schema N/A, weight redistributed", async () => {
    routes({ [HOME]: html(ldPage(DENTIST)) });
    const d4 = await runDim4(HOME, env());
    expect(sub(d4, "faq_schema")).toMatchObject({ na: true, score: 0, passed: false, notes: FAQ_SCHEMA_NA_NOTE });
    const scored = d4.sub_checks.filter((s) => !s.na);
    const expected = Math.round(scored.reduce((a, s) => a + s.score * s.weight, 0) / scored.reduce((a, s) => a + s.weight, 0));
    expect(d4.score).toBe(expected);
  });

  it("a well-formed FAQPage with one Q&A meeting the rules can pass (no >=5 count ladder)", async () => {
    const faq = { "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Do you take insurance?", acceptedAnswer: { "@type": "Answer", text: "Yes, we accept most dental insurance plans." } }] };
    routes({ [HOME]: html(ldPage(faq)) });
    const f = sub(await runDim4(HOME, env()), "faq_schema");
    expect(f.na).toBeUndefined();
    expect(f).toMatchObject({ score: 100, passed: true, notes: "1 Q&A pair(s); 1 are phrased as questions and have an answer of reasonable length." });
  });

  it("1.5.0: a present FAQ is always scored by the rules (no AI call, never 'not measured')", async () => {
    const faq = { "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Insurance", acceptedAnswer: { "@type": "Answer", text: "Yes, most plans." } }] };
    routes({ [HOME]: html(ldPage(faq)) });
    const f = sub(await runDim4(HOME, env(() => { throw new Error("AI must not be called"); })), "faq_schema");
    expect(f).toMatchObject({ score: 0, passed: false, notes: "1 Q&A pair(s); 0 are phrased as questions and have an answer of reasonable length." });
    expect(f.na).toBeUndefined();
  });

  it("Product.aggregateRating nested (not at top level) is found and scored", async () => {
    const product = {
      "@type": "Product",
      name: "Kit",
      description: "A kit.",
      brand: "Acme",
      aggregateRating: { "@type": "AggregateRating", ratingValue: "4.7", reviewCount: "31" },
    };
    routes({ [HOME]: html(ldPage(product)) });
    const r = sub(await runDim4(HOME, env()), "review_schema");
    expect(r.na).toBeUndefined();
    expect(r).toMatchObject({ score: 100, passed: true });
  });
});

describe("1.3.3 Dim 5: non-USD prices, no case-study metrics, root .md probe", () => {
  const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

  it.each([
    ["R$ 99,90", 1],
    ["R$99.90", 1],
    ["US$ 49", 1],
    ["$1,299.00", 1],
    ["€29", 1],
    ["29,90 €", 1],
    ["£12.50", 1],
    ["¥980", 1],
    ["₹499", 1],
    ["USD 49", 1],
    ["49 EUR", 1],
    ["BRL 1.299,90", 1],
    ["no prices here, call us", 0],
    ["since 2019 we have 40 staff", 0],
  ])("%j has %i price token(s)", (s, n) => {
    expect(count(s, PRICE_BARE_RE)).toBe(n);
  });

  it("period suffix still recognized with other currencies", () => {
    expect(count("R$ 99,90 / month and €9 per user", PRICE_TEXT_RE)).toBe(2);
  });

  it("an R$ pricing page scores pricing_text_visibility 100 (was 0)", async () => {
    routes({
      [HOME]: html("<html><body><a href='/pricing'>Planos</a></body></html>"),
      "https://acme.com/pricing": html("<html><body><p>Basico R$ 49,90</p><p>Pro R$ 99,90</p></body></html>"),
    });
    const p = sub(await runDim5(HOME, env(), "free"), "pricing_text_visibility");
    expect(p).toMatchObject({ score: 100, passed: true });
  });

  it("case-study scoring has no metrics criterion: headings + lists + bold = 100 without numbers", async () => {
    // 1.4.1: 500+ characters of server-side text, so the page is measured.
    const prose = "<p>" + "We worked with the client on this project from start to finish. ".repeat(10) + "</p>";
    const cs = `<html><body><h2>a</h2><h2>b</h2><h3>c</h3><ul><li>x</li></ul><strong>Result</strong>${prose}</body></html>`;
    routes({ [HOME]: html("<html><body>home</body></html>"), "https://acme.com/case-studies": html(cs) });
    const c = sub(await runDim5(HOME, env(), "free"), "case_study_scannability");
    expect(c).toMatchObject({ score: 100, passed: true });
    expect(c.notes).not.toContain("m:");
  });

  it("numbers alone earn nothing on a case-study page", async () => {
    const cs = `<html><body><p>50% faster, 3x growth, 20 hours saved, 400 customers</p><p>${"We worked with the client on this project from start to finish. ".repeat(10)}</p></body></html>`;
    routes({ [HOME]: html("<html><body>home</body></html>"), "https://acme.com/case-studies": html(cs) });
    expect(sub(await runDim5(HOME, env(), "free"), "case_study_scannability").score).toBe(0);
  });

  it("root URL: never probes https://acme.com.md, and /llms.txt is not a .md variant", async () => {
    const calls = routes({ [HOME]: html("<html><body>home</body></html>"), "https://acme.com/llms.txt": text("# Acme") });
    const m = sub(await runDim5(HOME, env(), "free"), "markdown_negotiation");
    expect(calls).not.toContain("https://acme.com.md");
    expect(calls.filter((c) => c.endsWith("/llms.txt"))).toEqual([]);
    // 1.5.0: informational, not scored.
    expect(m).toMatchObject({ na: true, score: 0, passed: false });
    expect(m.notes.endsWith(MARKDOWN_INFO_NOTE)).toBe(true);
  });

  it("non-root URL still probes <path>.md", async () => {
    const calls = routes({ "https://acme.com/about": html("<html><body>about</body></html>") });
    await runDim5("https://acme.com/about", env(), "free");
    expect(calls).toContain("https://acme.com/about.md");
  });
});

describe("1.3.3 Dim 2: oauth_metadata is N/A without an MCP card", () => {
  it("no card => N/A with a plain note, not a passing 100", async () => {
    routes({});
    const o = sub(await runDim2(HOME, env()), "oauth_metadata");
    expect(o).toMatchObject({ na: true, score: 0, passed: false, notes: OAUTH_NO_CARD_NA_NOTE });
  });

  it("a card with no auth declared is N/A (1.4.0: it scored 100 with an N/A note)", async () => {
    routes({ "https://acme.com/.well-known/mcp.json": () => new Response(JSON.stringify({ name: "acme", transports: [] }), { status: 200, headers: { "content-type": "application/json" } }) });
    const o = sub(await runDim2(HOME, env()), "oauth_metadata");
    expect(o).toMatchObject({ na: true, score: 0, notes: OAUTH_NO_AUTH_NA_NOTE });
  });
});

describe("1.5.0 Dim 3: a YAML spec gets the same checks as JSON", () => {
  const YAML = [
    "openapi: 3.1.0",
    "info:",
    "  title: Acme API",
    "  version: 1.0.0",
    "  description: The Acme invoicing API for small businesses.",
    "paths:",
    "  /invoices:",
    "    get:",
    "      summary: List invoices",
    "",
  ].join("\n");

  it("a valid YAML spec: every sub-check scored, no 'not measured', no 'Slice 3a' wording", async () => {
    routes({ "https://acme.com/openapi.yaml": text(YAML, "application/yaml") });
    const d3 = await runDim3(HOME, env());
    expect(d3.na).toBeUndefined();
    expect(d3.sub_checks.every((s) => !s.na)).toBe(true);
    expect(sub(d3, "spec_validity")).toMatchObject({ score: 100, notes: "Valid YAML spec, openapi 3.1.0." });
    expect(sub(d3, "info_completeness")).toMatchObject({ score: 100 });
    expect(sub(d3, "security_schemes").score).toBe(0);
    expect(sub(d3, "operation_coverage").notes).toContain("1 operation(s); 1/1 have a summary or description.");
    expect(d3.sub_checks.map((s) => s.notes).join(" ")).not.toMatch(/Slice 3a|Not measured|partial credit/);
    // canonical 75, validity 100, info 100, security 0, coverage 75.
    expect(d3.score).toBe(Math.round((75 * 25 + 100 * 25 + 100 * 15 + 0 * 15 + 75 * 20) / 100));
  });
});

describe("1.3.3 / 1.5.0 Dim 1: multi-line blockquote, fixed rules", () => {
  it("extractBlockquote reads every consecutive '>' line", () => {
    const body = "# Acme\n\n> Acme makes invoicing software\n> for small agencies in Brazil.\n>\n> Founded 2019.\n\n## Docs\n";
    expect(extractBlockquote(body)).toBe("Acme makes invoicing software for small agencies in Brazil. Founded 2019.");
    expect(extractBlockquote("# Acme\n\nno quote")).toBeNull();
  });

  it("the full blockquote is counted (words across every '>' line)", async () => {
    routes({ "https://acme.com/llms.txt": text("# Acme\n\n> Line one of the summary\n> line two of the summary.\n") });
    const b = sub(await runDim1(HOME, env()), "blockquote_eval");
    expect(b.notes).toBe("2 of 2 blockquote rules met: one paragraph (yes); 10 to 100 words (yes, 10 words).");
    expect(b).toMatchObject({ score: 100, passed: true });
  });

  it("1.5.0: no AI call and never 'not measured'; the same text always gets the same score", async () => {
    routes({ "https://acme.com/llms.txt": text("# Acme\n\n> Acme makes invoicing software.\n") });
    const failing = env(() => { throw new Error("AI must not be called"); });
    const a = sub(await runDim1(HOME, failing), "blockquote_eval");
    const b = sub(await runDim1(HOME, failing), "blockquote_eval");
    expect(a.na).toBeUndefined();
    expect(a).toEqual(b);
    expect(a.notes).toBe("1 of 2 blockquote rules met: one paragraph (yes); 10 to 100 words (no, 4 words).");
  });
});
