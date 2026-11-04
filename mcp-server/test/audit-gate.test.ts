import { test } from "node:test";
import assert from "node:assert/strict";
import { isAuditCheckoutEnabled, pricingNotes } from "../src/audit-gate.ts";

const OPEN =
  "The Score is free. The Audit is purchasable now via Dodo Payments checkout at https://astrant.io/audit. Implementation, Custom Implementation, and both subscription tiers are pre-launch — join the waitlist at https://astrant.io/audit#waitlist.";
const CLOSED =
  "Score, Audit, Implementation, and both subscription tiers are self-serve via Dodo Payments checkout. Custom Implementation requires a scoping call.";

test('gate is fail-closed: only the exact string "true" opens it', () => {
  assert.equal(isAuditCheckoutEnabled({ AUDIT_CHECKOUT_ENABLED: "true" }), true);
  for (const v of [undefined, "", "false", "TRUE", "1", " true"]) {
    assert.equal(isAuditCheckoutEnabled({ AUDIT_CHECKOUT_ENABLED: v }), false, String(v));
  }
});

test("get_pricing notes: open → Test C-B wording", () => {
  assert.equal(pricingNotes({ AUDIT_CHECKOUT_ENABLED: "true" }), OPEN);
});

test("get_pricing notes: closed → Test C-A wording (8ebbdaa)", () => {
  assert.equal(pricingNotes({ AUDIT_CHECKOUT_ENABLED: "false" }), CLOSED);
  assert.equal(pricingNotes({}), CLOSED);
});
