// Free Score truthfulness (2026-11-07): the free-tier-only notes the scanner
// emits must not print invented numbers, a grade that does not exist, claims
// about a competitor's tool, or internal tool names. Every fetch is stubbed.
import { describe, it, expect, vi, afterEach } from "vitest";
import { runDim6 } from "./checks/dim6-citation";
import { runDim5 } from "./checks/dim5-parsable";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("free-tier Dim 6 note", () => {
  it("states it is not measured, with no sample numbers, no D+ grade and no competitor claim", async () => {
    const d = await runDim6("https://acme.com/", "free");
    expect(d.na).toBe(true);
    const note = d.sub_checks[0].notes;
    expect(note).toMatch(/^Not measured in the free Score\./);
    expect(note).toMatch(/not counted in your free score/);
    expect(note).not.toMatch(/\d+\/10/);
    expect(note).not.toMatch(/D\+/);
    expect(note).not.toMatch(/47\/100/);
    expect(note).not.toMatch(/Cloudflare|Agent Readiness Score/);
    expect(note).not.toMatch(/sample/i);
  });
});

describe("free-tier Dim 5 render-diff note", () => {
  it("explains the free check in plain words (no Puppeteer, no 'static fetch only')", async () => {
    const home = `<!doctype html><html><head><title>Acme</title></head><body><h1>Acme</h1><p>${"We bake bread every day. ".repeat(40)}</p></body></html>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string | URL | Request) => {
        const url = typeof u === "string" ? u : u instanceof URL ? u.href : u.url;
        return url === "https://acme.com/"
          ? new Response(home, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })
          : new Response("", { status: 404 });
      })
    );
    const env = { CACHE: { get: async () => null, put: async () => {} } } as never;
    const d = await runDim5("https://acme.com/", env, "free");
    const note = d.sub_checks.find((s) => s.id === "js_vs_no_js_render_diff")!.notes;
    expect(note).toContain("The free Score reads your server's HTML only; the $79 Audit also loads the page in a browser and compares the two.");
    expect(note).not.toMatch(/Puppeteer|Free-tier signal|static fetch only/);
  });
});
