import { describe, it, expect } from "vitest";
import { parseSourceScanId, checkoutErrorMessage } from "./audit-checkout-client";

describe("parseSourceScanId", () => {
  const ID = "11111111-2222-4333-8444-555555555555";
  it("accepts a UUID v4 (trimmed, any case)", () => {
    expect(parseSourceScanId(ID)).toBe(ID);
    expect(parseSourceScanId(`  ${ID.toUpperCase()} `)).toBe(ID.toUpperCase());
  });
  it("rejects missing, empty and non-v4 values", () => {
    expect(parseSourceScanId(null)).toBeNull();
    expect(parseSourceScanId(undefined)).toBeNull();
    expect(parseSourceScanId("")).toBeNull();
    expect(parseSourceScanId("not-a-uuid")).toBeNull();
    expect(parseSourceScanId("11111111-2222-1333-8444-555555555555")).toBeNull(); // v1
    expect(parseSourceScanId("11111111-2222-4333-c444-555555555555")).toBeNull(); // bad variant
    expect(parseSourceScanId(`${ID}x`)).toBeNull();
  });
});

describe("checkoutErrorMessage", () => {
  const UNAVAILABLE = "Checkout isn't available right now — email contact@astrant.io and we'll sort it out.";
  it("RATE_LIMITED → retry-in-an-hour text", () => {
    expect(checkoutErrorMessage("RATE_LIMITED")).toBe(
      "Too many checkout attempts — try again in an hour or email contact@astrant.io.",
    );
  });
  it("MISCONFIGURED / PRELAUNCH_DISABLED / anything else → unavailable text", () => {
    expect(checkoutErrorMessage("MISCONFIGURED")).toBe(UNAVAILABLE);
    expect(checkoutErrorMessage("PRELAUNCH_DISABLED")).toBe(UNAVAILABLE);
    expect(checkoutErrorMessage("url must be a valid http(s) URL.")).toBe(UNAVAILABLE);
    expect(checkoutErrorMessage(undefined)).toBe(UNAVAILABLE);
  });
});
