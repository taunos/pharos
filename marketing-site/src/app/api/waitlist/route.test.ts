import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitlistSource } from "@/lib/waitlist-source";

// Test C-B — /api/waitlist stores which waitlist the capture came from.

const store = new Map<string, string>();
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: {
      WAITLIST: {
        get: async (k: string) => store.get(k) ?? null,
        put: async (k: string, v: string) => {
          store.set(k, v);
        },
      },
    },
  }),
}));

const { POST } = await import("./route");

function post(body: Record<string, unknown>) {
  return POST(
    new Request("https://astrant.io/api/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
const captures = () =>
  JSON.parse(store.get("waitlist:a@b.co")!).captures.map((c: { source: string }) => c.source);

beforeEach(() => store.clear());

describe("waitlistSource", () => {
  it("accepts audit / other_plans; anything else → waitlist", () => {
    expect(waitlistSource("audit")).toBe("audit");
    expect(waitlistSource("other_plans")).toBe("other_plans");
    expect(waitlistSource(undefined)).toBe("waitlist");
    expect(waitlistSource("AUDIT")).toBe("waitlist");
    expect(waitlistSource("x")).toBe("waitlist");
    expect(waitlistSource(1)).toBe("waitlist");
  });
});

describe("POST /api/waitlist — source", () => {
  it("stores the given source on the capture event (fresh + append)", async () => {
    expect((await post({ url: "https://x.co", email: "a@b.co", source: "audit" })).status).toBe(200);
    expect((await post({ url: "https://x.co", email: "a@b.co", source: "other_plans" })).status).toBe(200);
    expect(captures()).toEqual(["audit", "other_plans"]);
  });
  it("absent or unknown source → waitlist (as before)", async () => {
    await post({ url: "https://x.co", email: "a@b.co" });
    await post({ url: "https://x.co", email: "a@b.co", source: "<script>" });
    expect(captures()).toEqual(["waitlist", "waitlist"]);
  });
});
