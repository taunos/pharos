import { describe, it, expect } from "vitest";
import { publicOrigin } from "./origin";

// Test C-B — canonical public origin for the Audit buyer-email links.

const req = new Request("https://pharos-marketing.pharos-dev.workers.dev/api/dodo-webhook");

describe("publicOrigin", () => {
  it("uses PUBLIC_ORIGIN when it is a valid https URL (normalized to its origin)", () => {
    expect(publicOrigin({ PUBLIC_ORIGIN: "https://astrant.io" }, req)).toBe("https://astrant.io");
    expect(publicOrigin({ PUBLIC_ORIGIN: "https://astrant.io/some/path" }, req)).toBe("https://astrant.io");
  });
  it("falls back to the request origin when unset, empty, non-https or invalid", () => {
    const fallback = "https://pharos-marketing.pharos-dev.workers.dev";
    expect(publicOrigin({}, req)).toBe(fallback);
    expect(publicOrigin({ PUBLIC_ORIGIN: "" }, req)).toBe(fallback);
    expect(publicOrigin({ PUBLIC_ORIGIN: "http://astrant.io" }, req)).toBe(fallback);
    expect(publicOrigin({ PUBLIC_ORIGIN: "astrant.io" }, req)).toBe(fallback);
  });
});
