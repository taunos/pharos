import { describe, it, expect, vi, beforeEach } from "vitest";

// Env with NO RATE_LIMIT_HASH_SECRET — the limiter must fail closed and the
// route must surface 503 MISCONFIGURED (not a misleading 429), especially for
// deletion requests.
const h = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
}));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: () => ({ env: h.env }) }));

import { POST } from "./route";

beforeEach(() => {
  h.env = {
    TRIAGE_CACHE: { get: async () => null, put: async () => {} },
    RESEND_API_KEY: "x",
    UNSUBSCRIBE_SECRET: "s",
    AUDITS: {},
    // RATE_LIMIT_HASH_SECRET intentionally absent
  };
});

describe("POST /api/score/delete-me — rate-limit misconfiguration", () => {
  it("returns 503 MISCONFIGURED when RATE_LIMIT_HASH_SECRET is absent", async () => {
    const req = new Request("https://astrant.io/api/score/delete-me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.com" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const j = (await res.json()) as { error?: string };
    expect(j.error).toBe("MISCONFIGURED");
  });
});
