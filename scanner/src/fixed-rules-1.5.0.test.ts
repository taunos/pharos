// Scanner 1.5.0: fixed rules instead of AI ratings (Dim 1 blockquote, Dim 4
// FAQ), Markdown negotiation informational, YAML OpenAPI specs parsed in
// full with strict limits. Every fetch is stubbed.
import { describe, it, expect, vi, afterEach } from "vitest";
import { runDim3, parseYamlSpec, MAX_YAML_SPEC_CHARS, INCOMPLETE_SPEC_NOTE } from "./checks/dim3-openapi";
import { runDim5, MARKDOWN_INFO_NOTE } from "./checks/dim5-parsable";
import { runDim1 } from "./checks/dim1-llmstxt";
import type { SubCheck } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const env = () => ({ CACHE: { get: async () => null, put: async () => {} } }) as never;

function routes(map: Record<string, () => Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string) => (map[String(u)] ?? (() => new Response("", { status: 404 })))())
  );
}
const text = (s: string, type = "text/plain") => () => new Response(s, { status: 200, headers: { "content-type": type } });
const sub = (d: { sub_checks: SubCheck[] }, id: string) => d.sub_checks.find((s) => s.id === id) as SubCheck;
const NL = String.fromCharCode(10);
const lines = (...l: string[]) => l.join(NL) + NL;

