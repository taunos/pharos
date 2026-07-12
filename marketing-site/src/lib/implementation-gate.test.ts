import { describe, it, expect } from "vitest";
import { isImplementationCheckoutEnabled } from "./implementation-gate";

describe("isImplementationCheckoutEnabled — fail-closed", () => {
  it("disabled when the binding is absent", () => {
    expect(isImplementationCheckoutEnabled({})).toBe(false);
  });
  it("disabled when empty string", () => {
    expect(isImplementationCheckoutEnabled({ IMPLEMENTATION_CHECKOUT_ENABLED: "" })).toBe(false);
  });
  it('disabled when "false"', () => {
    expect(isImplementationCheckoutEnabled({ IMPLEMENTATION_CHECKOUT_ENABLED: "false" })).toBe(false);
  });
  it('disabled when "TRUE" (case-sensitive)', () => {
    expect(isImplementationCheckoutEnabled({ IMPLEMENTATION_CHECKOUT_ENABLED: "TRUE" })).toBe(false);
  });
  it('disabled when "1"', () => {
    expect(isImplementationCheckoutEnabled({ IMPLEMENTATION_CHECKOUT_ENABLED: "1" })).toBe(false);
  });
  it('enabled ONLY when exactly "true"', () => {
    expect(isImplementationCheckoutEnabled({ IMPLEMENTATION_CHECKOUT_ENABLED: "true" })).toBe(true);
  });
});
