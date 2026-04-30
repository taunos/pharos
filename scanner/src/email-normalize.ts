/**
 * Canonical email normalization — scanner-side mirror of
 * marketing-site/src/lib/email-normalize.ts. MUST stay byte-identical
 * to the marketing-site copy. See that file for full rationale.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
