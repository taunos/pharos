import { describe, it, expect } from "vitest";
import { isAuditCheckoutEnabled } from "./audit-gate";

describe("isAuditCheckoutEnabled — fail-closed", () => {
  it("disabled when the binding is absent", () => {
    expect(isAuditCheckoutEnabled({})).toBe(false);
  });
  it("disabled when empty string", () => {
    expect(isAuditCheckoutEnabled({ AUDIT_CHECKOUT_ENABLED: "" })).toBe(false);
  });
  it('disabled when "false"', () => {
    expect(isAuditCheckoutEnabled({ AUDIT_CHECKOUT_ENABLED: "false" })).toBe(false);
  });
  it('disabled when "TRUE" (case-sensitive)', () => {
    expect(isAuditCheckoutEnabled({ AUDIT_CHECKOUT_ENABLED: "TRUE" })).toBe(false);
  });
  it('disabled when "1"', () => {
    expect(isAuditCheckoutEnabled({ AUDIT_CHECKOUT_ENABLED: "1" })).toBe(false);
  });
  it('disabled when " true" (no trimming)', () => {
    expect(isAuditCheckoutEnabled({ AUDIT_CHECKOUT_ENABLED: " true" })).toBe(false);
  });
  it('enabled ONLY when exactly "true"', () => {
    expect(isAuditCheckoutEnabled({ AUDIT_CHECKOUT_ENABLED: "true" })).toBe(true);
  });
});
