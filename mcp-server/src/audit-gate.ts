// Audit checkout gate, mirrored from marketing-site/src/lib/audit-gate.ts.
//
// Fail-closed: only the exact string "true" means the $79 Audit is purchasable.
// AUDIT_CHECKOUT_ENABLED here MUST be flipped together with the marketing-site
// var of the same name, or get_pricing will disagree with astrant.io/audit.
export function isAuditCheckoutEnabled(env: { AUDIT_CHECKOUT_ENABLED?: string }): boolean {
  return env.AUDIT_CHECKOUT_ENABLED === "true";
}

// get_pricing `notes`: Test C-B wording when open, Test C-A wording (8ebbdaa) when closed.
export function pricingNotes(env: { AUDIT_CHECKOUT_ENABLED?: string }): string {
  return isAuditCheckoutEnabled(env)
    ? "The Score is free. The Audit is purchasable now via Dodo Payments checkout at https://astrant.io/audit. Implementation, Custom Implementation, and both subscription tiers are pre-launch — join the waitlist at https://astrant.io/audit#waitlist."
    : "Score, Audit, Implementation, and both subscription tiers are self-serve via Dodo Payments checkout. Custom Implementation requires a scoping call.";
}
