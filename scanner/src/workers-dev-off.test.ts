// The scanner's workers.dev route is off: marketing reaches it over the
// SCANNER_SVC Service Binding, mcp-server / outreach over RPC bindings. The
// marketing site's old workers.dev origin is gone from the CORS allowlist;
// astrant.io and www.astrant.io stay.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import app from "./index";

const preflight = (origin: string) =>
  app.fetch(
    new Request("https://scanner.astrant.io/api/scan", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    }),
    {} as never,
    {} as never
  );

describe("workers.dev off", () => {
  it("wrangler.jsonc sets workers_dev: false and keeps the scanner.astrant.io custom domain", () => {
    const cfg = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    expect(cfg).toMatch(/^\s*"workers_dev": false,/m);
    expect(cfg).not.toMatch(/"workers_dev": true/);
    expect(cfg).toMatch(/\{ "pattern": "scanner\.astrant\.io", "custom_domain": true \}/);
  });

  it("CORS no longer allows the marketing workers.dev origin", async () => {
    const res = await preflight("https://pharos-marketing.pharos-dev.workers.dev");
    expect(res.headers.get("access-control-allow-origin")).not.toBe("https://pharos-marketing.pharos-dev.workers.dev");
    expect(res.headers.get("access-control-allow-origin") ?? "").toBe("");
  });

  it.each(["https://astrant.io", "https://www.astrant.io"])("CORS still allows %s", async (origin) => {
    const res = await preflight(origin);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
  });
});
