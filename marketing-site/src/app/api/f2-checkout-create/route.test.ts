import { describe, it, expect, vi, beforeEach } from "vitest";

// D1/KV must never be reached when the checkout is gated off — make them throw
// so any accidental read fails loudly rather than silently passing.
const prepareSpy = vi.fn(() => {
  throw new Error("D1 reached while checkout disabled");
});
const kvGetSpy = vi.fn(() => {
  throw new Error("KV reached while checkout disabled");
});

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: {
      IMPLEMENTATION_CHECKOUT_ENABLED: "false",
      DODO_API_KEY: "unused-when-disabled",
      CITATION_DB: { prepare: prepareSpy },
      SESSIONS: { get: kvGetSpy, put: vi.fn() },
    },
  }),
}));

describe("POST /api/f2-checkout-create — pre-launch gate", () => {
  beforeEach(() => {
    prepareSpy.mockClear();
    kvGetSpy.mockClear();
  });

  it("returns 503 PRELAUNCH_DISABLED before touching KV, D1, or Dodo", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { POST } = await import("./route");

    const res = await POST(
      new Request("https://astrant.io/api/f2-checkout-create", {
        method: "POST",
        headers: { "Content-Type": "application/json", "cf-connecting-ip": "1.2.3.4" },
        body: JSON.stringify({ codebase_type_confirmed: true }),
      }),
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("PRELAUNCH_DISABLED");
    expect(kvGetSpy).not.toHaveBeenCalled();
    expect(prepareSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
