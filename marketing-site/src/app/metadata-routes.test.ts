import { describe, it, expect } from "vitest";
import robots from "./robots";
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

describe("robots", () => {
  it("matches the snapshot", () => {
    expect(robots()).toEqual({
      rules: {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/account", "/onboarding", "/audit-results/", "/score/delete-me", "/f2-success"],
      },
      sitemap: "https://astrant.io/sitemap.xml",
    });
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
      { url: "https://astrant.io/methodology" },
      { url: "https://astrant.io/methodology/calibration" },
      { url: "https://astrant.io/privacy" },
      { url: "https://astrant.io/terms" },
    ]);
  });
});
