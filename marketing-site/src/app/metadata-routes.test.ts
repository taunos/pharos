import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { GET as robotsGET } from "./robots.txt/route";
import sitemap from "./sitemap";
import { GET as mcpJsonGET } from "./.well-known/mcp.json/route";
import { GET as mcpGET } from "./.well-known/mcp/route";

// Test C-A (A5) — /.well-known/mcp mirror, robots and sitemap outputs.

describe("/.well-known/mcp", () => {
  it("returns the same body and headers as /.well-known/mcp.json", async () => {
    const a = mcpGET();
    const b = mcpJsonGET();
    expect(a.status).toBe(200);
    expect(await a.text()).toBe(await b.text());
    expect([...a.headers.entries()]).toEqual([...b.headers.entries()]);
  });
});

describe("robots.txt", () => {
  it("serves the crawl policy as text/plain, with Content-Signal under User-Agent: *", async () => {
    const res = robotsGET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe(
      [
        "User-Agent: *",
        "Content-Signal: search=yes, ai-input=yes",
        "Allow: /",
        "Disallow: /api/",
        "Disallow: /account",
        "Disallow: /onboarding",
        "Disallow: /audit-results/",
        "Disallow: /score/delete-me",
        "Disallow: /f2-success",
        "",
        "Sitemap: https://astrant.io/sitemap.xml",
        "",
      ].join(String.fromCharCode(10)),
    );
  });
});

describe("sitemap", () => {
  it("matches the snapshot", () => {
    expect(sitemap()).toEqual([
      { url: "https://astrant.io" },
      { url: "https://astrant.io/audit" },
      { url: "https://astrant.io/implementation" },
      { url: "https://astrant.io/custom" },
      { url: "https://astrant.io/subscriptions" },
      { url: "https://astrant.io/score" },
      { url: "https://astrant.io/score/methodology" },
      { url: "https://astrant.io/methodology/calibration" },
      { url: "https://astrant.io/research/ai-cited-vendors-2026" },
      { url: "https://astrant.io/privacy" },
      { url: "https://astrant.io/terms" },
    ]);
  });
});

describe("canonical tags", () => {
  // Every sitemap URL must declare itself canonical (www/http duplicates in
  // Search Console). Pages set their own alternates.canonical; the layout
  // only sets metadataBase so a canonical is never inherited by mistake.
  // Source-level check: page modules don't import cleanly under vitest.
  const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  const fileFor = (path: string) => (path === "/" ? "./page.tsx" : `.${path}/page.tsx`);

  for (const { url } of sitemap()) {
    const path = new URL(url).pathname;
    it(`${path} declares itself canonical`, () => {
      expect(src(fileFor(path))).toContain(`canonical: "${path}"`);
    });
  }

  it("layout pins the canonical host and sets no inheritable canonical", () => {
    const layout = src("./layout.tsx");
    expect(layout).toContain('metadataBase: new URL("https://astrant.io")');
    expect(layout).not.toMatch(/canonical:/);
  });
});
