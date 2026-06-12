// Shared category enum for customer-profile capture across tier-fulfillment surfaces.
//
// Source-of-truth shared across:
//   - /api/onboarding/submit  (F3 Standard onboarding form)
//   - /api/f2-checkout-create (F2 Dodo Create Checkout Session custom_fields[2] dropdown)
//
// V-J.2 V-read confirmed at deploy time: existing CATEGORY_ENUM at
// onboarding/submit/route.ts:60. F2 v6.1 deploy-prompt v5 §3.0.2 extracted to this
// shared module so F2 + F3 reference the same canonical list.
//
// If this list changes, both consumers automatically pick up the new values.
// CustomerCategory type ensures typecheck-time discipline at call sites.

export const CUSTOMER_CATEGORIES = [
  "saas",
  "ecommerce",
  "fintech",
  "developer-tools",
  "other",
] as const;

export type CustomerCategory = (typeof CUSTOMER_CATEGORIES)[number];

export function isValidCustomerCategory(value: unknown): value is CustomerCategory {
  return typeof value === "string" && (CUSTOMER_CATEGORIES as readonly string[]).includes(value);
}