describe("parseYamlSpec: strict limits", () => {
  it("failsafe schema: every scalar stays a string (openapi: 3.0 is \"3.0\", not 3)", () => {
    expect(parseYamlSpec(lines("openapi: 3.0", "info:", "  version: 1.10", "security: []"))).toEqual({
      openapi: "3.0",
      info: { version: "1.10" },
      security: [],
    });
  });

  it("rejects an alias bomb (billion laughs)", () => {
    const bomb = lines(
      "openapi: 3.0.0",
      "a: &a [x, x, x, x, x, x, x, x, x]",
      "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]",
      "c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b]",
      "d: [*c, *c, *c, *c, *c, *c, *c, *c, *c]"
    );
    expect(parseYamlSpec(bomb)).toBeNull();
  });

  it("rejects custom and core-schema tags, several documents, and syntax errors", () => {
    expect(parseYamlSpec(lines("openapi: !custom 3.0.0"))).toBeNull();
    expect(parseYamlSpec(lines("openapi: !!int 3"))).toBeNull();
    expect(parseYamlSpec(lines("openapi: 3.0.0", "---", "openapi: 3.1.0"))).toBeNull();
    expect(parseYamlSpec(lines("openapi: 3.0.0", "paths: [", "  /a"))).toBeNull();
    expect(parseYamlSpec(lines("- openapi: 3.0.0"))).toBeNull(); // not a mapping
  });

  it("does not parse a body over the YAML size cap", () => {
    expect(parseYamlSpec("openapi: 3.0.0" + NL + "#".repeat(MAX_YAML_SPEC_CHARS))).toBeNull();
  });

  it("a spec at the size cap parses in bounded time", () => {
    let body = lines("openapi: 3.0.3", "info:", "  title: A", "  version: 1.0.0", "paths:");
    for (let i = 0; body.length < MAX_YAML_SPEC_CHARS - 200; i++) body += lines(`  /p${i}:`, "    get:", "      summary: x");
    const t0 = Date.now();
    const spec = parseYamlSpec(body);
    expect(spec).not.toBeNull();
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

describe("runDim3 on YAML (1.5.0)", () => {
  it("a YAML spec over the parse cap is 'not read in full' (whole dimension not measured)", async () => {
    routes({ "https://acme.com/openapi.yaml": text("openapi: 3.0.3" + NL + "info:" + NL + "  title: A" + NL + "#".repeat(MAX_YAML_SPEC_CHARS)) });
    const d3 = await runDim3("https://acme.com/", env());
    expect(d3).toMatchObject({ na: true, unmeasured: true });
    expect(sub(d3, "spec_validity").notes).toBe(INCOMPLETE_SPEC_NOTE);
  });

  it("a YAML spec that does not parse scores 0 on validity; the spec checks are skipped", async () => {
    routes({ "https://acme.com/openapi.yaml": text(lines("openapi: 3.0.3", "paths: [", "  /a")) });
    const d3 = await runDim3("https://acme.com/", env());
    expect(sub(d3, "spec_validity")).toMatchObject({ score: 0, notes: "Spec at https://acme.com/openapi.yaml did not parse as JSON or recognizable YAML." });
    for (const id of ["info_completeness", "security_schemes", "operation_coverage"])
      expect(sub(d3, id)).toMatchObject({ score: 0, notes: "Skipped — spec did not parse as JSON or YAML." });
    expect(d3.sub_checks.some((s) => s.na)).toBe(false);
  });

  it("an alias bomb at /openapi.yaml is rejected quickly, not expanded", async () => {
    const bomb = lines(
      "openapi: 3.0.0",
      "a: &a [x, x, x, x, x, x, x, x, x, x]",
      "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]",
      "c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]",
      "d: &d [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]",
      "e: [*d, *d, *d, *d, *d, *d, *d, *d, *d, *d]"
    );
    routes({ "https://acme.com/openapi.yaml": text(bomb) });
    const t0 = Date.now();
    const d3 = await runDim3("https://acme.com/", env());
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(sub(d3, "spec_validity").score).toBe(0);
  });

  it("Swagger 2.0 in YAML gets the same partial credit wording as JSON", async () => {
    routes({ "https://acme.com/openapi.yaml": text(lines("swagger: \"2.0\"", "info:", "  title: A", "  version: \"1\"", "paths: {}")) });
    const d3 = await runDim3("https://acme.com/", env());
    expect(sub(d3, "spec_validity")).toMatchObject({ score: 75, notes: "Valid YAML spec, swagger 2.0 (Swagger 2.0 — recommend migrating to OpenAPI 3.x)." });
  });
});

describe("Dim 5 markdown_negotiation is informational (1.5.0)", () => {
  it("N/A with the informational suffix; the dimension score ignores it", async () => {
    routes({ "https://acme.com/": text("<html><body>Plans and pricing for teams.</body></html>", "text/html") });
    const d5 = await runDim5("https://acme.com/", env(), "free");
    const m = sub(d5, "markdown_negotiation");
    expect(m).toMatchObject({ na: true, score: 0, passed: false, weight: 25 });
    expect(m.notes.endsWith(` ${MARKDOWN_INFO_NOTE}`)).toBe(true);
    const scored = d5.sub_checks.filter((s) => !s.na);
    const expected = Math.round(scored.reduce((a, s) => a + s.score * s.weight, 0) / scored.reduce((a, s) => a + s.weight, 0));
    expect(d5.score).toBe(expected);
  });

  it("a site that does serve Markdown is also not scored, only described", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string, init: RequestInit = {}) =>
        new Headers(init.headers).get("accept") === "text/markdown"
          ? new Response("# Acme" + NL + NL + "> We bake bread.", { status: 200, headers: { "content-type": "text/markdown" } })
          : String(u) === "https://acme.com/"
            ? new Response("<html><body>x</body></html>", { status: 200, headers: { "content-type": "text/html" } })
            : new Response("", { status: 404 })
      )
    );
    const m = sub(await runDim5("https://acme.com/", env(), "free"), "markdown_negotiation");
    expect(m).toMatchObject({ na: true, score: 0 });
    expect(m.notes).toBe(`Accept: text/markdown returns text/markdown (directly). ${MARKDOWN_INFO_NOTE}`);
  });
});

describe("Dim 1 blockquote_eval end to end (1.5.0)", () => {
  it("names the business through the host label when the H1 is a longer title", async () => {
    const quote =
      "Resend is the email platform for developers. Send transactional and marketing email with a simple API, React Email templates, " +
      "webhooks for delivery events, and dedicated IPs for teams that send at volume. Domains, audiences and broadcasts are managed from one dashboard, " +
      "and SDKs cover Node.js, Python, Go, Ruby and PHP.";
    routes({ "https://resend.com/llms.txt": text(lines("# Resend Documentation", "", "> " + quote)) });
    const b = sub(await runDim1("https://resend.com/", env()), "blockquote_eval");
    expect(b).toMatchObject({ score: 100, passed: true, name: "Blockquote elevator-pitch quality" });
    expect(b.na).toBeUndefined();
  });
});
