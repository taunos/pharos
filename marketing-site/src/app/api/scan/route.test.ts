import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Security pass 2026-11-04: the Score proxy forwards the real client IP to the
// scanner's rate limiter in an authenticated header (Cloudflare replaces
// CF-Connecting-IP on the cross-zone subrequest).

const state: { env: Record<string, unknown> } = { env: {} };
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: state.env }),
}));

import { POST } from "./route";

type Sent = { url: string; headers: Record<string, string>; body: string };
let sent: Sent[] = [];

beforeEach(() => {
  sent = [];
  state.env = { SCAN_PROXY_KEY: "scan-proxy-key", INTERNAL_FULFILL_KEY: "fulfill-key" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url: String(url), headers: init.headers as Record<string, string>, body: String(init.body) });
      return new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

function req(headers: Record<string, string>) {
  return new Request("https://astrant.io/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ url: "https://example.com/" }),
  });
}

describe("POST /api/scan proxy", () => {
  it("forwards the incoming cf-connecting-ip with the proxy key", async () => {
    const res = await POST(req({ "cf-connecting-ip": "203.0.113.7" }));
    expect(res.status).toBe(200);
    expect(sent[0].headers).toMatchObject({
      "x-astrant-client-ip": "203.0.113.7",
      "x-astrant-proxy-key": "scan-proxy-key",
    });
    expect(sent[0].headers["x-internal-fulfill-key"]).toBeUndefined();
  });

  it("never uses x-forwarded-for (client-spoofable)", async () => {
    await POST(req({ "x-forwarded-for": "198.51.100.1" }));
    expect(sent[0].headers["x-astrant-client-ip"]).toBeUndefined();
    expect(sent[0].headers["x-astrant-proxy-key"]).toBeUndefined();
    expect(sent[0].headers["CF-Connecting-IP"]).toBeUndefined();
  });

  it("sends no proxy headers when the key is not configured", async () => {
    state.env = {};
    await POST(req({ "cf-connecting-ip": "203.0.113.7" }));
    expect(sent[0].headers["x-astrant-client-ip"]).toBeUndefined();
    expect(sent[0].headers["x-astrant-proxy-key"]).toBeUndefined();
  });

  it("E11: sends SCAN_PROXY_KEY when set, never the fulfill key", async () => {
    state.env = { SCAN_PROXY_KEY: "scan-proxy-key", INTERNAL_FULFILL_KEY: "fulfill-key" };
    await POST(req({ "cf-connecting-ip": "203.0.113.7" }));
    expect(sent[0].headers).toMatchObject({
      "x-astrant-client-ip": "203.0.113.7",
      "x-astrant-proxy-key": "scan-proxy-key",
    });
    expect(Object.values(sent[0].headers)).not.toContain("fulfill-key");
    expect(sent[0].headers["x-internal-fulfill-key"]).toBeUndefined();
  });

  it("E11: sends SCAN_PROXY_KEY alone when the fulfill key is not configured", async () => {
    state.env = { SCAN_PROXY_KEY: "scan-proxy-key" };
    await POST(req({ "cf-connecting-ip": "203.0.113.7" }));
    expect(sent[0].headers["x-astrant-proxy-key"]).toBe("scan-proxy-key");
  });

  it("E11: never sends the fulfill key when SCAN_PROXY_KEY is unset or empty", async () => {
    state.env = { SCAN_PROXY_KEY: "", INTERNAL_FULFILL_KEY: "fulfill-key" };
    await POST(req({ "cf-connecting-ip": "203.0.113.7" }));
    expect(sent[0].headers["x-astrant-proxy-key"]).toBeUndefined();
    expect(Object.values(sent[0].headers)).not.toContain("fulfill-key");
  });

  it("does not relay client-supplied proxy headers", async () => {
    state.env = {};
    await POST(req({ "x-astrant-client-ip": "1.1.1.1", "x-astrant-proxy-key": "guess" }));
    expect(sent[0].headers["x-astrant-client-ip"]).toBeUndefined();
    expect(sent[0].headers["x-astrant-proxy-key"]).toBeUndefined();
  });
});
