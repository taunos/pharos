// Outreach Codex round 3 (scanner side): sub-check evidence must say WHICH request
// produced the result (requested and final URL), whether the body was fully read,
// and, for the JSON-LD absence finding, whether absence is proven from the full text.
import { describe, it, expect, vi, afterEach } from "vitest";
import { runDim1 } from "./checks/dim1-llmstxt";
import { runDim4 } from "./checks/dim4-structured";

const env = { AI: { run: async () => ({ response: "50" }) }, CACHE: { get: async () => null, put: async () => {} } } as never;
afterEach(() => vi.unstubAllGlobals());

type Fake = { status: number; ct?: string; url: string; body?: string; throwOnText?: boolean };
function stub(byUrl: (u: string) => Fake) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string) => {
      const f = byUrl(String(u));
      return {
        status: f.status,
        ok: f.status >= 200 && f.status < 300,
        url: f.url,
        headers: new Headers({ "content-type": f.ct ?? "text/html; charset=utf-8" }),
        text: async () => {
          if (f.throwOnText) throw new Error("stream reset");
          return f.body ?? "";
        },
      };
    })
  );
}

describe("Dim 1 presence evidence records the request and the final URL", () => {
  it("a /llms.txt that redirects to another host is visible as such", async () => {
    stub((u) => (u.endsWith("/llms.txt") ? { status: 404, url: "https://other.com/missing" } : { status: 404, url: u }));
    const d = await runDim1("https://acme.com/", env);
    const p = d.sub_checks.find((s) => s.id === "presence")!;
    expect(p.evidence).toMatchObject({ status: 404, requested_url: "https://acme.com/llms.txt", final_url: "https://other.com/missing" });
    expect(p.score).toBe(0); // scoring unchanged
  });
});

describe("Dim 4 evidence: final URL, body completeness, proven JSON-LD absence", () => {
  it("records the final URL of the homepage response", async () => {
    stub(() => ({ status: 200, url: "https://other.com/", body: "<html></html>" }));
    const d = await runDim4("https://acme.com/", env);
    expect(d.sub_checks[0].evidence).toMatchObject({ requested_url: "https://acme.com/", final_url: "https://other.com/", status: 200 });
  });
  it("a body read error is body_complete:false and never proven absence", async () => {
    stub(() => ({ status: 200, url: "https://acme.com/", throwOnText: true }));
    const d = await runDim4("https://acme.com/", env);
    expect(d.sub_checks[0].evidence).toMatchObject({ body_complete: false, ld_json_absent_proven: false });
  });
  it("plain HTML with no ld+json anywhere ⇒ proven absent", async () => {
    stub(() => ({ status: 200, url: "https://acme.com/", body: "<html><head><title>Acme</title></head><body>hi</body></html>" }));
    const d = await runDim4("https://acme.com/", env);
    expect(d.sub_checks[0].evidence).toMatchObject({ body_complete: true, ld_json_absent_proven: true });
  });
  for (const [name, body, ct] of [
    ["entity-encoded type attribute", '<script type="application&#47;ld&#43;json">{"@type":"Organization"}</script>', "text/html"],
    ["hex-entity type attribute", '<script type="application&#x2F;ld&#x2B;json">{}</script>', "text/html"],
    ["named-entity plus", '<script type="application/ld&plus;json">{}</script>', "text/html"],
    ["mention inside a comment", "<!-- application/ld+json -->", "text/html"],
    ["decoding errors (replacement char)", `<html>${String.fromCodePoint(0xfffd)}</html>`, "text/html"],
    ["non-UTF-8 charset", "<html></html>", "text/html; charset=utf-16"],
    ["Shift_JIS charset", "<html></html>", "text/html; charset=Shift_JIS"],
  ] as const) {
    it(`not proven absent: ${name}`, async () => {
      stub(() => ({ status: 200, url: "https://acme.com/", body, ct }));
      const d = await runDim4("https://acme.com/", env);
      expect(d.sub_checks[0].evidence?.ld_json_absent_proven, name).toBe(false);
    });
  }
  // Codex round 4: character references with extra leading zeros, and type values
  // the parser can't confidently classify, must never yield proven absence.
  for (const [name, type] of [
    ["exact repro: decimal with many leading zeros", "application/&#0000000108;d+json"],
    ["hex with leading zeros", "application/&#x00000006C;d+json"],
    ["hex lowercase", "application/&#x6c;d+json"],
    ["hex uppercase X", "application/&#X6C;d+json"],
    ["named entity in value", "application/ld&plus;json"],
    ["mixed case value", "Application/LD+Json"],
    ["whitespace inside value", "application/ ld+json"],
    ["tab inside value", "application/ld" + String.fromCharCode(9) + "+json"],
    ["backslash in value", "application" + String.fromCharCode(92) + "/ld+json"],
    ["non-ASCII in value", "application/ld+js" + String.fromCodePoint(0x00f6) + "n"],
    ["fullwidth plus", "application/ld" + String.fromCodePoint(0xff0b) + "json"],
    ["unknown script type", "text/x-unknown-kind"],
  ] as const) {
    it(`not proven absent: ${name}`, async () => {
      stub(() => ({ status: 200, url: "https://acme.com/", body: `<html><script type="${type}">{"@type":"Organization"}</script></html>` }));
      const d = await runDim4("https://acme.com/", env);
      expect(d.sub_checks[0].evidence?.ld_json_absent_proven, name).toBe(false);
    });
  }
  it("ordinary script types still allow proven absence", async () => {
    const body = '<html><script>var a=1</script><script type="text/javascript">1</script><script type="module">2</script><script type="application/json">{}</script></html>';
    stub(() => ({ status: 200, url: "https://acme.com/", body }));
    const d = await runDim4("https://acme.com/", env);
    expect(d.sub_checks[0].evidence?.ld_json_absent_proven).toBe(true);
  });
  it("non-200 ⇒ not proven absent", async () => {
    stub(() => ({ status: 403, url: "https://acme.com/", body: "<html></html>" }));
    const d = await runDim4("https://acme.com/", env);
    expect(d.sub_checks[0].evidence).toMatchObject({ status: 403, ld_json_absent_proven: false });
  });
});
