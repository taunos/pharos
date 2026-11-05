// Pre-launch gate for the Standard / Pro subscription checkout (E4, code-quality
// audit 2026-11-05).
//
// Fail-closed: only the exact string "true" enables subscriptions; absent,
// empty, or any other value keeps them closed. Read server-side only. Mirrors
// lib/implementation-gate.ts. Shared by the /subscriptions page (which CTA it
// renders) and the Dodo webhook's `subscription.active` branch (a subscription
// that activates while closed is held for manual review — no row, no
// onboarding email), so the UI and the server can never disagree.
export function isSubscriptionCheckoutEnabled(
  env: { SUBSCRIPTION_CHECKOUT_ENABLED?: string },
): boolean {
  return env.SUBSCRIPTION_CHECKOUT_ENABLED === "true";
}
