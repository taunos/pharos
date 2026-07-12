// Pre-launch gate for the paid Implementation checkout.
//
// Fail-closed: only the exact string "true" enables the checkout; absent,
// empty, or any other value keeps it disabled. Read server-side only (env is
// not available to client components) and shared by the
// /api/f2-checkout-create route (server-authoritative refusal) and the
// /implementation page (renders the unavailable/waitlist state).
export function isImplementationCheckoutEnabled(
  env: { IMPLEMENTATION_CHECKOUT_ENABLED?: string },
): boolean {
  return env.IMPLEMENTATION_CHECKOUT_ENABLED === "true";
}
