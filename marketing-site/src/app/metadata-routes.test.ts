import { describe, it, expect } from "vitest";
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
      { url: "https://astrant.io/privacy" },
      { url: "https://astrant.io/terms" },
    ]);
  });
});
