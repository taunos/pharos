// Codex security round 2, items 1-2 (scanner side): JSON-LD detection must be
// HTML-attribute tolerant, and Dim 4 must expose evidence from the SAME homepage
// response its findings are based on.
import { describe, it, expect, vi, afterEach } from "vitest";
import { extractJsonLdBlocks, runDim4 } from "./checks/dim4-structured";

const LD = '{"@context":"https://schema.org","@type":"Organization","name":"Acme","url":"https://acme.com"}';
const env = { AI: { run: async () => ({ response: "50" }) }, CACHE: { get: async () => null, put: async () => {} } } as never;

afterEach(() => vi.unstubAllGlobals());

describe("JSON-LD script detection is whitespace-, quote-, case- and attribute-order tolerant", () => {
  for (const tag of [
    '<script type="application/ld+json">',
    '<script type = "application/ld+json">',
    "<script type='application/ld+json'>",
    "<script type=application/ld+json>",
    '<SCRIPT TYPE="Application/LD+JSON">',
    '<script id="x" data-foo="a>b" type="application/ld+json" nonce="n">',
    '<script\n  type="application/ld+json"\n>',
    '<script type="application/ld+json; charset=utf-8">',
    '<script type=" application/ld+json ">',
  ]) {
    it(`finds ${JSON.stringify(tag)}`, () => {
      const close = tag.startsWith("<SCRIPT") ? "</SCRIPT>" : "</script >";
      const blocks = extractJsonLdBlocks(`<html><head>${tag}${LD}${close}</head></html>`);
      expect(blocks.length).toBe(1);
      expect((blocks[0] as { "@type": string })["@type"]).toBe("Organization");
    });
  }
  it("ignores other script types and the attribute value inside other attributes", () => {
    expect(extractJsonLdBlocks('<script type="text/javascript">var a = 1;</script>')).toEqual([]);
    expect(extractJsonLdBlocks(`<script data-type="application/ld+json">${LD}</script>`)).toEqual([]);
    expect(extractJsonLdBlocks(`<script type="application/ld+jsonx">${LD}</script>`)).toEqual([]);
  });
});

describe("Dim 4 evidence comes from its own homepage response", () => {
  function stubFetch(status: number, body: string, ct = "text/html; charset=utf-8") {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status, headers: { "content-type": ct } })));
  }
  it("a 403 to the scanner yields evidence status 403, not a 'clean' absence", async () => {
    stubFetch(403, "Forbidden");
    const d = await runDim4("https://acme.com/", env);
    const j = d.sub_checks.find((s) => s.id === "json_ld_present")!;
    expect(j.evidence).toMatchObject({ status: 403, content_type: "text/html; charset=utf-8", parsed: false, ld_json_absent_proven: false });
  });
  it("a 200 HTML page with no JSON-LD yields evidence status 200, parsed", async () => {
    stubFetch(200, "<html><body>hello</body></html>");
    const d = await runDim4("https://acme.com/", env);
    for (const s of d.sub_checks) expect(s.evidence).toMatchObject({ status: 200, content_type: "text/html; charset=utf-8", parsed: true, body_complete: true });
  });
  it("a fetch failure yields evidence status null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("boom");
    }));
    const d = await runDim4("https://acme.com/", env);
    expect(d.sub_checks[0].evidence).toMatchObject({ status: null, content_type: "", parsed: false, final_url: "", ld_json_absent_proven: false });
  });
});
