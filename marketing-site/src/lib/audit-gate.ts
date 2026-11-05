// Pre-launch gate for the paid Audit checkout (Test C-A).
//
// Fail-closed: only the exact string "true" enables the checkout; absent,
// empty, or any other value keeps it disabled. Read server-side only. Mirrors
// lib/implementation-gate.ts. Shared by /api/audit-create (server-authoritative
// refusal) and the standalone buyer-email gate in lib/audit-fulfill-run.ts.
export function isAuditCheckoutEnabled(
  env: { AUDIT_CHECKOUT_ENABLED?: string },
): boolean {
  return env.AUDIT_CHECKOUT_ENABLED === "true";
}

// The Dodo product the Audit checkout sells. Shared by /api/audit-create
// (checkout creation) and the webhook (payment → product binding).
export const AUDIT_PRODUCT_ID = "pdt_0NdQDsS4Shhe1BrDzQDaa";
